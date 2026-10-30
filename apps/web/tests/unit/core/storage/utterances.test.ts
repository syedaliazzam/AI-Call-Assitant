/**
 * Tests for apps/web/src/core/storage/utterances.ts, on an in-memory IndexedDB (fake-indexeddb):
 * saveUtterance() stores a line and replaces a line saved earlier under the same id (a merged
 * line); deleteUtterance() removes one line; listUtterances() returns one session's lines in the
 * order they were spoken. All text is
 * invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoredUtterance } from '@/core/storage/types';
import { deleteUtterance, listUtterances, saveUtterance } from '@/core/storage/utterances';
import { resetDb } from './helpers';

beforeEach(resetDb);

/**
 * An invented transcript line.
 *
 * @param id        Line id.
 * @param sessionId Session it belongs to.
 * @param tStart    Start time (Unix ms).
 * @param text      What was said.
 * @returns The line.
 */
function line(id: string, sessionId: string, tStart: number, text = 'Invented'): StoredUtterance {
  return { id, sessionId, speaker: 'them', text, tStart, tEnd: tStart + 1_000 };
}

describe('utterances', () => {
  it('lists one session’s lines in the order they were spoken', async () => {
    await saveUtterance(line('u2', 's1', 2_000));
    await saveUtterance(line('u1', 's1', 1_000));
    await saveUtterance(line('x1', 's2', 500));
    expect((await listUtterances('s1')).map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(await listUtterances('none')).toEqual([]);
  });

  it('deletes one saved line (a line later recognised as an echo)', async () => {
    await saveUtterance(line('u1', 's1', 1_000));
    await saveUtterance(line('u2', 's1', 2_000));
    await deleteUtterance('u1');
    await deleteUtterance('missing');
    expect((await listUtterances('s1')).map((u) => u.id)).toEqual(['u2']);
  });

  it('replaces a line saved again under the same id (a merged line)', async () => {
    await saveUtterance(line('u1', 's1', 1_000, 'First part'));
    await saveUtterance(line('u1', 's1', 1_000, 'First part and the rest'));
    expect(await listUtterances('s1')).toEqual([
      line('u1', 's1', 1_000, 'First part and the rest'),
    ]);
  });
});
