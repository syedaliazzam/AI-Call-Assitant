/**
 * File: apps/web/src/server/claude.ts
 * Purpose: The ONLY place Kite talks to the Claude API. Holds one SDK client; streamReply(),
 *          which streams a reply as text pieces and finishes with the token usage; and
 *          warmCache(), which writes the prompt cache for a session without answering (Day 3);
 *          and jsonReply(), a non-streaming reply in a fixed JSON shape (structured outputs),
 *          used by the call notes (Day 5), the documents summary (ADR-0067) and the evaluations'
 *          graders; and countInputTokens(), the free token count a measurement uses (ADR-0067).
 * Used by: app/api/answer/route.ts, src/server/prompt.ts (cachedBlock); app/api/notes/route.ts
 *          (Day 5); scripts/verify-warm.ts, scripts/verify-answer-cache.ts,
 *          scripts/eval-answers.ts (developer-only)
 * Depends on: @anthropic-ai/sdk, src/server/env.ts (ANTHROPIC_API_KEY)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (prompt caching), §7.2 (server rules)
 *
 * Prompt caching, in short:
 * - The system block is marked `cache_control: { type: 'ephemeral' }`. Claude stores everything
 *   up to that marker, and a later request whose prefix is byte-for-byte IDENTICAL reads it from
 *   the cache instead (cheaper, and faster to the first word).
 * - Any change in the prefix (one character, a timestamp, a different model) is a cache miss.
 * - A cache entry lives 5 minutes, renewed each time it is read.
 * - Prefixes shorter than the model's minimum are silently not cached (512 tokens on
 *   claude-haiku-5-5); the usage then shows cache_creation_input_tokens = 0.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  CLAUDE_UNAVAILABLE_MESSAGES,
  type AnswerErrorCode,
  type AnswerUsage,
  type ModelTier,
} from '@kite/shared';
import { getClaudeEnv } from './env';

/** Server time limit for one Claude reply (architecture §7.2: "Set a 60 s timeout"). */
export const CLAUDE_TIMEOUT_MS = 60_000;

/** The shared SDK client, created on first use (so routes that never call Claude need no key). */
let client: Anthropic | undefined;

/**
 * Returns the one Anthropic SDK client for this server process.
 * maxRetries is 1: the SDK only retries before any reply text has arrived (connection errors,
 * 429, 5xx), never mid-stream, and one retry keeps the worst case close to the time limit.
 *
 * @returns The SDK client.
 * @throws Error naming ANTHROPIC_API_KEY (or the model variables) when they are missing.
 * Called from: streamReply()
 */
export function getClaude(): Anthropic {
  client ??= new Anthropic({
    apiKey: getClaudeEnv().apiKey,
    timeout: CLAUDE_TIMEOUT_MS,
    maxRetries: 1,
  });
  return client;
}

/**
 * The thinking setting for each model tier. Thinking is off: live answers need the first word
 * fast, and a short answer gains little from it. The two models turn it off differently:
 * claude-haiku-5-5 accepts `{ type: 'disabled' }`; claude-sonnet-5-5 rejects that with a 400 and
 * uses `{ type: 'between_tools' }` instead (thinking only between tool calls, and Kite uses no
 * tools). The warm-up must send the same setting as the answers, because it is part of the
 * cached prompt: a different setting would write a cache entry the answers never read.
 *
 * @param tier The model tier the request uses.
 * @returns The `thinking` request parameter.
 * Called from: streamReply(), warmCache()
 */
export function thinkingFor(tier: ModelTier): Anthropic.ThinkingConfigParam {
  return tier === 'smart' ? { type: 'between_tools' } : { type: 'disabled' };
}

/**
 * Wraps a system prompt as one text block with a cache breakpoint.
 *
 * @param text The block's text. Keep it byte-for-byte identical between requests.
 * @returns The block, marked `cache_control: { type: 'ephemeral' }` (5-minute cache).
 * Called from: streamReply() (a plain-string system prompt); server/prompt.ts (buildPrompt)
 */
