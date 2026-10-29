/**
 * Tests for apps/web/src/server/claude.ts, with the Anthropic SDK's messages.stream() and
 * messages.create() faked: streamReply() sends a cached system block (or the given blocks) with
 * thinking off for the tier, yields only text, returns usage with null cache counts as 0, and
 * aborts the Claude request when the caller stops early; warmCache() sends max_tokens 0 without
 * streaming, with the answers' thinking setting, and returns the cache usage; thinkingFor() turns
 * thinking off in the way each model accepts;
 * describeClaudeError() maps SDK errors to Kite error codes without leaking API text.
 */
import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMessageStream } from '../../helpers/fakeClaude';

/** Spy standing in for client.messages.stream(). */
const streamMock = vi.fn();
/** Spy standing in for client.messages.create() (the warm-up). */
const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  // Subclass the real client so its static error classes (APIError, …) stay real for instanceof.
  class FakeAnthropic extends actual.default {
    override messages = {
      stream: streamMock,
      create: createMock,
    } as unknown as Anthropic['messages'];
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});

vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('KITE_MODEL_FAST', 'claude-haiku-5-5');
vi.stubEnv('KITE_MODEL_SMART', 'claude-sonnet-5-5');

const { cachedBlock, describeClaudeError, streamReply, thinkingFor, warmCache } =
  await import('@/server/claude');

/**
 * Reads a whole streamReply() generator.
 *
 * @param generator The generator under test.
 * @returns The text pieces it yielded and the value it returned.
 */
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
  createMock.mockReset();
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

describe('streamReply with prompt blocks', () => {
  it('sends ready-made system blocks as they are, with the smart tier thinking setting', async () => {
    streamMock.mockReturnValue(fakeMessageStream());
    const system = [cachedBlock('RULES'), cachedBlock('SESSION')];
    await collect(streamReply({ ...INPUT, model: 'claude-sonnet-5-5', tier: 'smart', system }));
    const [params] = streamMock.mock.calls[0]!;
    expect(params.system).toBe(system);
    expect(params.thinking).toEqual({ type: 'between_tools' });
  });
});

describe('thinkingFor', () => {
  it('turns thinking off: disabled for Haiku (fast), between_tools for Sonnet (smart)', () => {
    expect(thinkingFor('fast')).toEqual({ type: 'disabled' });
    expect(thinkingFor('smart')).toEqual({ type: 'between_tools' });
  });
});

describe('warmCache', () => {
  /** Standard warm-up input. */
  const WARM = {
    model: 'claude-haiku-5-5',
    tier: 'fast' as const,
    system: [cachedBlock('RULES'), cachedBlock('SESSION')],
    messages: [{ role: 'user' as const, content: 'Warm-up' }],
  };

  it('sends max_tokens 0 without streaming, with the answers thinking setting', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 1800 },
    });
    const signal = new AbortController().signal;
    const result = await warmCache({ ...WARM, signal });

    expect(createMock).toHaveBeenCalledWith(
      {
        model: 'claude-haiku-5-5',
        max_tokens: 0,
        system: WARM.system,
        messages: WARM.messages,
        thinking: { type: 'disabled' },
      },
      { signal },
    );
    // The official docs reject max_tokens 0 with stream: true.
    expect(createMock.mock.calls[0]![0]).not.toHaveProperty('stream');
    expect(result).toEqual({
      usage: {
        input_tokens: 5,
        output_tokens: 0,
        cache_creation_input_tokens: 1800,
        cache_read_input_tokens: 0,
      },
      stopReason: 'max_tokens',
    });
  });

  it('passes API errors through to the caller', async () => {
    const error = new Anthropic.APIError(400, undefined, 'bad', new Headers());
    createMock.mockRejectedValue(error);
    await expect(warmCache(WARM)).rejects.toBe(error);
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
