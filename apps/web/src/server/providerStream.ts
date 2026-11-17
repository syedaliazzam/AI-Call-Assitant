/**
 * File: apps/web/src/server/providerStream.ts
 * Purpose: What the third-party answer providers (Groq, OpenAI, Gemini) share: ProviderError (a failure with an
 *          HTTP status only), readSseJson() (reads a server-sent-events body as JSON objects), and
 *          withFirstTokenFallback() (when a provider fails, or sends no first token within FIRST_TOKEN_MS, the
 *          same answer is asked of Claude Haiku instead).
 * Used by: src/server/groq.ts, src/server/openai.ts, src/server/gemini.ts, app/api/answer/route.ts
 * Depends on: nothing (the server's fetch types only)
 * Architecture: docs/decisions/ADR-0099-gemini-and-openai-answer-models.md (moved here from server/groq.ts,
 *               ADR-0095); architecture §6, §7.2
 *
 * Nothing here logs prompt or answer text; errors carry an HTTP status only, never a provider's message (it
 * may echo the request) or a key.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnswerProvider } from '@kite/shared';

/**
 * An OpenAI-style finish reason in Claude's words, so the route treats every provider alike (a content
 * filter is a refusal). Used for Groq and OpenAI (moved from server/groq.ts, ADR-0099).
 *
 * @param reason OpenAI's finish_reason.
 * @returns The matching Claude stop reason, or null.
 * Called from: server/groq.ts, server/openai.ts; tests
 */
export function toStopReason(reason: string | null | undefined): Anthropic.StopReason | null {
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return null;
}

/**
 * How long a third-party provider has to send the first answer token before the answer is asked of Claude
 * Haiku instead, in ms (ADR-0095 and ADR-0099: the developer's 4 s).
 */
export const FIRST_TOKEN_MS = 4_000;

/**
 * A third-party provider's failure, with the HTTP status when there was one. The provider's own error text is
 * never kept: it may echo the request.
 */
export class ProviderError extends Error {
  /** Which provider failed. */
  readonly provider: Exclude<AnswerProvider, 'claude'>;
  /** HTTP status from the provider, or undefined for a broken or empty stream. */
  readonly status: number | undefined;

  /**
   * @param provider Which provider failed.
   * @param code     A short code for logs: 'http', 'no_body', 'stream', 'empty'.
   * @param status   The provider's HTTP status, when there was one.
   */
  constructor(provider: Exclude<AnswerProvider, 'claude'>, code: string, status?: number) {
    super(code);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
  }
}

/**
 * Reads a server-sent-events body: one "data: …" line per event, events separated by a blank line. Yields
 * each event's JSON; "[DONE]" (OpenAI's end marker) is skipped. An event that is not JSON, or that carries an
 * `error` object, ends the stream with a ProviderError ('stream'). If the caller stops reading early, the
 * body is cancelled.
 *
 * @param body     The response body.
 * @param provider Who sent it (for the error).
 * @param status   The response's HTTP status (for the error).
 * @returns An async generator of parsed events.
 * @throws ProviderError('stream') for a broken event or an error event.
 * Called from: streamGroqReply() in server/groq.ts, streamOpenAIReply() in server/openai.ts,
 *              streamGeminiReply() in server/gemini.ts
 */
export async function* readSseJson(
  body: ResponseBody,
  provider: Exclude<AnswerProvider, 'claude'>,
  status: number,
): AsyncGenerator<unknown, void, undefined> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '' || data === '[DONE]') continue;
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          throw new ProviderError(provider, 'stream', status);
        }
        if (event && typeof event === 'object' && (event as { error?: unknown }).error) {
          throw new ProviderError(provider, 'stream', status);
        }
        yield event;
      }
    }
    finished = true;
  } finally {
    // The consumer stopped early or an error escaped: release the body so the provider stops sending.
    if (!finished) void reader.cancel().catch(() => undefined);
  }
}

/**
 * Sends a provider request and checks its response, so each provider's stream starts the same way.
 *
 * @param input.fetchImpl fetch (tests replace it).
 * @param input.url       The endpoint.
 * @param input.headers   The request's headers (the key among them; never logged).
 * @param input.body      The JSON body.
 * @param input.signal    Aborts the request.
 * @param input.provider  Who is asked (for the error).
 * @returns The response, with a body.
 * @throws ProviderError('http') for a non-2xx status (the body is released unread), ProviderError('no_body').
 * Called from: server/groq.ts, server/openai.ts, server/gemini.ts
 */
