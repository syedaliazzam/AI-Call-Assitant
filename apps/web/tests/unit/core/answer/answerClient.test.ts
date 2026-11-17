/**
 * Tests for apps/web/src/core/answer/answerClient.ts:
 * the SSE parser handles events split across network chunks (also mid-character and with CRLF
 * line endings); streamAnswer() reports deltas in order, then done with usage and timings,
 * reports server errors and dropped connections, and cancel() aborts with no further callbacks.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSseParser, streamAnswer, type SseMessage } from '@/core/answer/answerClient';

/** A complete reply as the server sends it. */
const REPLY =
  'event: delta\ndata: {"text":"Héllo"}\n\n' +
  'event: delta\ndata: {"text":" world"}\n\n' +
  'event: done\ndata: {"usage":{"input_tokens":5,"output_tokens":3,"cache_creation_input_tokens":0,"cache_read_input_tokens":1100},"ms":{"toFirstText":300,"total":600}}\n\n';

/**
 * Builds a fake fetch whose response body arrives in the given byte chunks.
 *
 * @param chunks Body bytes, split exactly where the "network" splits them.
 * @param init   Response status (default 200).
 * @returns A vi.fn fetch that answers with that body (it records the calls).
 */
function fakeFetch(chunks: Uint8Array[], init: ResponseInit = { status: 200 }) {
  return vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    return new Response(body, init);
  });
}

/**
 * Splits bytes into pieces of `size` bytes, so boundaries fall mid-event and mid-character.
 *
 * @param bytes The whole body.
 * @param size  Bytes per piece.
 * @returns The pieces, in order.
 */
function splitBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) pieces.push(bytes.slice(i, i + size));
  return pieces;
}

/**
 * Runs streamAnswer() to completion.
 *
 * @param fetchImpl The fake fetch to use.
 * @returns The text deltas, and the done or error report the handlers received.
 */
function run(fetchImpl: ReturnType<typeof fakeFetch>) {
  const deltas: string[] = [];
  return new Promise<{ deltas: string[]; done?: unknown; error?: unknown }>((resolve) => {
    streamAnswer(
      { mode: 'hello' },
      {
        onDelta: (text) => deltas.push(text),
        onDone: (done) => resolve({ deltas, done }),
        onError: (error) => resolve({ deltas, error }),
      },
      { fetchImpl },
    );
  });
}

describe('createSseParser', () => {
  it('emits events only when complete, even when split across chunks', () => {
    const messages: SseMessage[] = [];
    const parser = createSseParser((message) => messages.push(message));

    parser.push('event: del');
    parser.push('ta\ndata: {"text":"a"}\n');
    expect(messages).toHaveLength(0);
    parser.push('\nevent: done\ndata: {}\n\n');

    expect(messages).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('accepts CRLF line endings and ignores comment lines', () => {
    const messages: SseMessage[] = [];
    const parser = createSseParser((message) => messages.push(message));
    parser.push(': keep-alive\r\n\r\nevent: delta\r\ndata: {"text":"b"}\r\n\r\n');
    expect(messages).toEqual([{ event: 'delta', data: '{"text":"b"}' }]);
  });
});

describe('streamAnswer', () => {
  it('reports deltas in order, then done with usage and timings', async () => {
    const result = await run(fakeFetch([new TextEncoder().encode(REPLY)]));

    expect(result.deltas).toEqual(['Héllo', ' world']);
    expect(result.done).toMatchObject({
      usage: { cache_read_input_tokens: 1100 },
      serverMs: { toFirstText: 300, total: 600 },
      msToFirstText: expect.any(Number),
      msTotal: expect.any(Number),
    });
  });

  it('passes on the tier that answered (ADR-0094), and only a known one', async () => {
    const withTier = (model: string) =>
      `event: done\ndata: {"usage":{},"ms":{},"model":${JSON.stringify(model)}}\n\n`;
    expect((await run(fakeFetch([new TextEncoder().encode(withTier('fast'))]))).done).toMatchObject(
      { model: 'fast' },
    );
    expect(
      (await run(fakeFetch([new TextEncoder().encode(withTier('smart'))]))).done,
    ).toMatchObject({ model: 'smart' });
    // ADR-0099: the Gemini and GPT models are known too.
    expect(
      (await run(fakeFetch([new TextEncoder().encode(withTier('gemini-lite'))]))).done,
    ).toMatchObject({ model: 'gemini-lite' });
    const odd = (await run(fakeFetch([new TextEncoder().encode(withTier('claude-x'))]))).done;
    expect(odd).toBeDefined();
    expect(odd).not.toHaveProperty('model');
    // An older server says nothing: no tier.
    expect((await run(fakeFetch([new TextEncoder().encode(REPLY)]))).done).not.toHaveProperty(
      'model',
    );
  });

  it('parses correctly when every chunk is 7 bytes (splitting lines and the é character)', async () => {
    const result = await run(fakeFetch(splitBytes(new TextEncoder().encode(REPLY), 7)));
    expect(result.deltas).toEqual(['Héllo', ' world']);
    expect(result.done).toBeDefined();
  });

  it('posts the request as JSON to /api/answer', async () => {
    const fetchImpl = fakeFetch([new TextEncoder().encode(REPLY)]);
    await run(fetchImpl);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/answer');
    expect(options).toMatchObject({ method: 'POST', body: '{"mode":"hello"}' });
  });

  it('reports an error event from the server', async () => {
    const body =
      'event: error\ndata: {"code":"upstream_error","message":"Claude returned an error."}\n\n';
    const result = await run(fakeFetch([new TextEncoder().encode(body)]));
    expect(result.error).toEqual({ code: 'upstream_error', message: 'Claude returned an error.' });
  });

  it('reports a JSON error response (for example 401)', async () => {
    const body = new TextEncoder().encode('{"code":"unauthorized","message":"Sign in required"}');
    const result = await run(fakeFetch([body], { status: 401 }));
    expect(result.error).toEqual({ code: 'unauthorized', message: 'Sign in required' });
  });

  it('reports a connection that closes before done', async () => {
    const result = await run(
      fakeFetch([new TextEncoder().encode('event: delta\ndata: {"text":"a"}\n\n')]),
    );
    expect(result.deltas).toEqual(['a']);
    expect(result.error).toMatchObject({ code: 'internal' });
  });

  it('cancel() aborts the request and no callbacks run afterwards', async () => {
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          seenSignal = options?.signal ?? undefined;
          seenSignal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const handlers = { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };

    const { cancel } = streamAnswer({ mode: 'hello' }, handlers, { fetchImpl });
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seenSignal?.aborted).toBe(true);
    expect(handlers.onDelta).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });
});

describe('streamAnswer: the cleaned question (v1.0.2, ADR-0037)', () => {
  it('reports the question event once, after the words, and ignores an empty one', async () => {
    const body = [
      'event: delta\ndata: {"text":"Yes."}\n\n',
      'event: question\ndata: {"question":"  Is it priced per seat? "}\n\n',
      'event: question\ndata: {"question":""}\n\n',
      'event: done\ndata: {"usage":{},"ms":{}}\n\n',
    ].join('');
    const questions: string[] = [];
    await new Promise<void>((resolve, reject) => {
      streamAnswer(
        { mode: 'answer' },
        {
          onDelta: () => undefined,
          onQuestion: (question) => questions.push(question),
          onDone: () => resolve(),
          onError: (failure) => reject(new Error(failure.code)),
        },
        { fetchImpl: fakeFetch([new TextEncoder().encode(body)]) },
      );
    });
    expect(questions).toEqual(['Is it priced per seat?']);
  });
});
