/**
 * Tests for apps/web/src/core/transcript/saver.ts with the real transcript and a fake store:
 * final lines are saved under "<session>:<call>:<line id>", partial lines never; a line that
 * grows by merging is saved again under the same id; a "You" line saved before its "Them" line
 * arrived is deleted once it is recognised as an echo, and an echo line is never saved; writes
 * happen in order, a failed write is reported and later writes still run; after stop() nothing
 * more is written. All text is invented.
 */
import { describe, expect, it, vi } from 'vitest';
import type { StoredUtterance } from '@/core/storage/types';
import { startTranscriptSaver, type SaverStore } from '@/core/transcript/saver';
import { createTranscript } from '@/core/transcript/transcript';

/** A sentence long enough to be judged as an echo (4+ words). */
const THEM = 'NOW THIS MIGHT SOUND TRIVIAL AND NOT REALLY EXISTENTIAL AT ALL';

/**
 * A fake store that records every write.
 *
 * @param failFirst True to make the first write fail.
 * @returns The store and the list of writes ("save <id> <text>" / "remove <id>").
 */
function fakeStore(failFirst = false) {
  const writes: string[] = [];
  let calls = 0;
  const store: SaverStore = {
    save: vi.fn(async (utterance: StoredUtterance) => {
      calls += 1;
      if (failFirst && calls === 1) throw new Error('disk full');
      writes.push(`save ${utterance.id} ${utterance.text}`);
    }),
    remove: vi.fn(async (id: string) => {
      calls += 1;
      writes.push(`remove ${id}`);
    }),
  };
  return { store, writes };
}

/**
 * A transcript with a fixed clock, as the live page uses it.
 *
 * @returns The transcript.
 */
function transcript() {
  // No display hold timers are needed here: a fixed clock and a timer that never fires.
  return createTranscript(() => 100_000, { schedule: () => () => undefined });
}

describe('startTranscriptSaver', () => {
  it('saves final lines (never partial ones) under session, call and line id', async () => {
    const t = transcript();
    const { store, writes } = fakeStore();
    const saver = startTranscriptSaver(t, 's1', { store, callId: 'c1' });
    t.addPartial('them', 'HELLO', 1_000);
    t.addFinal({ speaker: 'them', text: 'HELLO THERE', tStart: 1_000, tEnd: 2_000 });
    await saver.flush();
    expect(writes).toEqual(['save s1:c1:u1 HELLO THERE']);
  });

  it('saves a merged line again under the same id', async () => {
    const t = transcript();
    const { store, writes } = fakeStore();
    const saver = startTranscriptSaver(t, 's1', { store, callId: 'c1' });
    t.addFinal({ speaker: 'them', text: 'FIRST PART', tStart: 1_000, tEnd: 2_000 });
    // Less than 1.5 s later, same speaker: merged into u1.
    t.addFinal({ speaker: 'them', text: 'AND THE REST', tStart: 2_500, tEnd: 3_000 });
    await saver.flush();
    expect(writes).toEqual(['save s1:c1:u1 FIRST PART', 'save s1:c1:u1 FIRST PART AND THE REST']);
  });

  it('deletes a saved "You" line once it is recognised as an echo, and never saves echoes', async () => {
    const t = transcript();
    const { store, writes } = fakeStore();
    const saver = startTranscriptSaver(t, 's1', { store, callId: 'c1' });
    // The echo can be final first: saved, then removed when the "Them" original arrives.
    t.addFinal({ speaker: 'you', text: THEM, tStart: 1_500, tEnd: 4_500 });
    t.addFinal({ speaker: 'them', text: THEM, tStart: 1_000, tEnd: 4_000 });
    // A second echo arriving after its original is never saved.
    t.addFinal({ speaker: 'you', text: THEM, tStart: 6_000, tEnd: 9_000 });
    t.addFinal({ speaker: 'them', text: THEM, tStart: 5_500, tEnd: 8_500 });
    await saver.flush();
    expect(writes.filter((w) => w.startsWith('remove'))).toEqual(['remove s1:c1:u1']);
    expect(writes.some((w) => w.includes(':u3 '))).toBe(false);
    expect(writes.filter((w) => w.startsWith('save') && w.includes(THEM))).toHaveLength(3);
  });

  it('reports a failed write and keeps writing later changes', async () => {
    const t = transcript();
    const { store, writes } = fakeStore(true);
    const onError = vi.fn();
    const saver = startTranscriptSaver(t, 's1', { store, callId: 'c1', onError });
    t.addFinal({ speaker: 'them', text: 'LOST LINE', tStart: 1_000, tEnd: 2_000 });
    t.addFinal({ speaker: 'you', text: 'KEPT LINE', tStart: 5_000, tEnd: 6_000 });
    await saver.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(['save s1:c1:u2 KEPT LINE']);
  });

  it('saves lines that were already final when it started, and nothing after stop()', async () => {
    const t = transcript();
    t.addFinal({ speaker: 'them', text: 'BEFORE', tStart: 1_000, tEnd: 2_000 });
    const { store, writes } = fakeStore();
    const saver = startTranscriptSaver(t, 's1', { store, callId: 'c1' });
    saver.stop();
    t.addFinal({ speaker: 'you', text: 'AFTER STOP', tStart: 5_000, tEnd: 6_000 });
    await saver.flush();
    expect(writes).toEqual(['save s1:c1:u1 BEFORE']);
  });
});
