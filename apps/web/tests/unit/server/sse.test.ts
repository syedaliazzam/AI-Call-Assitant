/**
 * Tests for apps/web/src/server/sse.ts:
 * formatEvent() produces valid SSE text; toEventStream() sends each text piece as its own
 * `delta` chunk the moment it exists (no buffering), ends with the `done` event from onDone,
 * turns a thrown error into an `error` event, and stops the source when the reader cancels.
 */
import { describe, expect, it, vi } from 'vitest';
import { formatEvent, SSE_HEADERS, toEventStream } from '@/server/sse';

/** Decodes one stream chunk to text. */
const decode = (chunk: Uint8Array | undefined) => new TextDecoder().decode(chunk);

/** Handlers that produce a fixed done event and a fixed error event. */
const handlers = {
  onDone: () => ({
    type: 'done' as const,
    usage: {
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3,
    },
    ms: { auth: 1, toStreamOpen: 5, streamOpenToFirstText: 5, toFirstText: 10, total: 20 },
  }),
  onError: () => ({ type: 'error' as const, code: 'internal' as const, message: 'failed' }),
};

describe('formatEvent', () => {
  it('writes an event line, a JSON data line and a blank line', () => {
    expect(formatEvent('delta', { text: 'Hi\nthere' })).toBe(
      'event: delta\ndata: {"text":"Hi\\nthere"}\n\n',
    );
  });
});

describe('SSE_HEADERS', () => {
  it('declares an event stream and turns off caching and compression', () => {
    expect(SSE_HEADERS['Content-Type']).toMatch(/^text\/event-stream/);
    expect(SSE_HEADERS['Cache-Control']).toContain('no-transform');
  });
});

describe('toEventStream', () => {
  it('sends one delta chunk per text piece, then the done event', async () => {
    async function* source() {
      yield 'Hello';
      yield ' world';
      return 'result';
    }
    const reader = toEventStream(source(), handlers).getReader();

    expect(decode((await reader.read()).value)).toBe('event: delta\ndata: {"text":"Hello"}\n\n');
    expect(decode((await reader.read()).value)).toBe('event: delta\ndata: {"text":" world"}\n\n');
    expect(decode((await reader.read()).value)).toMatch(/^event: done\ndata: \{"usage"/);
    expect((await reader.read()).done).toBe(true);
  });

  it('flushes a piece immediately, before the source has produced the next one', async () => {
    let releaseSecond: () => void = () => {};
    const secondReady = new Promise<void>((resolve) => (releaseSecond = resolve));
    async function* source() {
      yield 'first';
      await secondReady; // Claude is still "thinking" about the next piece.
      yield 'second';
      return 'result';
    }
    const reader = toEventStream(source(), handlers).getReader();

    // The first piece arrives while the second is still pending: nothing is held back.
    expect(decode((await reader.read()).value)).toContain('"first"');
    releaseSecond();
    expect(decode((await reader.read()).value)).toContain('"second"');
  });

  it('passes the result and the first-delta time to onDone', async () => {
    async function* source() {
      yield 'x';
      return 'the-result';
    }
    const onDone = vi.fn(handlers.onDone);
    const reader = toEventStream(source(), { ...handlers, onDone }).getReader();
    while (!(await reader.read()).done) {
      // read everything
    }
    expect(onDone).toHaveBeenCalledWith('the-result', { firstDeltaAt: expect.any(Number) });
  });

  it('turns a thrown error into an error event and closes the stream', async () => {
    // This source fails before producing any text.
    async function* source(): AsyncGenerator<string, string> {
      throw new Error('upstream failed');
    }
    const reader = toEventStream(source(), handlers).getReader();

    expect(decode((await reader.read()).value)).toBe(
      'event: error\ndata: {"code":"internal","message":"failed"}\n\n',
    );
    expect((await reader.read()).done).toBe(true);
  });

  it('stops the source when the reader cancels (browser disconnected)', async () => {
    const cleanedUp = vi.fn();
    async function* source() {
      try {
        yield 'a';
        yield 'b';
        return 'result';
      } finally {
        cleanedUp();
      }
    }
    const reader = toEventStream(source(), handlers).getReader();
    await reader.read();
    await reader.cancel();
    expect(cleanedUp).toHaveBeenCalledTimes(1);
  });
});
