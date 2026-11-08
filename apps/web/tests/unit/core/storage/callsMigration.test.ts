/**
 * Tests the version-8 upgrade in apps/web/src/core/storage/db.ts and findCalls()/callStartOf() in
 * migrate.ts (v1.1.0, ADR-0041): a device on version 7 keeps every session, answer, transcript line,
 * document, lesson, library item, question bank and Ask Kite chat word for word; answers get the call
 * they belong to, estimated from long gaps; sessions get the length of their latest call. All text is
 * invented.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, forgetDb, getDb } from '@/core/storage/db';
import { CALL_GAP_MS, callStartOf, findCalls } from '@/core/storage/migrate';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

/** The stores of a device on version 7. */
const V7_STORES = {
  sessions: 'id, createdAt, type, status',
  documents: 'id, sessionId',
  utterances: 'id, sessionId',
  answers: 'id, sessionId',
  notes: 'sessionId',
  settings: 'id',
  lessons: 'id, scope',
  library: 'id, kind',
  questionBanks: 'sessionId',
  chats: 'id, updatedAt',
};

describe('findCalls', () => {
  it('finds nothing in nothing, one call in close times, and splits at a long gap', () => {
    expect(findCalls([])).toEqual([]);
    expect(findCalls([5_000, 1_000, 3_000])).toEqual([{ start: 1_000, end: 5_000 }]);
    expect(findCalls([0, 60_000, 60_000 + CALL_GAP_MS + 1, 60_000 + CALL_GAP_MS + 100])).toEqual([
      { start: 0, end: 60_000 },
      { start: 60_000 + CALL_GAP_MS + 1, end: 60_000 + CALL_GAP_MS + 100 },
    ]);
  });

  it('starts a new call at a gap of exactly the limit', () => {
    expect(findCalls([0, CALL_GAP_MS - 1])).toEqual([{ start: 0, end: CALL_GAP_MS - 1 }]);
    expect(findCalls([0, CALL_GAP_MS])).toEqual([
      { start: 0, end: 0 },
      { start: CALL_GAP_MS, end: CALL_GAP_MS },
    ]);
  });
});

describe('callStartOf', () => {
  const calls = [
    { start: 100, end: 200 },
    { start: 5_000, end: 6_000 },
  ];

  it('gives the start of the call a time falls in', () => {
    expect(callStartOf(calls, 150)).toBe(100);
    expect(callStartOf(calls, 5_500)).toBe(5_000);
  });

  it('gives the latest call started by then, for a time between calls', () => {
    expect(callStartOf(calls, 1_000)).toBe(100);
  });

  it('gives the time itself when no call had started', () => {
    expect(callStartOf(calls, 50)).toBe(50);
    expect(callStartOf([], 50)).toBe(50);
  });
});

describe('schema version 8', () => {
  it('keeps everything on a version 7 device, and adds the calls', async () => {
    forgetDb();
    const old = new Dexie(DB_NAME);
    old.version(7).stores(V7_STORES);
    const session = { ...sessionInput(), id: 's1', createdAt: 1, status: 'ended' };
    const quiet = { ...sessionInput(), id: 's2', createdAt: 2, status: 'ready' };
    const secondCall = 10 * CALL_GAP_MS;
    const line = (id: string, tStart: number, text: string) => ({
      id,
      sessionId: 's1',
      speaker: 'them',
      text,
      tStart,
      tEnd: tStart + 1_000,
      final: true,
    });
    const answer = (id: string, createdAt: number) => ({
      id,
      sessionId: 's1',
      mode: 'answer',
      question: 'What does the plan cost?',
      text: 'Forty seats cost 2,080 dollars a month.',
      createdAt,
    });
    const rows = {
      sessions: [session, quiet],
      documents: [{ id: 'd1', sessionId: 's1', name: 'pricing.txt', text: 'Invented prices.' }],
      utterances: [
        line('u1', 0, 'WHAT DOES THE PLAN COST'),
        line('u2', 60_000, 'AND FOR FORTY SEATS'),
        line('u3', secondCall, 'THANKS FOR COMING BACK'),
        line('u4', secondCall + 120_000, 'WHAT ABOUT ONBOARDING'),
      ],
      answers: [answer('a1', 5_000), answer('a2', secondCall + 100_000)],
      notes: [{ sessionId: 's1', text: 'Invented notes.' }],
      lessons: [{ id: 'l1', scope: 'all', text: 'Say the price first.' }],
      library: [{ id: 'b1', kind: 'resume', name: 'cv.txt', text: 'Invented CV.' }],
      questionBanks: [{ sessionId: 's1', questions: ['What does the plan cost?'] }],
      chats: [{ id: 'c1', updatedAt: 9, title: 'Invented chat', messages: [{ text: 'Hello' }] }],
    };
    for (const [store, items] of Object.entries(rows)) await old.table(store).bulkAdd(items);
    old.close();

    const db = getDb();
    await db.open();
    // The latest version: 9 adds only the sync bookkeeping stores (ADR-0049), so nothing else changes.
    expect(db.verno).toBe(9);

    // Everything is still there, word for word, apart from the fields the upgrade adds.
    for (const [store, items] of Object.entries(rows)) {
      const after = await db.table(store).toArray();
      expect(after).toHaveLength(items.length);
      if (store === 'sessions' || store === 'answers') continue;
      expect(after).toEqual(expect.arrayContaining(items as unknown[]));
    }
    const answers = await db.table('answers').toArray();
    expect(answers.find((row) => row.id === 'a1')).toEqual({
      ...answer('a1', 5_000),
      callStartedAt: 0,
    });
    expect(answers.find((row) => row.id === 'a2')).toEqual({
      ...answer('a2', secondCall + 100_000),
      callStartedAt: secondCall,
    });
    const sessions = await db.table('sessions').toArray();
    expect(sessions.find((row) => row.id === 's1')).toEqual({ ...session, lastCallMs: 121_000 });
    // A session with no call yet is left exactly as it was.
    expect(sessions.find((row) => row.id === 's2')).toEqual(quiet);
  });
});
