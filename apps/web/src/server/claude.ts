/**
 * File: apps/web/src/server/claude.ts
 * Purpose: The ONLY place Kite talks to the Claude API. Holds one SDK client and streamReply(),
 *          which streams a reply as text pieces and finishes with the token usage.
 * Used by: app/api/answer/route.ts (and app/api/notes/route.ts, Day 5)
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
import type { AnswerErrorCode, AnswerUsage } from '@kite/shared';
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

/** Input for streamReply(). */
export interface StreamReplyInput {
  /** Full model name, for example 'claude-haiku-5-5' (from KITE_MODEL_FAST / KITE_MODEL_SMART). */
  model: string;
  /** System prompt. Sent as one cached block, so keep it identical between requests. */
  system: string;
  /** Conversation turns after the system prompt (not cached). */
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
 * Thinking is turned off: live answers need the first word fast, and a one-sentence reply
 * gains nothing from it. `{ type: 'disabled' }` is valid on claude-haiku-5-5 at its default
 * effort. Day 5 (notes on claude-sonnet-5-5) must change this: Sonnet 5.5 rejects 'disabled'.
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
      system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
      messages: input.messages,
      thinking: { type: 'disabled' },
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

/**
 * Turns an error from streamReply() into a code and a safe message for the browser.
 * Messages never include request content; API error text from Anthropic is not forwarded.
 *
 * @param error What was thrown.
 * @returns The error code and a short message.
 * Called from: app/api/answer/route.ts (error event and logging)
 */
export function describeClaudeError(error: unknown): { code: AnswerErrorCode; message: string } {
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
