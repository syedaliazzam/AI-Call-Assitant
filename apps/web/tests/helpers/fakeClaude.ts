/**
 * File: apps/web/tests/helpers/fakeClaude.ts
 * Purpose: Test helper (not a test): a fake for the Anthropic SDK's `client.messages.stream()`,
 *          so no test ever calls the real Claude API or needs a real key (CLAUDE.md testing
 *          rules).
 * Used by: tests/unit/server/claude.test.ts, tests/unit/api/answer.route.test.ts
 * Depends on: vitest (vi.fn)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing: Claude is mocked)
 */
import { vi } from 'vitest';

/** Options for fakeMessageStream(). */
export interface FakeStreamOptions {
  /** Text pieces to emit as text_delta events, in order. */
  pieces?: string[];
  /** Usage on the final message (cache counts may be null, like the real API). */
  usage?: {
    /** Input tokens that were neither written to nor read from the prompt cache. */
    input_tokens: number;
    /** Tokens Claude generated. */
    output_tokens: number;
    /** Tokens written to the prompt cache by this request (null = not reported). */
    cache_creation_input_tokens: number | null;
    /** Tokens read from the prompt cache (null = not reported). */
    cache_read_input_tokens: number | null;
  };
  /** stop_reason on the final message. Default 'end_turn'. */
  stopReason?: string;
  /** If set, iteration throws this error after the pieces. */
  error?: unknown;
}

/** Default usage for a fake reply. */
const DEFAULT_USAGE = {
  input_tokens: 40,
  output_tokens: 12,
  cache_creation_input_tokens: 1100,
  cache_read_input_tokens: null,
};

/**
 * Builds an object that behaves like the SDK's MessageStream: async-iterable stream events,
 * on('connect'), finalMessage() and abort(). 'connect' fires when iteration starts, like the
 * real stream firing it when Claude's HTTP response arrives.
 *
 * @param options What the fake reply contains.
 * @returns The fake stream (with `abort` and `on` as vi.fn spies).
 * Called from: tests/unit/server/claude.test.ts, tests/unit/api/answer.route.test.ts
 */
export function fakeMessageStream(options: FakeStreamOptions = {}) {
  const pieces = options.pieces ?? ['Hello ', 'from ', 'Claude.'];
  const usage = options.usage ?? DEFAULT_USAGE;
  const connectListeners: (() => void)[] = [];
  const fake = {
    abort: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'connect') connectListeners.push(listener);
      return fake;
    }),
    async *[Symbol.asyncIterator]() {
      for (const listener of connectListeners) listener();
      yield { type: 'message_start' };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      for (const text of pieces) {
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
      }
      if (options.error) throw options.error;
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    },
    finalMessage: vi.fn(async () => ({
      stop_reason: options.stopReason ?? 'end_turn',
      usage,
    })),
  };
  return fake;
}
