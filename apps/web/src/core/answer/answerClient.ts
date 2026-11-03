/**
 * File: apps/web/src/core/answer/answerClient.ts
 * Purpose: Browser side of POST /api/answer: sends the request, reads the server-sent events as
 *          they arrive, calls back for each text piece, and measures time to first text and total
 *          time. Returns a cancel function. createAnswerRunner() (Day 4) runs live answers one
 *          at a time (a new one cancels the old) and measures key press → request sent → first
 *          word → headline complete → done.
 * Used by: src/features/dev/ClaudeTest.tsx (Day 1); src/core/answer/warm.ts; the live answer
 *          panel (Day 4)
 * Depends on: @kite/shared (AnswerRequest, AnswerEvent types), browser fetch and streams
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (flow), §7.1 (core/answer)
 */
import type {
  AnswerErrorCode,
  AnswerMeta,
  AnswerRequest,
  AnswerTimings,
  AnswerUsage,
} from '@kite/shared';

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
  /** Called once before the first word, with the answer's type, target and source (ADR-0030). */
  onMeta?: (meta: AnswerMeta) => void;
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

  /**
   * Calls a handler unless the answer was cancelled or already finished, so the caller gets
   * exactly one onDone or onError per answer.
   *
   * @param report The handler call to make.
   */
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
    if (event === 'meta') {
      handlers.onMeta?.(payload.meta as AnswerMeta);
    } else if (event === 'delta') {
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

/**
 * Where an answer's time went, in ms from the key press (architecture §6.2 targets: request
 * sent ≤ 50 ms, first word ≤ 1.0 s, headline ≤ 1.5 s at p50).
 */
export interface AnswerTimeline {
  /** Key press → request handed to fetch (building the request). */
  toSent: number;
  /** Key press → first answer text on screen. */
  toFirstWord: number;
  /** Key press → headline complete (first line break, or the end for a one-line answer). */
  toHeadline: number;
  /** Key press → answer complete. */
  toDone: number;
}

/** Callbacks for one answer run by an AnswerRunner. None are called after it is cancelled. */
export interface RunHandlers {
  /** The answer text so far (the whole text, each time a piece arrives). */
  onText: (text: string) => void;
  /** The answer's type, target and source, before its first word (ADR-0030). */
  onMeta?: (meta: AnswerMeta) => void;
  /** The answer finished: its full text, the server's details and the timeline. */
  onDone: (text: string, done: AnswerDone, timeline: AnswerTimeline) => void;
  /** The answer failed (the text so far is kept by the caller). */
  onError: (failure: AnswerFailure) => void;
}

/** Runs answers one at a time: a new one cancels the one still streaming. */
export interface AnswerRunner {
  /**
   * Starts an answer, cancelling any answer still running.
   *
   * @param request    The request (from buildAnswerRequest()).
   * @param keyPressAt When the user pressed Answer or sent Chat (the runner's clock, ms).
   * @param handlers   Callbacks for this answer only.
   */
  run(request: AnswerRequest, keyPressAt: number, handlers: RunHandlers): void;
  /** Cancels the running answer, if any (Clear, or End). */
  cancel(): void;
  /** True while an answer is streaming. */
  busy(): boolean;
}

/** Options for createAnswerRunner() (tests replace both). */
export interface AnswerRunnerOptions {
  /** Sends one request. Default streamAnswer(). */
  send?: typeof streamAnswer;
  /** Clock in ms, the same one keyPressAt uses. Default performance.now(). */
  now?: () => number;
}

/**
 * Creates the live page's answer runner.
 *
 * @param options Request and clock overrides (tests).
 * @returns The runner.
 * Called from: the live page (one runner per call); tests
 */
export function createAnswerRunner(options: AnswerRunnerOptions = {}): AnswerRunner {
  const send = options.send ?? streamAnswer;
  const now = options.now ?? (() => performance.now());
  let current: { cancel: () => void } | null = null;
  /** Increases with every run, so a cancelled run's late callbacks are ignored. */
  let generation = 0;

  return {
    run(request, keyPressAt, handlers) {
      current?.cancel();
      generation += 1;
      const mine = generation;
      const live = () => mine === generation;
      let text = '';
      let firstWordAt: number | null = null;
      let headlineAt: number | null = null;
      const sentAt = now();
      current = send(request, {
        onMeta: (meta) => {
          if (live()) handlers.onMeta?.(meta);
        },
        onDelta: (piece) => {
          if (!live()) return;
          firstWordAt ??= now();
          text += piece;
          // The headline is the first line: complete at the first line break after some text.
          if (headlineAt === null && /\S[^\n]*\n/.test(text)) headlineAt = now();
          handlers.onText(text);
        },
        onDone: (done) => {
          if (!live()) return;
          const doneAt = now();
          current = null;
          handlers.onDone(text, done, {
            toSent: Math.round(sentAt - keyPressAt),
            toFirstWord: Math.round((firstWordAt ?? doneAt) - keyPressAt),
            toHeadline: Math.round((headlineAt ?? doneAt) - keyPressAt),
            toDone: Math.round(doneAt - keyPressAt),
          });
        },
        onError: (failure) => {
          if (!live()) return;
          current = null;
          handlers.onError(failure);
        },
      });
    },
    cancel() {
      generation += 1;
      current?.cancel();
      current = null;
    },
    busy: () => current !== null,
  };
}
