/**
 * File: apps/web/src/core/answer/answerClient.ts
 * Purpose: Browser side of POST /api/answer: sends the request, reads the server-sent events as
 *          they arrive, calls back for each text piece, and measures time to first text and total
 *          time. Returns a cancel function. createAnswerRunner() (Day 4) runs live answers one
 *          at a time (a new one cancels the old) and measures key press → request sent → first
 *          word → headline complete → done.
 * Used by: src/features/dev/ClaudeTest.tsx (Day 1); src/core/answer/warm.ts; the live answer
 *          panel (Day 4)
 * Depends on: @kite/shared (AnswerRequest, AnswerEvent types), browser fetch and streams,
 *             src/core/sync/foreground.ts (holds account sync while streaming, ADR-0049)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (flow), §7.1 (core/answer)
 */
import type {
  AnswerErrorCode,
  AnswerMeta,
  AnswerModel,
  AnswerRequest,
  AnswerTimings,
  AnswerUsage,
} from '@kite/shared';
import { isAnswerModel } from '@kite/shared';
import { holdSyncForAnswer } from '../sync/foreground';

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
  /**
   * ADR-0094: the tier that really answered (the server's, after the admin's switch); absent when the
   * server did not say (an older server). ADR-0095: 'groq' when Groq answered.
   */
  model?: AnswerModel;
  /**
   * ADR-0095: why a Groq answer was answered by Claude Haiku instead ('timeout', 'error', 'empty'); absent
   * when it was not.
   */
  fallback?: 'timeout' | 'error' | 'empty';
  /**
   * ADR-0112: true when the server stopped the reply on a copied template line (no text came); absent
   * otherwise.
   */
  templated?: true;
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
  /**
   * Called at most once, after the answer's words, with the cleaned question from the hidden last
   * line (v1.0.2, ADR-0037). Not called when the reply has none.
   */
  onQuestion?: (question: string) => void;
  /** Called once when the answer is complete. */
  onDone: (done: AnswerDone) => void;
  /** Called once when the answer fails. */
  onError: (failure: AnswerFailure) => void;
  /**
   * ADR-0076 (timing trace): the request reached a phase: its body was ready (after any gzip), fetch was
   * called, or the response headers arrived. `at` is Unix ms.
   */
  onPhase?: (phase: RequestPhase, at: number) => void;
}

/** ADR-0076: the phases of one answer request, for the timing trace. */
export type RequestPhase = 'body-ready' | 'fetch' | 'headers';

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

/** 1.5.1 (ADR-0069): request bodies at least this large (characters of JSON) are sent gzipped. */
export const GZIP_FROM_CHARS = 64_000;

/**
 * The body to send: gzipped when it is large and the browser can compress, as it is otherwise.
 *
 * @param json The request as JSON.
 * @returns The body and whether it is gzipped.
 * Called from: streamAnswer(), core/documents/summary.ts; tests
 */