export function cachedBlock(text: string): Anthropic.TextBlockParam {
  return { type: 'text', text, cache_control: { type: 'ephemeral' } };
}

/** Input for streamReply(). */
export interface StreamReplyInput {
  /** Full model name, for example 'claude-haiku-5-5' (from KITE_MODEL_FAST / KITE_MODEL_SMART). */
  model: string;
  /** Which tier that model is; picks the thinking setting (default 'fast'). */
  tier?: ModelTier;
  /**
   * System prompt: a string (sent as one cached block) or ready-made blocks from buildPrompt()
   * (each carrying its own cache breakpoint). Keep it identical between requests.
   */
  system: string | Anthropic.TextBlockParam[];
  /**
   * The user turn after the system prompt. Its blocks may carry their own cache breakpoint (the
   * last conversation chunk, from buildPrompt()); the rest is not cached.
   */
  messages: Anthropic.MessageParam[];
  /** Most tokens Claude may write. */
  maxTokens: number;
  /** Aborts the request (client disconnected, or the server time limit passed). */
  signal?: AbortSignal;
  /**
   * Called once when Claude's streaming response opens (HTTP response headers received),
   * before any text. Used to split server timings into "reaching Claude" and "Claude's
   * time to first token".
   */
  onStreamOpen?: () => void;
}

/** What streamReply() returns once the reply is complete. */
export interface ReplyResult {
  /** Token counts, with null cache counts turned into 0. */
  usage: AnswerUsage;
  /** Why Claude stopped, for example 'end_turn', 'max_tokens' or 'refusal'. */
  stopReason: Anthropic.StopReason | null;
}

/**
 * Converts the SDK's usage object into Kite's AnswerUsage (cache counts may be null).
 *
 * @param usage Usage from the final message.
 * @returns Usage with every count as a number.
 * Called from: streamReply()
 */
function toAnswerUsage(usage: Anthropic.Usage): AnswerUsage {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
  };
}

/**
 * Streams a Claude reply. Yields each piece of answer text as it arrives; when the reply is
 * complete, returns the token usage and stop reason (the generator's return value).
 * If the caller stops reading early (for example the browser disconnected), the request to
 * Claude is aborted so no more tokens are generated or billed.
 *
 * Thinking is turned off for the tier (see thinkingFor()).
 *
 * @param input See StreamReplyInput.
 * @returns An async generator of text pieces that finishes with a ReplyResult.
 * @throws Anthropic.APIError (and subclasses) for API failures; APIUserAbortError on abort.
 * Called from: POST handler in app/api/answer/route.ts
 */
export async function* streamReply(
  input: StreamReplyInput,
): AsyncGenerator<string, ReplyResult, undefined> {
  const stream = getClaude().messages.stream(
    {
      model: input.model,
      max_tokens: input.maxTokens,
      system: typeof input.system === 'string' ? [cachedBlock(input.system)] : input.system,
      messages: input.messages,
      thinking: thinkingFor(input.tier ?? 'fast'),
    },
    { signal: input.signal },
  );
  // The SDK emits 'connect' when the HTTP response from Claude arrives (headers received).
  if (input.onStreamOpen) stream.on('connect', input.onStreamOpen);

  let finished = false;
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
    const final = await stream.finalMessage();
    finished = true;
    return { usage: toAnswerUsage(final.usage), stopReason: final.stop_reason };
  } finally {
    // Runs when the consumer stops early (generator.return()) or an error escapes.
    if (!finished) stream.abort();
  }
}

/** Input for warmCache(). */
export interface WarmCacheInput {
  /** Full model name; must be the model the answers will use (the cache is per model). */
  model: string;
  /** Which tier that model is; picks the same thinking setting the answers use. */
  tier: ModelTier;
  /** The cached system blocks from buildPrompt(), exactly as the answers will send them. */
  system: Anthropic.TextBlockParam[];
  /** A placeholder user turn (read while the cache is written, never answered). */
  messages: Anthropic.MessageParam[];
  /** Aborts the request (client disconnected, or the server time limit passed). */
  signal?: AbortSignal;
}

