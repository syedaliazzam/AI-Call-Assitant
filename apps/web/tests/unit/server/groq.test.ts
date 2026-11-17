/**
 * Tests apps/web/src/server/groq.ts (ADR-0095): the Claude-shaped prompt becomes OpenAI-style messages with
 * the same rules in the same order; a streamed Groq reply yields its text and finishes with the usage and the
 * stop reason; an HTTP error is a GroqError with the status only; and withFirstTokenFallback() moves an answer
 * to the fallback when the first source fails, sends nothing in time or sends nothing at all, but never once
 * its first words are out, and never when the request itself was stopped. fetch is faked: no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  GROQ_CHAT_URL,
  GroqError,
  streamGroqReply,
  toGroqMessages,
  toStopReason,
  withFirstTokenFallback,
} from '@/server/groq';

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

afterEach(() => {
  vi.useRealTimers();
});

describe('toGroqMessages', () => {
  it('sends the same rules in the same order: one system message, then each turn as text', () => {
    const messages = toGroqMessages(
      [
        { type: 'text', text: 'LOCKED CONTRACT', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'GLOBAL PROMPT' },
      ],
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'CONVERSATION' },
            { type: 'text', text: 'QUESTION + END REMINDER' },
          ],
        },
      ],
    );
    expect(messages).toEqual([
      { role: 'system', content: 'LOCKED CONTRACT\n\nGLOBAL PROMPT' },
      { role: 'user', content: 'CONVERSATION\n\nQUESTION + END REMINDER' },
    ]);
  });

  it('takes a plain-string system prompt and string content', () => {
    expect(toGroqMessages('RULES', [{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'system', content: 'RULES' },
      { role: 'user', content: 'hi' },
    ]);
  });
});

describe('toStopReason', () => {
  it("names Groq's finish reasons as Claude's", () => {
    expect(toStopReason('stop')).toBe('end_turn');
    expect(toStopReason('length')).toBe('max_tokens');
    expect(toStopReason('content_filter')).toBe('refusal');
    expect(toStopReason(null)).toBeNull();
  });
});

describe('streamGroqReply', () => {
  it('streams the text and returns the usage, with low reasoning left out of the reply', async () => {
    const { fetchImpl, calls } = sseFetch([
      'data: {"choices":[{"delta":{"content":"[[call]]"}}]}',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":9,"prompt_tokens_details":{"cached_tokens":100}}}',
      'data: [DONE]',
    ]);
    const onStreamOpen = vi.fn();
    const { items, result } = await drain(
      streamGroqReply({
        apiKey: 'test-key',
        model: 'openai/gpt-oss-120b',
        system: 'RULES',
        messages: [{ role: 'user', content: 'Q' }],
        maxTokens: 1500,
        onStreamOpen,
        fetchImpl,
      }),
    );
    expect(items).toEqual(['[[call]]', 'Hello', ' there']);
    expect(result).toEqual({
      usage: {
        input_tokens: 120,
        output_tokens: 9,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 100,
      },
      stopReason: 'end_turn',
    });
    expect(onStreamOpen).toHaveBeenCalledOnce();
    expect(calls[0]?.url).toBe(GROQ_CHAT_URL);
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'openai/gpt-oss-120b',
      stream: true,
      max_completion_tokens: 1500,
      reasoning_effort: 'low',
      include_reasoning: false,
    });
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      'Bearer test-key',
    );
  });

  it('reads the usage from x_groq too', async () => {
    const { fetchImpl } = sseFetch([
      'data: {"choices":[{"delta":{"content":"A"},"finish_reason":"length"}],"x_groq":{"usage":{"prompt_tokens":5,"completion_tokens":2}}}',
    ]);
    const { result } = await drain(
      streamGroqReply({
        apiKey: 'k',
        model: 'm',
        system: 'S',
        messages: [],
        maxTokens: 10,
        fetchImpl,
      }),
    );
    expect(result.usage.input_tokens).toBe(5);
    expect(result.stopReason).toBe('max_tokens');
  });

  it('throws a GroqError with the status only on an HTTP error', async () => {
    const { fetchImpl } = sseFetch(['{"error":{"message":"secret request echo"}}'], 503);
    const reply = streamGroqReply({
      apiKey: 'k',
      model: 'm',
      system: 'S',
      messages: [],
      maxTokens: 10,
      fetchImpl,
    });
    const error = await reply.next().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GroqError);
    expect((error as GroqError).status).toBe(503);
    expect((error as GroqError).message).not.toContain('secret');
  });

  it('throws a GroqError for an error event in the stream', async () => {
    const { fetchImpl } = sseFetch(['data: {"error":{"message":"x"}}']);
    const reply = streamGroqReply({
      apiKey: 'k',
      model: 'm',
      system: 'S',
      messages: [],
      maxTokens: 10,
      fetchImpl,
    });
    await expect(reply.next()).rejects.toBeInstanceOf(GroqError);
  });
});

/**
 * A source that yields the given pieces and returns 'R'.
 *
 * @param items The text pieces.
 * @returns The generator.
 */
