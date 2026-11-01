/**
 * Tests for apps/web/src/core/storage/lessons.ts and the version-3 schema in db.ts (Day 5
 * Stage 7): a device that still has the version-2 database keeps its sessions, answers and
 * settings, and gains the lessons store; decisions are saved, listed oldest first, listed per
 * session, updated (text and scope only), deleted one by one and all at once.
 * All text is invented.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, forgetDb } from '@/core/storage/db';
import {
  deleteAllLessons,
  deleteLesson,
  listLessons,
  listLessonsForSession,
  saveLesson,
  updateLesson,
} from '@/core/storage/lessons';
import { getSession } from '@/core/storage/sessions';
import { getSessionDefaults } from '@/core/storage/settings';
import type { StoredLesson } from '@/core/storage/types';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

/**
 * An invented decision.
 *
 * @param id        Id.
 * @param sessionId Source session.
 * @param decidedAt When decided.
 * @returns The decision.
 */
function lesson(id: string, sessionId: string, decidedAt: number): StoredLesson {
  return {
    id,
    text: `Invented lesson ${id}.`,
    scope: 'all',
    status: 'approved',
    sourceSessionId: sessionId,
    sourceKey: `invented lesson ${id}`,
    evidence: 'Invented evidence.',
    decidedAt,
    approvedAt: decidedAt,
  };
}

describe('schema version 3', () => {
  it("keeps a version-2 device's data and adds the lessons store", async () => {
    forgetDb();
    // The database exactly as Day 3 Stage 3 left it (versions 1 and 2, no lessons store).
    const v2 = new Dexie(DB_NAME);
    v2.version(1).stores({
      sessions: 'id, createdAt, type, status',
      documents: 'id, sessionId',
      utterances: 'id, sessionId',
      answers: 'id, sessionId',
      notes: 'sessionId',
    });
    v2.version(2).stores({ settings: 'id' });
    await v2.table('sessions').add({
      ...sessionInput(),
      id: 'old-session',
      createdAt: 1,
      status: 'ended',
      lastActiveAt: null,
    });
    await v2.table('answers').add({ id: 'old-answer', sessionId: 'old-session' });
    v2.close();

    // Opening it with the current schema upgrades it to version 3.
    expect((await getSession('old-session'))?.company).toBe('Bluefin Route');
    expect(await getSessionDefaults()).toBeDefined();
    expect(await listLessons()).toEqual([]);
    await saveLesson(lesson('l1', 'old-session', 5));
    expect(await listLessonsForSession('old-session')).toHaveLength(1);
  });
});

describe('lessons store', () => {
  it('saves, lists oldest first and per session', async () => {
    await saveLesson(lesson('b', 's1', 20));
    await saveLesson(lesson('a', 's1', 10));
    await saveLesson(lesson('c', 's2', 15));
    expect((await listLessons()).map((row) => row.id)).toEqual(['a', 'c', 'b']);
    expect((await listLessonsForSession('s1')).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('updates only the text and scope, and deletes one or all', async () => {
    await saveLesson(lesson('a', 's1', 10));
    await saveLesson(lesson('b', 's1', 20));
    await updateLesson('a', { text: 'Edited.', scope: 'sales' });
    const [edited] = await listLessons();
    expect(edited).toMatchObject({
      id: 'a',
      text: 'Edited.',
      scope: 'sales',
      approvedAt: 10,
      sourceKey: 'invented lesson a',
    });
    await deleteLesson('a');
    expect((await listLessons()).map((row) => row.id)).toEqual(['b']);
    expect(await deleteAllLessons()).toBe(1);
    expect(await listLessons()).toEqual([]);
  });
});