/**
 * Writes the prompt cache for a session without generating an answer (architecture §6.3,
 * "Pre-warm"). Uses `max_tokens: 0`, which the official prompt-caching docs allow for exactly
 * this: Claude reads the prompt, writes the cache at each `cache_control` breakpoint and
 * returns at once with no content, stop reason 'max_tokens' and full usage. No output tokens
 * are billed, only the normal cache write (or a cheap cache read when it is already warm).
 *
 * The docs reject `max_tokens: 0` together with `stream: true`, so this is a plain
 * (non-streaming) request; streaming is a transport option and not part of the cached prompt,
 * so the answers' streamed requests still read this cache entry. The `thinking` setting is part
 * of the cached prompt, so it is the same as the answers' (thinkingFor()).
 *
 * @param input See WarmCacheInput.
 * @returns Token usage (cache write or read counts) and the stop reason ('max_tokens').
 * @throws Anthropic.APIError (and subclasses) for API failures; APIUserAbortError on abort.
 * Called from: POST handler in app/api/answer/route.ts (mode 'warm')
 */
export async function warmCache(input: WarmCacheInput): Promise<ReplyResult> {
  const message = await getClaude().messages.create(
    {
      model: input.model,
      max_tokens: 0,
      system: input.system,
      messages: input.messages,
      thinking: thinkingFor(input.tier),
    },
    { signal: input.signal },
  );
  return { usage: toAnswerUsage(message.usage), stopReason: message.stop_reason };
}

/** Input for jsonReply(). */
export interface JsonReplyInput {
  /** Full model name. */
  model: string;
  /** Which tier that model is (thinking setting). */
  tier: ModelTier;
  /**
   * System prompt: a string (sent as one cached block) or ready-made blocks, each with its own
   * cache breakpoint (the notes: rules, then the session block).
   */
  system: string | Anthropic.TextBlockParam[];
  /** The user turn. */
  prompt: string;
  /**
   * Time limit for this request, in ms (default CLAUDE_TIMEOUT_MS). The notes of a long call
   * can take longer than an answer.
   */
  timeoutMs?: number;
  /** JSON schema the reply must follow (structured outputs). */
  schema: Record<string, unknown>;
  /** Most tokens Claude may write. */
  maxTokens: number;
}

/**
 * Asks Claude for a reply in a fixed JSON shape, using structured outputs
 * (`output_config.format` with a JSON schema, so the reply always parses), not streamed.
 *
 * @param input See JsonReplyInput.
 * @returns The parsed JSON value and the token usage.
 * @throws Anthropic.APIError for API failures; Error('NO_JSON') when the reply has no text
 *         (for example a refusal).
 * Called from: scripts/eval-answers.ts and scripts/eval-notes.ts (the graders);
 *              src/server/notes.ts (the call notes, Day 5)
 */
export async function jsonReply(
  input: JsonReplyInput,
): Promise<{ value: unknown; usage: AnswerUsage }> {
  const message = await getClaude().messages.create(
    {
      model: input.model,
      max_tokens: input.maxTokens,
      system: typeof input.system === 'string' ? [cachedBlock(input.system)] : input.system,
      messages: [{ role: 'user', content: input.prompt }],
      thinking: thinkingFor(input.tier),
      output_config: { format: { type: 'json_schema', schema: input.schema } },
    },
    { timeout: input.timeoutMs ?? CLAUDE_TIMEOUT_MS },
  );
  const text = message.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') throw new Error('NO_JSON');
  return { value: JSON.parse(text.text) as unknown, usage: toAnswerUsage(message.usage) };
}

/** Input for countInputTokens(). */
export interface CountTokensInput {
  /** Full model name (token counts are per model). */
  model: string;
  /** Which tier that model is (thinking setting, as the real request sends it). */
  tier: ModelTier;
  /** The system blocks, as the real request sends them. */
  system: Anthropic.TextBlockParam[];
  /** The messages, as the real request sends them. */
  messages: Anthropic.MessageParam[];
}

