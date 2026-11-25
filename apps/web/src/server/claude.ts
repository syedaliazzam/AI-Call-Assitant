/**
 * File: apps/web/src/server/claude.ts
 * Purpose: The ONLY place Kite talks to the Claude API. Holds one SDK client; streamReply(),
 *          which streams a reply as text pieces and finishes with the token usage; and
 *          warmCache(), which writes the prompt cache for a session without answering (Day 3);
 *          and jsonReply(), a non-streaming reply in a fixed JSON shape (structured outputs),
 *          used by the call notes (Day 5) and the evaluations' graders; textReply(), a non-streaming
 *          plain-text reply that survives being cut off, used by the documents summary (ADR-0067,
 *          plain text since ADR-0116); and countInputTokens(), the free token count a measurement
 *          uses (ADR-0067).
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
import { readJsonPrefix } from './jsonPrefix';

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
  /**
   * ADR-0121: true to keep the complete part of a reply cut off at maxTokens (readJsonPrefix()) instead
   * of throwing ReplyCutOffError. The call notes set it; the graders do not (half a grade is no grade).
   */
  keepCutOff?: boolean;
}

/** What jsonReply() returns. */
export interface JsonReplyResult {
  /**
   * The parsed JSON value. When `cutOff` is true it holds only the values completed before the cut
   * (readJsonPrefix()), so required fields may be missing: the caller checks its shape. Never logged.
   */
  value: unknown;
  /** Token counts. */
  usage: AnswerUsage;
  /** Why Claude stopped ('end_turn' normally; 'max_tokens' when cut off). */
  stopReason: Anthropic.StopReason | null;
  /** ADR-0121: true when the reply reached maxTokens and `value` is its complete part only. */
  cutOff: boolean;
}

/**
 * ADR-0121: a reply reached its output-token limit and nothing usable came before the cut (or the caller
 * did not ask to keep a cut-off reply). Sending the same request again would be cut off the same way, so
 * callers must not retry it. Carries counts only, never text.
 */
export class ReplyCutOffError extends Error {
  /**
   * @param outputTokens How many tokens the reply used (its limit), for the log.
   */
  constructor(readonly outputTokens: number) {
    super('REPLY_CUT_OFF');
    this.name = 'ReplyCutOffError';
  }
}

/**
 * ADR-0121: Claude declined to write the reply (stop reason 'refusal'). The same request would be declined
 * again, so callers must not retry it.
 */
export class ReplyRefusedError extends Error {
  /** Creates the error (no details: a refusal carries nothing worth logging). */
  constructor() {
    super('REPLY_REFUSED');
    this.name = 'ReplyRefusedError';
  }
}

/**
 * Asks Claude for a reply in a fixed JSON shape, using structured outputs
 * (`output_config.format` with a JSON schema), not streamed.
 *
 * ADR-0121: the stop reason is checked before the text is parsed. A reply cut off at maxTokens is not
 * whole JSON: with `keepCutOff` its complete part is returned (`cutOff: true`); otherwise, or when nothing
 * complete came before the cut, ReplyCutOffError is thrown. A refusal throws ReplyRefusedError. Before,
 * a cut-off reply threw a SyntaxError that became a generic 'internal' failure, and the after-call runner
 * paid for the same request three times.
 *
 * @param input See JsonReplyInput.
 * @returns The parsed JSON value, the token usage, the stop reason and whether it was cut off.
 * @throws Anthropic.APIError for API failures; ReplyCutOffError (see above); ReplyRefusedError;
 *         Error('NO_JSON') when a finished reply has no text.
 * Called from: scripts/eval-answers.ts and scripts/eval-notes.ts (the graders);
 *              src/server/notes.ts (the call notes, Day 5; keepCutOff since ADR-0121). Not the documents
 *              summary, which is plain text (textReply(), ADR-0116).
 */
export async function jsonReply(input: JsonReplyInput): Promise<JsonReplyResult> {
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
  const usage = toAnswerUsage(message.usage);
  const stopReason = message.stop_reason;
  if (stopReason === 'refusal') throw new ReplyRefusedError();
  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  if (stopReason === 'max_tokens') {
    const value = input.keepCutOff ? readJsonPrefix(text) : undefined;
    if (value === undefined || value === null) throw new ReplyCutOffError(usage.output_tokens);
    return { value, usage, stopReason, cutOff: true };
  }
  if (!text) throw new Error('NO_JSON');
  return { value: JSON.parse(text) as unknown, usage, stopReason, cutOff: false };
}

/** Input for textReply(). */
export interface TextReplyInput {
  /** Full model name. */
  model: string;
  /** Which tier that model is (thinking setting). */
  tier: ModelTier;
  /** System prompt: a string, sent as one cached block. */
  system: string;
  /** The user turn. */
  prompt: string;
  /** Time limit for this request, in ms (default CLAUDE_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Most tokens Claude may write. */
  maxTokens: number;
}

/** What textReply() returns. */
export interface TextReplyResult {
  /** The reply's text blocks joined ('' when there are none, for example a refusal). Never logged. */
  text: string;
  /** Token counts. */
  usage: AnswerUsage;
  /**
   * Why Claude stopped. 'max_tokens' means the text was cut off at input.maxTokens; the caller
   * decides whether a cut-off reply is still usable.
   */
  stopReason: Anthropic.StopReason | null;
}

/**
 * Asks Claude for a plain-text reply, not streamed. Unlike jsonReply() nothing has to parse, so a
 * reply cut off at the token limit is still returned (with stopReason 'max_tokens') instead of
 * failing (ADR-0116).
 *
 * @param input See TextReplyInput.
 * @returns The reply text, the token usage and the stop reason. Never throws for a cut-off or empty
 *          reply.
 * @throws Anthropic.APIError for API failures.
 * Called from: src/server/summary.ts (the documents summary, ADR-0116)
 */
export async function textReply(input: TextReplyInput): Promise<TextReplyResult> {
  const message = await getClaude().messages.create(
    {
      model: input.model,
      max_tokens: input.maxTokens,
      system: [cachedBlock(input.system)],
      messages: [{ role: 'user', content: input.prompt }],
      thinking: thinkingFor(input.tier),
    },
    { timeout: input.timeoutMs ?? CLAUDE_TIMEOUT_MS },
  );
  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  return { text, usage: toAnswerUsage(message.usage), stopReason: message.stop_reason };
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
  // ADR-0121: a reply that would end the same way if asked again (callers must not retry these codes).
  if (error instanceof ReplyCutOffError) {
    return {
      code: 'cut_off',
      message: 'The reply was too long and stopped before anything usable.',
    };
  }
  if (error instanceof ReplyRefusedError) {
    return { code: 'refused', message: 'Claude declined to write this.' };
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
