/**
 * Tests for apps/web/src/server/claude.ts, with the Anthropic SDK's messages.stream() and
 * messages.create() faked: streamReply() sends a cached system block (or the given blocks) with
 * thinking off for the tier, yields only text, returns usage with null cache counts as 0, and
 * aborts the Claude request when the caller stops early; warmCache() sends max_tokens 0 without
 * streaming, with the answers' thinking setting, and returns the cache usage; thinkingFor() turns
 * thinking off in the way each model accepts; jsonReply() asks for structured output with the
 * given schema and the tier's thinking setting, parses the reply, and throws NO_JSON without text;
 * ADR-0121: jsonReply() checks the stop reason: a cut-off reply throws ReplyCutOffError, or with
 * keepCutOff returns its complete part with cutOff true; a refusal throws ReplyRefusedError;
 * textReply() (ADR-0116) asks for plain text and returns a reply cut off at the token limit, with
 * its stop reason, instead of throwing;
 * describeClaudeError() maps SDK errors to Kite error codes without leaking API text, and maps
 * the usage limit (HTTP 400, or billing_error) and an overload (529, or overloaded_error in the
 * stream) to claude_unavailable with the fixed message; a per-minute rate limit stays
 * upstream_error.
 */
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_UNAVAILABLE_MESSAGES } from '@kite/shared';
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

const {
  cachedBlock,
  describeClaudeError,
  jsonReply,
  ReplyCutOffError,
  ReplyRefusedError,
  streamReply,
  textReply,
  thinkingFor,
  warmCache,
} = await import('@/server/claude');

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

describe('jsonReply', () => {
  /** Standard input. */
  const JSON_INPUT = {
    model: 'claude-sonnet-5-5',
    tier: 'smart' as const,
    system: 'RUBRIC',
    prompt: 'GRADE THIS',
    schema: { type: 'object' },
    maxTokens: 300,
  };

  it('asks for structured output and parses the reply', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"facts":3}' }],
      usage: { input_tokens: 50, output_tokens: 9 },
    });
    const result = await jsonReply(JSON_INPUT);
    expect(createMock.mock.calls[0]![0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 300,
      thinking: { type: 'between_tools' },
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
      messages: [{ role: 'user', content: 'GRADE THIS' }],
    });
    expect(result.value).toEqual({ facts: 3 });
    expect(result.usage.cache_read_input_tokens).toBe(0);
  });

  it('throws NO_JSON when the reply has no text', async () => {
    createMock.mockResolvedValue({ content: [], usage: { input_tokens: 1, output_tokens: 0 } });
    await expect(jsonReply(JSON_INPUT)).rejects.toThrow('NO_JSON');
  });

  it('ADR-0121: returns the stop reason and cutOff false for a whole reply', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"facts":3}' }],
      usage: { input_tokens: 50, output_tokens: 9 },
      stop_reason: 'end_turn',
    });
    const result = await jsonReply(JSON_INPUT);
    expect(result).toMatchObject({ stopReason: 'end_turn', cutOff: false });
  });

  it('ADR-0121: a cut-off reply throws ReplyCutOffError (with its token count) unless asked to keep it', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"summary":["one","tw' }],
      usage: { input_tokens: 50, output_tokens: 300 },
      stop_reason: 'max_tokens',
    });
    const error = await jsonReply(JSON_INPUT).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReplyCutOffError);
    expect((error as InstanceType<typeof ReplyCutOffError>).outputTokens).toBe(300);
  });

  it('ADR-0121: with keepCutOff, a cut-off reply keeps its complete part', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"summary":["one","tw' }],
      usage: { input_tokens: 50, output_tokens: 300 },
      stop_reason: 'max_tokens',
    });
    const result = await jsonReply({ ...JSON_INPUT, keepCutOff: true });
    expect(result).toMatchObject({
      value: { summary: ['one'] },
      stopReason: 'max_tokens',
      cutOff: true,
    });
  });

  it('ADR-0121: with keepCutOff, a cut in the first key gives an empty object; an empty reply throws', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"summ' }],
      usage: { input_tokens: 50, output_tokens: 300 },
      stop_reason: 'max_tokens',
    });
    // '{"summ' reads as {} (an object with nothing complete): nothing usable, but not undefined either.
    const result = await jsonReply({ ...JSON_INPUT, keepCutOff: true }).catch(
      (caught: unknown) => caught,
    );
    expect(result).toMatchObject({ value: {}, cutOff: true });
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '' }],
      usage: { input_tokens: 50, output_tokens: 300 },
      stop_reason: 'max_tokens',
    });
    await expect(jsonReply({ ...JSON_INPUT, keepCutOff: true })).rejects.toBeInstanceOf(
      ReplyCutOffError,
    );
  });

  it('ADR-0121: a refusal throws ReplyRefusedError', async () => {
    createMock.mockResolvedValue({
      content: [],
      usage: { input_tokens: 50, output_tokens: 0 },
      stop_reason: 'refusal',
    });
    await expect(jsonReply(JSON_INPUT)).rejects.toBeInstanceOf(ReplyRefusedError);
  });
});

