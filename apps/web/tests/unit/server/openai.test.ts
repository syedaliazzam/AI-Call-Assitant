/**
 * Tests apps/web/src/server/openai.ts (ADR-0099): the Claude-shaped prompt becomes OpenAI messages with the same
 * rules in the same order, a screenshot as an image part; a streamed reply yields its text and finishes with the
 * usage (cached tokens as cache reads, the rest as input) and the stop reason; the request has reasoning off
 * ('none'), streaming on, the call id as prompt_cache_key and store false; an HTTP error is a ProviderError with
 * the status only; the warm-up asks for one token. fetch is faked: no network.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { OPENAI_CHAT_URL, streamOpenAIReply, toOpenAIMessages, warmOpenAI } from '@/server/openai';
import { ProviderError } from '@/server/providerStream';

/**
 * A fetch whose reply streams the given server-sent-events lines.
 *
 * @param lines  The body's lines ("data: …").
 * @param status The HTTP status.
 * @returns The fake fetch, and its calls.
 */
function sseFetch(lines: string[], status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n\n`));
        controller.close();
      },
    });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/**
 * Reads a generator to the end.
 *
 * @param source The generator.
 * @returns The pieces and the return value.
 */
async function drain<T, R>(
  source: AsyncGenerator<T, R, undefined>,
): Promise<{ items: T[]; result: R }> {
  const items: T[] = [];
  for (;;) {
    const next = await source.next();
    if (next.done) return { items, result: next.value };
    items.push(next.value);
  }
}

/** The system blocks and user turn every test sends (Claude's shape). */
const PROMPT = {
  system: [
    {
      type: 'text' as const,
      text: 'LOCKED CONTRACT',
      cache_control: { type: 'ephemeral' as const },
    },
    { type: 'text' as const, text: 'GLOBAL PROMPT' },
  ],
  messages: [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'CONVERSATION' },
        { type: 'text' as const, text: 'QUESTION + END REMINDER' },
      ],
    },
  ],
};

describe('toOpenAIMessages', () => {
  it('sends the same rules in the same order: one system message, then the turn as text', () => {
    expect(toOpenAIMessages(PROMPT.system, PROMPT.messages)).toEqual([
      { role: 'system', content: 'LOCKED CONTRACT\n\nGLOBAL PROMPT' },
      { role: 'user', content: 'CONVERSATION\n\nQUESTION + END REMINDER' },
    ]);
  });

  it('keeps a screenshot as an image part between the text parts, in order', () => {
    const messages = toOpenAIMessages('RULES', [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'CONVERSATION' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
          { type: 'text', text: 'ABOUT THE SCREENSHOT' },
        ],
      },
    ]);
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'CONVERSATION' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
        { type: 'text', text: 'ABOUT THE SCREENSHOT' },
      ],
    });
  });
});

describe('streamOpenAIReply', () => {
  it('streams the text and finishes with the usage and the stop reason', async () => {
    const { fetchImpl, calls } = sseFetch([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":12,"prompt_tokens_details":{"cached_tokens":1024}}}',
      'data: [DONE]',
    ]);
    const opened = vi.fn();
    const { items, result } = await drain(
      streamOpenAIReply({
        apiKey: 'sk-test',
        model: 'gpt-5.6-luna',
        ...PROMPT,
        maxTokens: 1500,
        cacheKey: 'call-1',
        onStreamOpen: opened,
        fetchImpl,
      }),
    );
    expect(items.join('')).toBe('Hello there');
    expect(result).toEqual({
      usage: {
        input_tokens: 176,
        output_tokens: 12,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1024,
      },
      stopReason: 'end_turn',
    });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(calls[0]!.url).toBe(OPENAI_CHAT_URL);
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      max_completion_tokens: 1500,
      reasoning_effort: 'none',
      stream: true,
      stream_options: { include_usage: true },
      prompt_cache_key: 'call-1',
      store: false,
    });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('asks for priority processing only when told to (ADR-0099 measurement)', async () => {
    const { fetchImpl, calls } = sseFetch(['data: {"choices":[{"delta":{"content":"x"}}]}']);
    await drain(
      streamOpenAIReply({
        apiKey: 'k',
        model: 'm',
        ...PROMPT,
        maxTokens: 10,
        serviceTier: 'priority',
        fetchImpl,
      }),
    );
    await drain(
      streamOpenAIReply({ apiKey: 'k', model: 'm', ...PROMPT, maxTokens: 10, fetchImpl }),
    );
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ service_tier: 'priority' });
    expect(JSON.parse(String(calls[1]!.init.body))).not.toHaveProperty('service_tier');
  });

  it('sends no prompt_cache_key outside a call', async () => {
    const { fetchImpl, calls } = sseFetch(['data: {"choices":[{"delta":{"content":"x"}}]}']);
    await drain(
      streamOpenAIReply({ apiKey: 'k', model: 'm', ...PROMPT, maxTokens: 10, fetchImpl }),
    );
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty('prompt_cache_key');
  });

  it('turns an HTTP error into a ProviderError with the status only', async () => {
    const { fetchImpl } = sseFetch(['{"error":{"message":"echo of the PROMPT"}}'], 429);
    const error = await drain(
      streamOpenAIReply({ apiKey: 'k', model: 'm', ...PROMPT, maxTokens: 10, fetchImpl }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).provider).toBe('openai');
    expect((error as ProviderError).status).toBe(429);
    expect(String((error as Error).message)).not.toContain('PROMPT');
  });

  it('ends with a ProviderError on an error event in the stream', async () => {
    const { fetchImpl } = sseFetch([
      'data: {"choices":[{"delta":{"content":"a"}}]}',
      'data: {"error":{"message":"boom"}}',
    ]);
    const error = await drain(
      streamOpenAIReply({ apiKey: 'k', model: 'm', ...PROMPT, maxTokens: 10, fetchImpl }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe('stream');
  });

  it('maps a content filter to a refusal and length to max_tokens', async () => {
    for (const [reason, expected] of [
      ['content_filter', 'refusal'],
      ['length', 'max_tokens'],
    ] as const) {
      const { fetchImpl } = sseFetch([
        `data: {"choices":[{"delta":{"content":"a"},"finish_reason":"${reason}"}]}`,
      ]);
      const { result } = await drain(
        streamOpenAIReply({ apiKey: 'k', model: 'm', ...PROMPT, maxTokens: 10, fetchImpl }),
      );
      expect(result.stopReason).toBe(expected);
    }
  });
});

describe('warmOpenAI', () => {
  it('asks for one token, not streamed, with the cache key, and returns the usage', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return Response.json({
        choices: [{ finish_reason: 'length' }],
        usage: {
          prompt_tokens: 3000,
          completion_tokens: 1,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      });
    }) as unknown as typeof fetch;
    const result = await warmOpenAI({
      apiKey: 'k',
      model: 'gpt-5.6-luna',
      ...PROMPT,
      maxTokens: 1500,
      cacheKey: 'call-1',
      fetchImpl,
    });
    const body = JSON.parse(String(calls[0]!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      max_completion_tokens: 1,
      reasoning_effort: 'none',
      prompt_cache_key: 'call-1',
    });
    expect(body).not.toHaveProperty('stream');
    expect(result.usage.input_tokens).toBe(3000);
    expect(result.stopReason).toBe('max_tokens');
  });
});
