/**
 * Tests apps/web/src/server/gemini.ts (ADR-0099): the Claude-shaped prompt becomes Gemini's system instruction
 * and contents with the same rules in the same order, a screenshot as inline data and an earlier reply as the
 * 'model' turn; a streamed reply yields its text (never a thinking part) and finishes with the usage (cached
 * tokens as cache reads) and the stop reason; the request asks for minimal thinking and streams as server-sent
 * events, with the key in a header (never the address); an HTTP error is a ProviderError with the status only;
 * the warm-up asks for one token. fetch is faked: no network.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  GEMINI_API_URL,
  geminiStopReason,
  streamGeminiReply,
  toGeminiPrompt,
  warmGemini,
} from '@/server/gemini';
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
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\r\n\r\n`));
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

describe('toGeminiPrompt', () => {
  it('sends the same rules in the same order as one system instruction, then the turn as text', () => {
    expect(toGeminiPrompt(PROMPT.system, PROMPT.messages)).toEqual({
      systemInstruction: { parts: [{ text: 'LOCKED CONTRACT\n\nGLOBAL PROMPT' }] },
      contents: [{ role: 'user', parts: [{ text: 'CONVERSATION\n\nQUESTION + END REMINDER' }] }],
    });
  });

  it("keeps a screenshot as inline data in order, and an earlier reply as the 'model' turn", () => {
    const prompt = toGeminiPrompt('RULES', [
      { role: 'assistant', content: 'EARLIER' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'CONVERSATION' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
          { type: 'text', text: 'ABOUT THE SCREENSHOT' },
        ],
      },
    ]);
    expect(prompt.contents).toEqual([
      { role: 'model', parts: [{ text: 'EARLIER' }] },
      {
        role: 'user',
        parts: [
          { text: 'CONVERSATION' },
          { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } },
          { text: 'ABOUT THE SCREENSHOT' },
        ],
      },
    ]);
  });
});

describe('streamGeminiReply', () => {
  it('streams the text (never thinking), and finishes with the usage and the stop reason', async () => {
    const { fetchImpl, calls } = sseFetch([
      'data: {"candidates":[{"content":{"parts":[{"text":"thinking","thought":true}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":" there"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2000,"candidatesTokenCount":9,"cachedContentTokenCount":1500,"thoughtsTokenCount":0}}',
    ]);
    const opened = vi.fn();
    const { items, result } = await drain(
      streamGeminiReply({
        apiKey: 'g-test',
        model: 'gemini-3.5-flash-lite',
        ...PROMPT,
        maxTokens: 1500,
        onStreamOpen: opened,
        fetchImpl,
      }),
    );
    expect(items.join('')).toBe('Hello there');
    expect(result).toEqual({
      usage: {
        input_tokens: 500,
        output_tokens: 9,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1500,
      },
      stopReason: 'end_turn',
    });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(calls[0]!.url).toBe(
      `${GEMINI_API_URL}/gemini-3.5-flash-lite:streamGenerateContent?alt=sse`,
    );
    // The key goes in a header, never in the address (addresses can end up in logs).
    expect(calls[0]!.url).not.toContain('g-test');
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-test');
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      generationConfig: Record<string, unknown>;
    };
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 1500,
      thinkingConfig: { thinkingLevel: 'minimal' },
    });
  });

  it('turns an HTTP error into a ProviderError with the status only', async () => {
    const { fetchImpl } = sseFetch(['{"error":{"message":"echo of the PROMPT"}}'], 503);
    const error = await drain(
      streamGeminiReply({ apiKey: 'k', model: 'm', ...PROMPT, maxTokens: 10, fetchImpl }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).provider).toBe('gemini');
    expect((error as ProviderError).status).toBe(503);
  });

  it('reports a blocked prompt as a refusal', async () => {
    const { fetchImpl } = sseFetch(['data: {"promptFeedback":{"blockReason":"SAFETY"}}']);
    const { items, result } = await drain(
      streamGeminiReply({ apiKey: 'k', model: 'm', ...PROMPT, maxTokens: 10, fetchImpl }),
    );
    expect(items).toEqual([]);
    expect(result.stopReason).toBe('refusal');
  });
});

describe('geminiStopReason', () => {
  it("speaks Claude's words", () => {
    expect(geminiStopReason('STOP')).toBe('end_turn');
    expect(geminiStopReason('MAX_TOKENS')).toBe('max_tokens');
    expect(geminiStopReason('SAFETY')).toBe('refusal');
    expect(geminiStopReason('OTHER')).toBeNull();
    expect(geminiStopReason(undefined)).toBeNull();
  });
});

describe('warmGemini', () => {
  it('asks for one token with generateContent (not streamed) and returns the usage', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({
        candidates: [{ finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 1 },
      });
    }) as unknown as typeof fetch;
    const result = await warmGemini({
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      ...PROMPT,
      maxTokens: 1500,
      fetchImpl,
    });
    expect(calls[0]!.url).toBe(`${GEMINI_API_URL}/gemini-3.6-flash:generateContent`);
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      /** The generation settings sent. */
      generationConfig: Record<string, unknown>;
    };
    expect(body.generationConfig.maxOutputTokens).toBe(1);
    expect(result.usage.input_tokens).toBe(3000);
    expect(result.stopReason).toBe('max_tokens');
  });
});