/**
 * Counts a prompt's input tokens without running it (the free token-counting endpoint), so a
 * measurement can price a prompt it does not send.
 *
 * @param input See CountTokensInput.
 * @returns The prompt's input tokens.
 * @throws Anthropic.APIError for API failures.
 * Called from: scripts/measure-large-docs.ts (developer-only, ADR-0067)
 */
export async function countInputTokens(input: CountTokensInput): Promise<number> {
  const result = await getClaude().messages.countTokens({
    model: input.model,
    system: input.system,
    messages: input.messages,
    thinking: thinkingFor(input.tier),
  });
  return result.input_tokens;
}

/** The `error` object inside an Anthropic error body ({ type: 'error', error: { type, message } }). */
interface ApiErrorDetail {
  /** For example 'overloaded_error' or 'invalid_request_error'. */
  type?: unknown;
  /** Anthropic's explanation. Read here to classify the error; never logged or forwarded. */
  message?: unknown;
}

/**
 * Says whether an error means Claude cannot answer for anyone right now, and why.
 * - Usage limit: the workspace's spend limit is reached. The API sends HTTP 400
 *   invalid_request_error "You have reached your specified API usage limits…" (seen on
 *   2026-10-30); a billing_error type or "credit balance is too low" is the same situation.
 * - Overloaded: HTTP 529, or an overloaded_error event in the middle of a stream (the SDK then
 *   throws an APIError with no status and the event's body).
 * A per-minute rate limit (429 rate_limit_error) is not included: it clears in seconds.
 *
 * @param error What was thrown.
 * @returns 'usageLimit', 'overloaded', or null for any other error.
 * Called from: describeClaudeError()
 */
function unavailableReason(error: unknown): keyof typeof CLAUDE_UNAVAILABLE_MESSAGES | null {
  if (!(error instanceof Anthropic.APIError) || error instanceof Anthropic.APIConnectionError) {
    return null;
  }
  const detail = ((error.error as { error?: ApiErrorDetail } | undefined)?.error ??
    {}) as ApiErrorDetail;
  const type = error.type ?? (typeof detail.type === 'string' ? detail.type : null);
  const text = typeof detail.message === 'string' ? detail.message : error.message;
  if (type === 'overloaded_error' || error.status === 529) return 'overloaded';
  if (type === 'billing_error' || /usage limit|credit balance/i.test(text)) return 'usageLimit';
  return null;
}

/**
 * Turns an error from streamReply() into a code and a safe message for the browser.
 * Messages never include request content; API error text from Anthropic is not forwarded.
 *
 * @param error What was thrown.
 * @returns The error code and a short message.
 * Called from: app/api/answer/route.ts (error event and logging)
 */
export function describeClaudeError(error: unknown): { code: AnswerErrorCode; message: string } {
  const unavailable = unavailableReason(error);
  if (unavailable) {
    return { code: 'claude_unavailable', message: CLAUDE_UNAVAILABLE_MESSAGES[unavailable] };
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { code: 'timeout', message: 'Claude took too long to answer.' };
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return { code: 'timeout', message: 'The request was stopped before Claude finished.' };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { code: 'upstream_error', message: 'Claude is busy (rate limited). Try again shortly.' };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { code: 'upstream_error', message: 'The server could not authenticate with Claude.' };
  }
  if (error instanceof Anthropic.APIError) {
    return { code: 'upstream_error', message: 'Claude returned an error.' };
  }
  return { code: 'internal', message: 'Something went wrong on the server.' };
}

/**
 * Extracts loggable details from an error (status and request id only, never content).
 *
 * @param error What was thrown.
 * @returns HTTP status and Anthropic request id when available.
 * Called from: app/api/answer/route.ts (logging)
 */
export function errorLogDetails(error: unknown): { status?: number; requestId?: string } {
  if (error instanceof Anthropic.APIError) {
    return { status: error.status, requestId: error.requestID ?? undefined };
  }
  return {};
}
