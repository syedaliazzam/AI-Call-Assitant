/**
 * Tests apps/web/src/core/answer/answerClient.ts (streamAnswer) and format.ts (splitAnswer) on
 * real /api/answer streams recorded on 3 Nov 2026 (v1.0.0 release) through the route's own
 * pipeline (buildPrompt → streamReply → withAnswerMeta → toEventStream) for three invented eval
 * scenarios: tests/fixtures/answers/real-stream-*.sse. Whatever the network chunking, the client
 * must report the hidden line's meta first, then text that makes a headline and 2 to 4 bullets,
 * then done with usage, so the harness mocks and real answers cannot drift apart unnoticed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnswerMeta } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import { streamAnswer } from '@/core/answer/answerClient';
import { splitAnswer } from '@/core/answer/format';

/** The recorded streams. */
const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'answers',
);
const RECORDINGS = readdirSync(FIXTURES).filter((name) => name.endsWith('.sse'));

/**
 * A fake fetch whose body is the recording, split into pieces of `size` bytes, so boundaries fall
 * mid-event and mid-character as on a real network.
 *
 * @param bytes The recorded body.
 * @param size  Bytes per piece.
 * @returns A fetch that answers with that body.
 */
function recordedFetch(bytes: Uint8Array, size: number): typeof fetch {
  return vi.fn(async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

/**
 * Plays a recording through streamAnswer() to its end.
 *
 * @param bytes The recorded body.
 * @param size  Bytes per network piece.
 * @returns The order of the callbacks, the meta, the joined text and the done report.
 */
function play(bytes: Uint8Array, size: number) {
  const order: string[] = [];
  let meta: AnswerMeta | undefined;
  let text = '';
  return new Promise<{ order: string[]; meta?: AnswerMeta; text: string; done?: unknown }>(
    (resolve, reject) => {
      streamAnswer(
        { mode: 'answer' },
        {
          onMeta: (received) => {
            order.push('meta');
            meta = received;
          },
          onDelta: (delta) => {
            if (order.at(-1) !== 'delta') order.push('delta');
            text += delta;
          },
          onDone: (done) => {
            order.push('done');
            resolve({ order, ...(meta ? { meta } : {}), text, done });
          },
          onError: (failure) => reject(new Error(failure.code)),
        },
        { fetchImpl: recordedFetch(bytes, size) },
      );
    },
  );
}

describe('recorded real answer streams', () => {
  it('has recordings to play', () => {
    expect(RECORDINGS.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of RECORDINGS) {
    for (const size of [1, 7, 64, 100_000]) {
      it(`${name} in ${size}-byte pieces: meta, then a headline and 2 to 4 bullets, then done`, async () => {
        const bytes = new Uint8Array(readFileSync(path.join(FIXTURES, name)));
        const { order, meta, text, done } = await play(bytes, size);
        expect(order).toEqual(['meta', 'delta', 'done']);
        expect(meta?.target).toBe('call');
        // The hidden line never reaches the text the card shows.
        expect(text).not.toMatch(/^\s*\[\[/);
        const parts = splitAnswer(text);
        expect(parts.headline.trim().length).toBeGreaterThan(0);
        expect(parts.bullets.length).toBeGreaterThanOrEqual(2);
        expect(parts.bullets.length).toBeLessThanOrEqual(4);
        expect(done).toEqual(expect.objectContaining({ usage: expect.any(Object) }));
      });
    }
  }
});
