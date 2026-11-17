/**
 * File: apps/web/src/server/groq.ts
 * Purpose: The ONLY place Kite talks to Groq, the third answer model ("Fastest (Groq)", ADR-0095). Streams a
 *          live answer through Groq's OpenAI-compatible chat completions API, from the same prompt the
 *          Claude answers use (locked contract, global prompt, user preferences, end reminder), turned into
 *          OpenAI-style messages. Also holds withFirstTokenFallback(): when Groq fails, or sends no first
 *          token within GROQ_FIRST_TOKEN_MS, the same answer is asked of Claude Haiku instead.
 * Used by: app/api/answer/route.ts
 * Depends on: the server's fetch, src/server/claude.ts (ReplyResult), @anthropic-ai/sdk (prompt types only)
 * Architecture: docs/decisions/ADR-0095-voice-mode-groq-and-move-keys.md; architecture §6, §7.2
 *
 * Plain fetch with a small server-sent-events reader, so Groq needs no extra dependency. Nothing here logs
 * prompt or answer text; errors carry an HTTP status only, never Groq's message or the key.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { ReplyResult } from './claude';

/** Groq's OpenAI-compatible chat completions endpoint. */
export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * How long Groq has to send the first answer token before the answer is asked of Claude Haiku instead, in
 * ms (ADR-0095: the developer's 4 s).
 */
export const GROQ_FIRST_TOKEN_MS = 4_000;

/** One OpenAI-style chat message (text only: answers with an image always go to Claude). */
export interface GroqMessage {
  /** Who wrote it. */
  role: 'system' | 'user' | 'assistant';
  /** Its text. Never logged. */
  content: string;
}

/**
 * A Groq failure, with the HTTP status when there was one. Groq's own error text is never kept: it may
 * echo the request.
 */
export class GroqError extends Error {
  /** HTTP status from Groq, or undefined for a broken or empty stream. */
  readonly status: number | undefined;

  /**
   * @param code   A short code for logs: 'http', 'no_body', 'stream', 'empty'.
   * @param status Groq's HTTP status, when there was one.
   */
  constructor(code: string, status?: number) {
    super(code);
    this.name = 'GroqError';
    this.status = status;
  }
}

/**
 * The text of a system prompt or message content in Claude's shape. Cache markers are Claude-only and
 * simply dropped. Image blocks never reach here (the answer route keeps image answers on Claude); any
 * other block is skipped rather than sent half-understood.
 *
 * @param content A string or Claude content blocks.
 * @returns The text, blocks joined by a blank line.
 * Called from: toGroqMessages()
 */
function textOf(content: string | readonly Anthropic.ContentBlockParam[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter((text) => text !== '')
    .join('\n\n');
}

/**
 * Turns a prompt built for Claude (server/prompt.ts buildPrompt()) into OpenAI-style messages: the system
 * blocks become one system message, in the same order (the locked contract first, then the global prompt,
 * the session, the user's preferences); each message keeps its role, its text blocks joined. So Groq gets
 * exactly the rules Claude gets, including the reminder at the end of the user turn.
 *
 * @param system   The system prompt (a string or text blocks).
 * @param messages The messages.
 * @returns The messages for Groq.
 * Called from: streamGroqReply(); tests
 */
export function toGroqMessages(
  system: string | readonly Anthropic.TextBlockParam[],
  messages: readonly Anthropic.MessageParam[],
): GroqMessage[] {
  const systemText =
    typeof system === 'string' ? system : system.map((block) => block.text).join('\n\n');
  return [
    ...(systemText ? [{ role: 'system' as const, content: systemText }] : []),
    ...messages.map((message) => ({ role: message.role, content: textOf(message.content) })),
  ];
}

/** Input for streamGroqReply(). */
export interface GroqReplyInput {
  /** Groq API key (server-only). */
  apiKey: string;
  /** Groq model id, for example 'openai/gpt-oss-120b'. */
  model: string;
  /** The system prompt, as built for Claude. */
  system: string | readonly Anthropic.TextBlockParam[];
  /** The messages, as built for Claude (text only). */
  messages: readonly Anthropic.MessageParam[];
  /** Most tokens the reply may have. */
  maxTokens: number;
  /** Aborts the request. */
  signal?: AbortSignal;
  /** Called once when Groq's response headers arrive (the "stream open" timing). */
  onStreamOpen?: () => void;
  /** fetch (tests replace it). */
  fetchImpl?: typeof fetch;
}

/** One choice in a streamed chunk. */
interface GroqChoice {
  /** The new part of the reply. */
  delta?: GroqDelta;
  /** Why the reply ended, on its last chunk. */
  finish_reason?: string | null;
}

/** The new part of a reply. */
interface GroqDelta {
  /** Answer text (never the reasoning: include_reasoning is false). */
  content?: string | null;
}

/** Groq's own extension on a chunk. */
interface GroqExtension {
  /** The usage, on the last chunk. */
  usage?: GroqUsage | null;
}

/** The parts of a streamed chat completion chunk Kite reads. */
interface GroqChunk {
  /** The chunk's choices (one). */
  choices?: GroqChoice[];
  /** Usage, on the last chunk when stream_options.include_usage is set. */
  usage?: GroqUsage | null;
  /** Groq's own extension, which also carries the usage on the last chunk. */
  x_groq?: GroqExtension | null;
}

/** Cached-token details in OpenAI's shape. */
interface GroqTokenDetails {
  /** Cached input tokens. */
  cached_tokens?: number;
}

/** Token counts in OpenAI's shape. */
interface GroqUsage {
  /** Input tokens. */
  prompt_tokens?: number;
  /** Output tokens (reasoning included). */
  completion_tokens?: number;
  /** Cached input tokens, when Groq reports them. */
  prompt_tokens_details?: GroqTokenDetails | null;
}

/**
 * Groq's finish reason in Claude's words, so the route treats both alike (a content filter is a refusal).
 *
 * @param reason OpenAI's finish_reason.
 * @returns The matching Claude stop reason, or null.
 * Called from: streamGroqReply(); tests
 */
export function toStopReason(reason: string | null | undefined): Anthropic.StopReason | null {
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return null;
}

/**
 * Streams a Groq reply. Yields each piece of answer text as it arrives; when the reply is complete,
 * returns the token usage (cache reads from Groq's cached tokens; Groq has no cache writes) and the stop
 * reason. Reasoning is set to low and left out of the reply (gpt-oss), so the first token comes quickly
 * and no thinking text can reach the answer. If the caller stops reading early, the request is aborted.
 *
 * @param input See GroqReplyInput.
 * @returns An async generator of text pieces that finishes with a ReplyResult.
 * @throws GroqError for an HTTP error, a missing body or a broken stream; the abort reason on abort.
 * Called from: app/api/answer/route.ts (through withFirstTokenFallback())
 */
export async function* streamGroqReply(
  input: GroqReplyInput,
): AsyncGenerator<string, ReplyResult, undefined> {
  const local = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, local.signal]) : local.signal;
  const response = await (input.fetchImpl ?? fetch)(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: toGroqMessages(input.system, input.messages),
      max_completion_tokens: input.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      // gpt-oss on Groq: 'low' keeps the time to the first word short; false keeps the reasoning out of
      // the reply (Groq's docs: reasoning_format is not supported for gpt-oss).
      reasoning_effort: 'low',
      include_reasoning: false,
    }),
    signal,
  });
  if (!response.ok) {
    // The body may echo the request: never read into a log, just released.
    void response.body?.cancel().catch(() => undefined);
    throw new GroqError('http', response.status);
  }
  if (!response.body) throw new GroqError('no_body', response.status);
  input.onStreamOpen?.();

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let usage: GroqUsage | null = null;
  let finish: string | null = null;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      // Server-sent events: one "data: …" line per event, events separated by a blank line.
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let chunk: GroqChunk;
        try {
          chunk = JSON.parse(data) as GroqChunk;
        } catch {
          throw new GroqError('stream', response.status);
        }
        if ((chunk as { error?: unknown }).error) throw new GroqError('stream', response.status);
        usage = chunk.usage ?? chunk.x_groq?.usage ?? usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const text = choice?.delta?.content;
        if (text) yield text;
      }
    }
    finished = true;
    return {
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      stopReason: toStopReason(finish),
    };
  } finally {
    // The consumer stopped early or an error escaped: stop Groq writing (and billing) the reply.
    if (!finished) {
      local.abort();
      void reader.cancel().catch(() => undefined);
    }
  }
}

/** Why an answer moved from Groq to Claude Haiku (ADR-0095). */
export type FallbackReason = 'timeout' | 'error' | 'empty';

/** Options for withFirstTokenFallback(). */
export interface FirstTokenFallbackOptions {
  /** How long the first source has to send its first text, in ms (GROQ_FIRST_TOKEN_MS). */
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
 * Streams from `primary` (Groq) and, when it fails before its first piece of text, or sends none within
 * `firstTokenMs`, or ends with no text at all, streams the same answer from `fallback` (Claude Haiku)
 * instead. Once the first text has arrived the answer stays on the primary: words already shown cannot be
 * taken back, so a later error is an error, as with Claude.
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