export async function postJson(input: {
  /** fetch (tests replace it). */
  fetchImpl?: typeof fetch | undefined;
  /** The endpoint. */
  url: string;
  /** The request's headers. */
  headers: Record<string, string>;
  /** The JSON body. */
  body: unknown;
  /** Aborts the request. */
  signal: AbortSignal;
  /** Who is asked. */
  provider: Exclude<AnswerProvider, 'claude'>;
}): Promise<Response & { body: ResponseBody }> {
  const response = await (input.fetchImpl ?? fetch)(input.url, {
    method: 'POST',
    headers: { ...input.headers, 'content-type': 'application/json' },
    body: JSON.stringify(input.body),
    signal: input.signal,
  });
  if (!response.ok) {
    // The body may echo the request: never read into a log, just released.
    void response.body?.cancel().catch(() => undefined);
    throw new ProviderError(input.provider, 'http', response.status);
  }
  if (!response.body) throw new ProviderError(input.provider, 'no_body', response.status);
  return response as Response & { body: ResponseBody };
}

/** A fetch response body (the stream the providers answer with). */
export type ResponseBody = NonNullable<Response['body']>;

/** Why an answer moved from a third-party provider to Claude Haiku (ADR-0095, ADR-0099). */
export type FallbackReason = 'timeout' | 'error' | 'empty';

/** Options for withFirstTokenFallback(). */
export interface FirstTokenFallbackOptions {
  /** How long the first source has to send its first text, in ms (FIRST_TOKEN_MS). */
  firstTokenMs: number;
  /** The request's own signal: when it aborts (browser gone, time limit), there is no fallback. */
  signal?: AbortSignal;
  /**
   * Called once when the fallback starts, with why and the error (if any) the first source gave.
   *
   * @param reason Why.
   * @param error  What the first source threw, if anything.
   */
  onFallback: (reason: FallbackReason, error?: unknown) => void;
}

/**
 * Streams from `primary` (the third-party provider) and, when it fails before its first piece of text, or
 * sends none within `firstTokenMs`, or ends with no text at all, streams the same answer from `fallback`
 * (Claude Haiku) instead. Once the first text has arrived the answer stays on the primary: words already shown
 * cannot be taken back, so a later error is an error, as with Claude.
 *
 * @param primary  Starts the first source with its own abort signal.
 * @param fallback Starts the fallback source.
 * @param options  The time limit, the request's signal and the fallback callback.
 * @returns The answer's text pieces, finishing with the result of whichever source answered.
 * @throws What the fallback throws; the primary's error when the request itself was aborted.
 * Called from: app/api/answer/route.ts; tests
 */
export async function* withFirstTokenFallback<R>(
  primary: (signal: AbortSignal) => AsyncGenerator<string, R, undefined>,
  fallback: () => AsyncGenerator<string, R, undefined>,
  options: FirstTokenFallbackOptions,
): AsyncGenerator<string, R, undefined> {
  const stopPrimary = new AbortController();
  const source = primary(stopPrimary.signal);
  const pending = source.next();
  // The pending read may reject after it has been given up on (aborted below): never unhandled.
  pending.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), options.firstTokenMs);
  });
  let reason: FallbackReason | null = null;
  let failure: unknown;
  let first: IteratorResult<string, R> | null = null;
  try {
    const winner = await Promise.race([pending, timeout]);
    if (winner === 'timeout') reason = 'timeout';
    else if (winner.done) reason = 'empty';
    else first = winner;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    reason = 'error';
    failure = error;
  } finally {
    clearTimeout(timer);
  }
  if (reason !== null || first === null) {
    stopPrimary.abort();
    if (options.signal?.aborted) throw options.signal.reason;
    options.onFallback(reason ?? 'empty', failure);
    return yield* fallback();
  }
  yield first.value as string;
  // The rest of the primary; yield* forwards an early stop, so its own finally aborts the request.
  return yield* source;
}
