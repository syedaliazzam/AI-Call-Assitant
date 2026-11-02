/**
 * Tests for apps/web/src/core/storage/wipe.ts, on an in-memory IndexedDB (fake-indexeddb):
 * deleteAllLocalData() reports how many rows each store had, leaves every store empty, keeps
 * working when there is nothing to delete, and the storage modules work again afterwards (a new,
 * empty database). All data is invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/core/storage/db';
import { addDocument } from '@/core/storage/documents';
import { createSession, listSessions } from '@/core/storage/sessions';
import { saveUtterance } from '@/core/storage/utterances';
import { deleteAllLocalData } from '@/core/storage/wipe';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

describe('deleteAllLocalData', () => {
  it('reports what was there and leaves an empty database that still works', async () => {
    const a = await createSession(sessionInput());
    await createSession(sessionInput());
    await addDocument({ sessionId: a.id, name: 'x.txt', text: 'Invented' });
    await saveUtterance({
      id: 'u1',
      sessionId: a.id,
      speaker: 'you',
      text: 'Invented',
      tStart: 1,
      tEnd: 2,
    });

    expect(await deleteAllLocalData()).toEqual({
      sessions: 2,
      documents: 1,
      utterances: 1,
      answers: 0,
      notes: 0,
      lessons: 0,
      library: 0,
      questionBanks: 0,
    });
    expect(await listSessions()).toEqual([]);
    expect(await getDb().documents.count()).toBe(0);
    expect(await getDb().utterances.count()).toBe(0);

    // A new, empty database is created on the next use.
    await createSession(sessionInput());
    expect(await listSessions()).toHaveLength(1);
  });

  it('reports zeros when there is nothing to delete', async () => {
    expect(await deleteAllLocalData()).toEqual({
      sessions: 0,
      documents: 0,
      utterances: 0,
      answers: 0,
      notes: 0,
      lessons: 0,
      library: 0,
      questionBanks: 0,
    });
  });
});
