/**
 * Tests for apps/web/src/server/claude.ts, with the Anthropic SDK's messages.stream() faked:
 * streamReply() sends a cached system block with thinking off, yields only text, returns usage
 * with null cache counts as 0, and aborts the Claude request when the caller stops early;
 * describeClaudeError() maps SDK errors to Kite error codes without leaking API text.
 */
import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMessageStream } from '../../helpers/fakeClaude';

/** Spy standing in for client.messages.stream(). */
const streamMock = vi.fn();

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  // Subclass the real client so its static error classes (APIError, …) stay real for instanceof.
  class FakeAnthropic extends actual.default {
    override messages = { stream: streamMock } as unknown as Anthropic['messages'];
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});

vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('KITE_MODEL_FAST', 'claude-haiku-5-5');
vi.stubEnv('KITE_MODEL_SMART', 'claude-sonnet-5-5');

const { describeClaudeError, streamReply } = await import('@/server/claude');

/** Reads a whole streamReply() generator. */
async function collect(generator: AsyncGenerator<string, unknown>) {
  const pieces: string[] = [];
  let next = await generator.next();
  while (!next.done) {
    pieces.push(next.value);
    next = await generator.next();
  }
  return { pieces, result: next.value };
}

/** Standard input for streamReply(). */
const INPUT = {
  model: 'claude-haiku-5-5',
  system: 'SYSTEM PROMPT',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 200,
};

beforeEach(() => {
  streamMock.mockReset();
});

describe('streamReply', () => {
  it('sends the system prompt as one cached block, with thinking turned off', async () => {
    streamMock.mockReturnValue(fakeMessageStream());
    const signal = new AbortController().signal;
    await collect(streamReply({ ...INPUT, signal }));

    expect(streamMock).toHaveBeenCalledWith(
      {
        model: 'claude-haiku-5-5',
        max_tokens: 200,
        system: [{ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }],
        messages: INPUT.messages,
        thinking: { type: 'disabled' },
      },
      { signal },
    );
  });

  it('yields only the text pieces, then returns usage with null cache counts as 0', async () => {
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['Hi', ' there'] }));
    const { pieces, result } = await collect(streamReply(INPUT));

    expect(pieces).toEqual(['Hi', ' there']);
    expect(result).toEqual({
      usage: {
        input_tokens: 40,
        output_tokens: 12,
        cache_creation_input_tokens: 1100,
        cache_read_input_tokens: 0,
      },
      stopReason: 'end_turn',
    });
  });

  it('calls onStreamOpen once Claude responds, before the first text piece', async () => {
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['a'] }));
    const order: string[] = [];
    const generator = streamReply({ ...INPUT, onStreamOpen: () => order.push('open') });
    const first = await generator.next();
    order.push(`text:${String(first.value)}`);
    expect(order).toEqual(['open', 'text:a']);
  });

  it('aborts the Claude request when the caller stops reading early', async () => {
    const fake = fakeMessageStream({ pieces: ['a', 'b', 'c'] });
    streamMock.mockReturnValue(fake);
    const generator = streamReply(INPUT);

    await generator.next(); // first piece
    await generator.return(undefined as never);

    expect(fake.abort).toHaveBeenCalledTimes(1);
  });

  it('does not abort a reply that finished normally', async () => {
    const fake = fakeMessageStream();
    streamMock.mockReturnValue(fake);
    await collect(streamReply(INPUT));
    expect(fake.abort).not.toHaveBeenCalled();
  });

  it('passes API errors through to the caller', async () => {
    const error = new Anthropic.APIError(500, undefined, 'server error', new Headers());
    streamMock.mockReturnValue(fakeMessageStream({ pieces: ['a'], error }));
    await expect(collect(streamReply(INPUT))).rejects.toBe(error);
  });
});

describe('describeClaudeError', () => {
  it('maps a timeout to "timeout"', () => {
    expect(describeClaudeError(new Anthropic.APIConnectionTimeoutError()).code).toBe('timeout');
  });

  it('maps an abort to "timeout"', () => {
    expect(describeClaudeError(new Anthropic.APIUserAbortError()).code).toBe('timeout');
  });

  it('maps API errors to "upstream_error" without forwarding their text', () => {
    const error = new Anthropic.APIError(
      400,
      undefined,
      'secret details from upstream',
      new Headers(),
    );
    const described = describeClaudeError(error);
    expect(described.code).toBe('upstream_error');
    expect(described.message).not.toContain('secret details');
  });

  it('maps anything else to "internal"', () => {
    expect(describeClaudeError(new Error('boom')).code).toBe('internal');
  });
});