export async function requestBody(
  json: string,
): Promise<{ data: string | Uint8Array<ArrayBuffer>; gzip: boolean }> {
  if (json.length < GZIP_FROM_CHARS || typeof CompressionStream === 'undefined') {
    return { data: json, gzip: false };
  }
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    return { data: new Uint8Array(await new Response(stream).arrayBuffer()), gzip: true };
  } catch {
    return { data: json, gzip: false };
  }
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
    } else if (event === 'question') {
      // Only a non-empty string is a question; anything else is ignored, never shown.
      if (typeof payload.question === 'string' && payload.question.trim() !== '') {
        handlers.onQuestion?.(payload.question.trim());
      }
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
          // ADR-0094: only a known tier is passed on (ADR-0095: Groq too, and why it fell back; ADR-0099: the
          // Gemini and GPT models too).
          ...(isAnswerModel(payload.model) ? { model: payload.model } : {}),
          ...(payload.fallback === 'timeout' ||
          payload.fallback === 'error' ||
          payload.fallback === 'empty'
            ? { fallback: payload.fallback }
            : {}),
          // ADR-0112: only the literal true is passed on.
          ...(payload.templated === true ? { templated: true as const } : {}),
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

  // ADR-0049: account sync holds its pushes while this answer streams, so they never compete.
  const releaseSync = holdSyncForAnswer();
  void (async () => {
    try {
      // 1.5.1 (ADR-0069): a large body (big documents) is sent gzipped: about 4× smaller, so less time
      // uploading before Claude can start. The server unpacks it (server/requestBody.ts).
      const body = await requestBody(JSON.stringify(request));
      handlers.onPhase?.('body-ready', Date.now());
      handlers.onPhase?.('fetch', Date.now());
      const response = await fetchImpl(options.endpoint ?? '/api/answer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(body.gzip ? { 'Content-Encoding': 'gzip' } : {}),
        },
        body: body.data,
        signal: controller.signal,
      });
      handlers.onPhase?.('headers', Date.now());
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
    } finally {
      releaseSync();
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
  /** The cleaned question, after the answer's words (v1.0.2, ADR-0037). */
  onQuestion?: (question: string) => void;
  /** The answer finished: its full text, the server's details and the timeline. */
  onDone: (text: string, done: AnswerDone, timeline: AnswerTimeline) => void;
  /** The answer failed (the text so far is kept by the caller). */
  onError: (failure: AnswerFailure) => void;
  /** 1.5.1 (ADR-0069): nothing came back in time, and the request was sent again. */
  onRetry?: () => void;
  /** ADR-0076 (timing trace): a request phase (see AnswerHandlers.onPhase). */
  onPhase?: (phase: RequestPhase, at: number) => void;
}

/** 1.5.1 (ADR-0069): no reply at all this long after sending (ms): the request is sent again, once. */
export const FIRST_REPLY_TIMEOUT_MS = 8_000;

/** 1.5.1: shown when the second try also got no reply in time. */
export const SLOW_REPLY_MESSAGE = 'Claude is slow to start. Press Answer again.';

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
  /** 1.5.1: how long to wait for the first reply before sending again, ms (default FIRST_REPLY_TIMEOUT_MS). */
  firstReplyTimeoutMs?: number;
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
  const firstReplyTimeoutMs = options.firstReplyTimeoutMs ?? FIRST_REPLY_TIMEOUT_MS;
  // The first-reply timer of the running answer.
  let replyTimer: ReturnType<typeof setTimeout> | null = null;
  const stopReplyTimer = () => {
    if (replyTimer) clearTimeout(replyTimer);
    replyTimer = null;
  };
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
      // 1.5.1 (ADR-0069): any reply (its type, its question or a word) stops the first-reply timer.
      let replied = false;
      const gotReply = () => {
        replied = true;
        stopReplyTimer();
      };
      let attempt = 0;
      const start = () => {
        attempt += 1;
        stopReplyTimer();
        replyTimer = setTimeout(() => {
          if (!live() || replied) return;
          current?.cancel();
          if (attempt < 2) {
            handlers.onRetry?.();
            start();
            return;
          }
          current = null;
          replyTimer = null;
          handlers.onError({ code: 'timeout', message: SLOW_REPLY_MESSAGE });
        }, firstReplyTimeoutMs);
        current = send(request, {
          onPhase: (phase, at) => {
            if (live()) handlers.onPhase?.(phase, at);
          },
          onMeta: (meta) => {
            if (!live()) return;
            gotReply();
            handlers.onMeta?.(meta);
          },
          onQuestion: (question) => {
            if (!live()) return;
            gotReply();
            handlers.onQuestion?.(question);
          },
          onDelta: (piece) => {
            if (!live()) return;
            gotReply();
            firstWordAt ??= now();
            text += piece;
            // The headline is the first line: complete at the first line break after some text.
            if (headlineAt === null && /\S[^\n]*\n/.test(text)) headlineAt = now();
            handlers.onText(text);
          },
          onDone: (done) => {
            if (!live()) return;
            stopReplyTimer();
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
            stopReplyTimer();
            current = null;
            handlers.onError(failure);
          },
        });
      };
      start();
    },
    cancel() {
      generation += 1;
      stopReplyTimer();
      current?.cancel();
      current = null;
    },
    busy: () => current !== null,
  };
}