describe('textReply (ADR-0116)', () => {
  /** Standard input. */
  const TEXT_INPUT = {
    model: 'claude-haiku-5-5',
    tier: 'fast' as const,
    system: 'SUMMARY RULES',
    prompt: 'SUMMARISE THIS',
    maxTokens: 5_000,
    timeoutMs: 100_000,
  };

  it('asks for plain text (no output format), cached rules, thinking off, and the time limit', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '## a.txt\n- One.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 9 },
    });
    const result = await textReply(TEXT_INPUT);
    const [params, options] = createMock.mock.calls[0]!;
    expect(params).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 5_000,
      system: [{ type: 'text', text: 'SUMMARY RULES', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'SUMMARISE THIS' }],
      thinking: { type: 'disabled' },
    });
    expect(options).toEqual({ timeout: 100_000 });
    expect(result).toEqual({
      text: '## a.txt\n- One.',
      stopReason: 'end_turn',
      usage: {
        input_tokens: 50,
        output_tokens: 9,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
  });

  it('returns a reply cut off at the token limit instead of throwing', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '## a.txt\n- One.\n- Tw' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 50, output_tokens: 5_000 },
    });
    const result = await textReply(TEXT_INPUT);
    expect(result.text).toBe('## a.txt\n- One.\n- Tw');
    expect(result.stopReason).toBe('max_tokens');
  });

  it("gives '' for a reply with no text (a refusal)", async () => {
    createMock.mockResolvedValue({
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 50, output_tokens: 0 },
    });
    expect(await textReply(TEXT_INPUT)).toMatchObject({ text: '', stopReason: 'refusal' });
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

  it('ADR-0121: maps a cut-off reply to "cut_off" and a refusal to "refused"', () => {
    expect(describeClaudeError(new ReplyCutOffError(8000)).code).toBe('cut_off');
    expect(describeClaudeError(new ReplyRefusedError()).code).toBe('refused');
  });

  it('maps anything else to "internal"', () => {
    expect(describeClaudeError(new Error('boom')).code).toBe('internal');
  });

  it('maps the usage limit (as the API sent it on 2026-10-30) to "claude_unavailable"', () => {
    const body = {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.',
      },
    };
    const error = Anthropic.APIError.generate(400, body, undefined, new Headers());
    expect(describeClaudeError(error)).toEqual({
      code: 'claude_unavailable',
      message: CLAUDE_UNAVAILABLE_MESSAGES.usageLimit,
    });
    // The date and Anthropic's wording are not forwarded.
    expect(describeClaudeError(error).message).not.toContain('2026-11-01');
    const billing = Anthropic.APIError.generate(
      400,
      { type: 'error', error: { type: 'billing_error', message: 'x' } },
      undefined,
      new Headers(),
    );
    expect(describeClaudeError(billing).message).toBe(CLAUDE_UNAVAILABLE_MESSAGES.usageLimit);
  });

  it('maps an overload (529, or an overloaded_error event mid-stream) to "claude_unavailable"', () => {
    const body = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };
    const http = Anthropic.APIError.generate(529, body, undefined, new Headers());
    expect(describeClaudeError(http)).toEqual({
      code: 'claude_unavailable',
      message: CLAUDE_UNAVAILABLE_MESSAGES.overloaded,
    });
    // In a stream the SDK throws an APIError with no status and the event's body.
    const midStream = new Anthropic.APIError(undefined, body, undefined, new Headers());
    expect(describeClaudeError(midStream).message).toBe(CLAUDE_UNAVAILABLE_MESSAGES.overloaded);
  });

  it('keeps a per-minute rate limit and other 400s as "upstream_error"', () => {
    const rate = Anthropic.APIError.generate(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests' } },
      undefined,
      new Headers(),
    );
    expect(describeClaudeError(rate).code).toBe('upstream_error');
    const bad = Anthropic.APIError.generate(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too big' } },
      undefined,
      new Headers(),
    );
    expect(describeClaudeError(bad).code).toBe('upstream_error');
  });
});
