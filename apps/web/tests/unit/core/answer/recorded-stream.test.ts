/**
 * Tests apps/web/src/core/answer/answerClient.ts (streamAnswer) and format.ts (splitAnswer) on
 * real /api/answer streams recorded on 3 Nov 2026 (v1.0.0 release; and v1.0.2, in the new format)
 * through the route's own pipeline (buildPrompt → streamReply → withAnswerMeta → toEventStream)
 * for three invented eval scenarios: tests/fixtures/answers/real-stream-*.sse. Whatever the network chunking, the client
 * must report the hidden line's meta first, then text that makes a headline and 2 to 4 bullets,
 * then done with usage (v1.0.2 recordings: then the cleaned question before done), so the harness
 * mocks and real answers cannot drift apart unnoticed.
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
  let question: string | undefined;
  let text = '';
  return new Promise<{
    order: string[];
    meta?: AnswerMeta;
    question?: string;
    text: string;
    done?: unknown;
  }>((resolve, reject) => {
    streamAnswer(
      { mode: 'answer' },
      {
        onMeta: (received) => {
          order.push('meta');
          meta = received;
        },
        onQuestion: (received) => {
          order.push('question');
          question = received;
        },
        onDelta: (delta) => {
          if (order.at(-1) !== 'delta') order.push('delta');
          text += delta;
        },
        onDone: (done) => {
          order.push('done');
          resolve({
            order,
            ...(meta ? { meta } : {}),
            ...(question ? { question } : {}),
            text,
            done,
          });
        },
        onError: (failure) => reject(new Error(failure.code)),
      },
      { fetchImpl: recordedFetch(bytes, size) },
    );
  });
}

describe('recorded real answer streams', () => {
  it('has recordings to play', () => {
    expect(RECORDINGS.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of RECORDINGS) {
    for (const size of [1, 7, 64, 100_000]) {
      it(`${name} in ${size}-byte pieces: meta, then a headline and 2 to 4 bullets, then done`, async () => {
        const bytes = new Uint8Array(readFileSync(path.join(FIXTURES, name)));
        const { order, meta, question, text, done } = await play(bytes, size);
        // v1.0.2 recordings (ADR-0037) end with the cleaned question after the words; the v1.0.0
        // recordings have none, and must still play (the v-previous rollback sends that format).
        const v102 = name.startsWith('real-stream-v102-');
        expect(order).toEqual(
          v102 ? ['meta', 'delta', 'question', 'done'] : ['meta', 'delta', 'done'],
        );
        if (v102) expect(question?.length ?? 0).toBeGreaterThan(5);
        // Neither hidden line ever reaches the text the card shows.
        expect(text).not.toContain('[[');
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
