/**
 * File: apps/web/src/core/answer/answerClient.ts
 * Purpose: Browser side of POST /api/answer: sends the request, reads the server-sent events as
 *          they arrive, calls back for each text piece, and measures time to first text and total
 *          time. Returns a cancel function.
 * Used by: src/features/dev/ClaudeTest.tsx (Day 1); the live answer panel (Day 4)
 * Depends on: @kite/shared (AnswerRequest, AnswerEvent types), browser fetch and streams
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (flow), §7.1 (core/answer)
 */
import type { AnswerErrorCode, AnswerRequest, AnswerTimings, AnswerUsage } from '@kite/shared';

/** Final details of a successful answer. */
export interface AnswerDone {
  /** Token counts reported by Claude. */
  usage: AnswerUsage;
  /** Server-side timings (from the server receiving the request). */
  serverMs: AnswerTimings;
  /** Browser-side: milliseconds from sending the request to the first text piece. */
  msToFirstText: number;
  /** Browser-side: milliseconds from sending the request to the end of the reply. */
  msTotal: number;
}

/** A failed answer. */
export interface AnswerFailure {
  /** Machine-readable reason (the server's code, or 'internal' for network problems). */
  code: AnswerErrorCode;
  /** Short explanation to show. */
  message: string;
}

/** Callbacks for streamAnswer(). None are called after cancel(). */
export interface AnswerHandlers {
  /** Called with each new piece of answer text, in order. */
  onDelta: (text: string) => void;
  /** Called once when the answer is complete. */
  onDone: (done: AnswerDone) => void;
  /** Called once when the answer fails. */
  onError: (failure: AnswerFailure) => void;
}

/** Options for streamAnswer() (tests replace fetch; the endpoint is fixed in the app). */
export interface StreamAnswerOptions {
  /** URL to post to. Default '/api/answer'. */
  endpoint?: string;
  /** fetch implementation. Default the browser's fetch. */
  fetchImpl?: typeof fetch;
}

/** One parsed server-sent event. */
export interface SseMessage {
  /** Event name from the `event:` line ('message' when missing). */
  event: string;
  /** Text of the `data:` line(s), joined with newlines. */
  data: string;
}

/**
 * Creates an incremental SSE parser. Network chunks can end anywhere (even mid-line or
 * mid-character), so text is kept in a buffer until a blank line completes an event.
 *
 * @param onMessage Called for each complete event.
 * @returns push(chunk) to feed text; it may call onMessage zero or more times.
 * Called from: streamAnswer(); tests
 */
export function createSseParser(onMessage: (message: SseMessage) => void): {
  push: (chunk: string) => void;
} {
  let buffer = '';
  return {
    push(chunk: string) {
      // Normalise CRLF/CR line endings (allowed by the SSE format) to LF.
      buffer = (buffer + chunk).replace(/\r\n?/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          // Lines starting with ':' are comments (keep-alives) and are ignored.
        }
        if (data.length > 0) onMessage({ event, data: data.join('\n') });
        boundary = buffer.indexOf('\n\n');
      }
    },
  };
}

/**
 * Turns a non-200 JSON response into an AnswerFailure.
 *
 * @param response The failed response.
 * @returns The server's code and message, or a generic one if the body is not JSON.
 * Called from: streamAnswer()
 */
async function failureFrom(response: Response): Promise<AnswerFailure> {
  try {
    const body = (await response.json()) as Partial<AnswerFailure>;
    if (body.code && body.message) return { code: body.code, message: body.message };
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return { code: 'internal', message: `Request failed (HTTP ${response.status})` };
}

/**
 * Asks the server for an answer and streams it.
 * Timings use performance.now(): msToFirstText is measured when the first `delta` event is
 * parsed, which is what the user perceives as "the first word appeared".
 *
 * @param request  The AnswerRequest to send.
 * @param handlers Callbacks for text pieces, completion and failure.
 * @param options  Endpoint and fetch overrides (tests).
 * @returns `{ cancel }`: aborts the request; no callbacks run afterwards.
 * Called from: ClaudeTest.tsx (Day 1), the live answer panel (Day 4)
 */
export function streamAnswer(
  request: AnswerRequest,
  handlers: AnswerHandlers,
  options: StreamAnswerOptions = {},
): { cancel: () => void } {
  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = performance.now();
  let firstTextAt: number | null = null;
  let finished = false;

  /** Calls a handler unless the answer was cancelled or already finished. */
  const finish = (report: () => void) => {
    if (finished || controller.signal.aborted) return;
    finished = true;
    report();
  };

  const parser = createSseParser(({ event, data }) => {
    if (finished || controller.signal.aborted) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      finish(() => handlers.onError({ code: 'internal', message: 'Malformed reply from server' }));
      return;
    }
    if (event === 'delta') {
      firstTextAt ??= performance.now();
      handlers.onDelta(String(payload.text ?? ''));
    } else if (event === 'done') {
      const doneAt = performance.now();
      finish(() =>
        handlers.onDone({
          usage: payload.usage as AnswerUsage,
          serverMs: payload.ms as AnswerTimings,
          msToFirstText: Math.round((firstTextAt ?? doneAt) - startedAt),
          msTotal: Math.round(doneAt - startedAt),
        }),
      );
    } else if (event === 'error') {
      finish(() =>
        handlers.onError({
          code: (payload.code as AnswerErrorCode) ?? 'internal',
          message: String(payload.message ?? 'The answer failed'),
        }),
      );
    }
  });

  void (async () => {
    try {
      const response = await fetchImpl(options.endpoint ?? '/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const failure = await failureFrom(response);
        finish(() => handlers.onError(failure));
        return;
      }
      const reader = response.body.getReader();
      // stream: true keeps a multi-byte character that is split across chunks intact.
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      // The server always ends with done or error; anything else means the connection dropped.
      finish(() =>
        handlers.onError({ code: 'internal', message: 'The connection closed before the end' }),
      );
    } catch (error) {
      if (controller.signal.aborted) return; // cancel(): stay silent.
      finish(() =>
        handlers.onError({
          code: 'internal',
          message: error instanceof Error ? 'Network error' : 'Unknown error',
        }),
      );
    }
  })();

  return { cancel: () => controller.abort() };
}