async function* pieces(...items: string[]): AsyncGenerator<string, string, undefined> {
  for (const item of items) yield item;
  return 'R';
}

describe('withFirstTokenFallback', () => {
  it('keeps the first source when its first text comes in time', async () => {
    const onFallback = vi.fn();
    const fallback = vi.fn(() => pieces('claude'));
    const { items, result } = await drain(
      withFirstTokenFallback(() => pieces('a', 'b'), fallback, { firstTokenMs: 1000, onFallback }),
    );
    expect(items).toEqual(['a', 'b']);
    expect(result).toBe('R');
    expect(fallback).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('moves to the fallback when the first source fails before any text', async () => {
    const onFallback = vi.fn();
    async function* failing(): AsyncGenerator<string, string, undefined> {
      throw new GroqError('http', 500);
    }
    const { items } = await drain(
      withFirstTokenFallback(
        () => failing(),
        () => pieces('claude'),
        {
          firstTokenMs: 1000,
          onFallback,
        },
      ),
    );
    expect(items).toEqual(['claude']);
    expect(onFallback).toHaveBeenCalledWith('error', expect.any(GroqError));
  });

  it('moves to the fallback when no first text comes within the limit, and stops the first source', async () => {
    vi.useFakeTimers();
    const onFallback = vi.fn();
    let stopped = false;
    const slow = (signal: AbortSignal) =>
      (async function* (): AsyncGenerator<string, string, undefined> {
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            stopped = true;
            reject(new Error('aborted'));
          }),
        );
        yield 'late';
        return 'R';
      })();
    const run = drain(
      withFirstTokenFallback(slow, () => pieces('claude'), { firstTokenMs: 4000, onFallback }),
    );
    await vi.advanceTimersByTimeAsync(4000);
    const { items } = await run;
    expect(items).toEqual(['claude']);
    expect(onFallback).toHaveBeenCalledWith('timeout', undefined);
    expect(stopped).toBe(true);
  });

  it('moves to the fallback when the first source ends with no text', async () => {
    const onFallback = vi.fn();
    const { items } = await drain(
      withFirstTokenFallback(
        () => pieces(),
        () => pieces('claude'),
        {
          firstTokenMs: 1000,
          onFallback,
        },
      ),
    );
    expect(items).toEqual(['claude']);
    expect(onFallback).toHaveBeenCalledWith('empty', undefined);
  });

  it('keeps an error after the first words: they were already shown', async () => {
    const fallback = vi.fn(() => pieces('claude'));
    async function* breaks(): AsyncGenerator<string, string, undefined> {
      yield 'first';
      throw new GroqError('stream');
    }
    const source = withFirstTokenFallback(() => breaks(), fallback, {
      firstTokenMs: 1000,
      onFallback: vi.fn(),
    });
    expect((await source.next()).value).toBe('first');
    await expect(source.next()).rejects.toBeInstanceOf(GroqError);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('never falls back when the request itself was stopped', async () => {
    const request = new AbortController();
    request.abort();
    const fallback = vi.fn(() => pieces('claude'));
    async function* failing(): AsyncGenerator<string, string, undefined> {
      throw new Error('aborted');
    }
    await expect(
      drain(
        withFirstTokenFallback(() => failing(), fallback, {
          firstTokenMs: 1000,
          signal: request.signal,
          onFallback: vi.fn(),
        }),
      ),
    ).rejects.toThrow();
    expect(fallback).not.toHaveBeenCalled();
  });
});
