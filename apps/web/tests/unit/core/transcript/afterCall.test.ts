/**
 * Tests for apps/web/src/core/transcript/afterCall.ts (v1.4, ADR-0066): the user's line audio is kept per
 * line (a merged line has several pieces, in order); a line with a missing or too long piece, or past
 * the memory limit, is left as heard; take() empties the store. After the call each line is transcribed
 * again, piece by piece, and saved under the same id with the key terms put back; a refusal, a failure,
 * no words or a failed save keep the line as heard; stopping early keeps the rest. All text is invented.
 */
import type { AccurateResult } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import type { StoredUtterance } from '@/core/storage/types';
import { createYouAudio, rewriteAfterCall, type AfterCallLine } from '@/core/transcript/afterCall';

/**
 * Audio of a given length (silence; the fake engine does not listen).
 *
 * @param seconds Its length.
 * @returns The samples.
 */
const audio = (seconds: number) => new Float32Array(Math.round(seconds * 16_000));

/**
 * A saved line.
 *
 * @param id   Its stored id.
 * @param text Its words as heard.
 * @returns The line.
 */
const saved = (id: string, text: string): StoredUtterance => ({
  id,
  sessionId: 's1',
  speaker: 'you',
  text,
  tStart: 1_000,
  tEnd: 3_000,
});

/**
 * A fake engine that answers from a list, in order.
 *
 * @param results What each call returns.
 * @returns The engine and its mock.
 */
function engineOf(results: AccurateResult[]) {
  const transcribe = vi.fn(
    async () => results.shift() ?? { ok: false as const, code: 'engine' as const },
  );
  return { transcribe };
}

describe('createYouAudio', () => {
  it('keeps each line’s pieces in order, and take() empties it', () => {
    const store = createYouAudio();
    const first = audio(1);
    const second = audio(2);
    store.add('u1', first);
    store.add('u2', audio(1));
    store.add('u1', second);
    expect(store.seconds()).toBe(4);
    const taken = store.take();
    expect(taken.get('u1')).toEqual([first, second]);
    expect(taken.get('u2')).toHaveLength(1);
    expect(store.seconds()).toBe(0);
    expect(store.take().size).toBe(0);
  });

  it('leaves a line as heard when a piece is missing or longer than 30 s, and frees its audio', () => {
    const store = createYouAudio();
    store.add('u1', audio(2));
    store.add('u1', null);
    store.add('u1', audio(1));
    store.add('u2', audio(31));
    expect(store.seconds()).toBe(0);
    const taken = store.take();
    expect(taken.get('u1')).toBeNull();
    expect(taken.get('u2')).toBeNull();
  });

  it('stops keeping audio at the limit', () => {
    const store = createYouAudio(5);
    store.add('u1', audio(4));
    store.add('u2', audio(2));
    const taken = store.take();
    expect(taken.get('u1')).toHaveLength(1);
    expect(taken.get('u2')).toBeNull();
  });
});

describe('rewriteAfterCall', () => {
  it('saves each line again under the same id with the new words and the key terms', async () => {
    const engine = engineOf([
      { ok: true, text: 'We moved the billing service', ms: 300 },
      { ok: true, text: 'to north wind cloud.', ms: 200 },
      { ok: true, text: 'Yes, exactly.', ms: 100 },
    ]);
    const save = vi.fn(async (_utterance: StoredUtterance) => undefined);
    const lines: AfterCallLine[] = [
      {
        saved: saved('s1:c1:u1', 'WE MOVED THE BILLING SERVICE TO NORTH WIND CLOUD'),
        pieces: [audio(2), audio(1)],
      },
      { saved: saved('s1:c1:u3', 'YES EXACTLY'), pieces: [audio(1)] },
    ];
    const result = await rewriteAfterCall(engine, lines, save, ['Northwind Cloud']);
    expect(result).toMatchObject({ rewritten: 2, kept: 0 });
    expect(engine.transcribe).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenNthCalledWith(1, {
      ...lines[0]!.saved,
      text: 'We moved the billing service to Northwind Cloud.',
    });
    expect(save).toHaveBeenNthCalledWith(2, { ...lines[1]!.saved, text: 'Yes, exactly.' });
  });

  it('keeps a line as heard when the engine refuses or fails, gives no words, or the save fails', async () => {
    const engine = engineOf([
      { ok: true, text: 'First piece', ms: 100 },
      { ok: false, code: 'engine' },
      { ok: true, text: '   ', ms: 100 },
      { ok: true, text: 'Fine words.', ms: 100 },
    ]);
    const save = vi.fn(async (_utterance: StoredUtterance) => {
      throw new Error('quota');
    });
    const result = await rewriteAfterCall(
      engine,
      [
        { saved: saved('a', 'ONE'), pieces: [audio(1), audio(1)] },
        { saved: saved('b', 'TWO'), pieces: [audio(1)] },
        { saved: saved('c', 'THREE'), pieces: [audio(1)] },
      ],
      save,
    );
    expect(result).toMatchObject({ rewritten: 0, kept: 3 });
    // Only the line with words was saved, and that save failed.
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('stops early when asked: the rest keep their words', async () => {
    const engine = engineOf([{ ok: true, text: 'Done.', ms: 100 }]);
    const save = vi.fn(async (_utterance: StoredUtterance) => undefined);
    let open = true;
    const result = await rewriteAfterCall(
      engine,
      [
        { saved: saved('a', 'ONE'), pieces: [audio(1)] },
        { saved: saved('b', 'TWO'), pieces: [audio(1)] },
      ],
      async (utterance) => {
        await save(utterance);
        open = false;
      },
      [],
      () => !open,
    );
    expect(result).toMatchObject({ rewritten: 1, kept: 1 });
    expect(engine.transcribe).toHaveBeenCalledTimes(1);
  });
});
