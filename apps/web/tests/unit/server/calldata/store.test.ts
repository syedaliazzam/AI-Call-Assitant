/**
 * Tests for apps/web/src/server/calldata/store.ts (ADR-0049) against a real Postgres in memory (PGlite)
 * with the committed migrations: put with a base revision (accepted, conflict with the server's copy,
 * never reviving a delete), insert-if-missing, deleting a session takes its documents, lines, answers,
 * notes and question bank but not its lessons, Save transcript off (lines refused, existing lines
 * removed), clear lines, delete all, cross-account isolation (another account never sees, changes or
 * deletes a record), records stored only as ciphertext bound to their row, key versions, and pulls
 * page by page without losing or repeating a change.
 */
import { SYNC_LIMITS, type SyncOp, type SyncOpResult } from '@kite/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDataKeys } from '@/server/calldata/crypto';
import {
  applyOps,
  decodeCursor,
  pullChanges,
  readRecord,
  type StoreContext,
} from '@/server/calldata/store';
import { ALICE, BOB, createTestDb, testKeyEnv, type TestDb, resetTestDb } from './pgliteDb';

/** Invented ids. */
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';
const ANSWER = '44444444-4444-4444-8444-444444444444';
const LESSON = '55555555-5555-4555-8555-555555555555';
const LINE = `${S1}:call-1:line-1`;

let t: TestDb;
let alice: StoreContext;
let bob: StoreContext;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb(t);
  alice = { db: t.db, keys: t.keys, userId: ALICE };
  bob = { db: t.db, keys: t.keys, userId: BOB };
});

/**
 * A put of a new session.
 *
 * @param id             The session id.
 * @param saveTranscript Whether it saves its transcript.
 * @returns The operation.
 */
function newSession(id: string, saveTranscript = true): SyncOp {
  return {
    op: 'put',
    kind: 'session',
    id,
    baseRev: null,
    record: { id, company: 'Invented Co', role: 'Engineer', saveTranscript },
  };
}

/**
 * The revision of a push whose first result is ok.
 *
 * @param results The push results.
 * @returns The first result, with its revision.
 */
function revOf(results: SyncOpResult[]): { rev: number } {
  const [first] = results;
  if (first?.status !== 'ok') throw new Error(`expected ok, got ${first?.status}`);
  return first;
}

/**
 * Raw rows, read past the store (to check what is really stored).
 *
 * @returns The rows of call_record.
 */
async function rawRows() {
  const result = await t.pg.query<{
    user_id: string;
    kind: string;
    id: string;
    deleted: boolean;
    content: string | null;
    key_version: number | null;
  }>('SELECT user_id, kind, id, deleted, content, key_version FROM call_record');
  return result.rows;
}

describe('put', () => {
  it('stores a new record and returns its revision', async () => {
    const [result] = await applyOps(alice, [newSession(S1)]);
    expect(result).toMatchObject({ status: 'ok' });
    const read = await readRecord(alice, 'session', S1);
    expect(read?.record).toMatchObject({ company: 'Invented Co' });
    expect(read?.rev).toBe((result as { rev: number }).rev);
  });

  it('changes it when the base revision is current, and returns a newer revision', async () => {
    const first = revOf(await applyOps(alice, [newSession(S1)]));
    const [second] = await applyOps(alice, [
      {
        op: 'put',
        kind: 'session',
        id: S1,
        baseRev: first.rev,
        record: { id: S1, company: 'Renamed Co', saveTranscript: true },
      },
    ]);
    expect(second).toMatchObject({ status: 'ok' });
    expect((second as { rev: number }).rev).toBeGreaterThan(first.rev);
    expect((await readRecord(alice, 'session', S1))?.record).toMatchObject({
      company: 'Renamed Co',
    });
  });

  it('returns a conflict with the server copy when the base revision is old', async () => {
    const first = revOf(await applyOps(alice, [newSession(S1)]));
    await applyOps(alice, [
      {
        op: 'put',
        kind: 'session',
        id: S1,
        baseRev: first.rev,
        record: { id: S1, company: 'Device A' },
      },
    ]);
    const [stale] = await applyOps(alice, [
      {
        op: 'put',
        kind: 'session',
        id: S1,
        baseRev: first.rev,
        record: { id: S1, company: 'Device B' },
      },
    ]);
    expect(stale).toMatchObject({ status: 'conflict', record: { company: 'Device A' } });
    expect((await readRecord(alice, 'session', S1))?.record).toMatchObject({ company: 'Device A' });
  });

  it('treats a create of an id that exists as a conflict', async () => {
    await applyOps(alice, [newSession(S1)]);
    const [again] = await applyOps(alice, [newSession(S1)]);
    expect(again).toMatchObject({ status: 'conflict' });
  });
});

describe('insert (the one-time upload)', () => {
  it('adds a missing record and reports one already there', async () => {
    const insert: SyncOp = { op: 'insert', kind: 'library', id: DOC, record: { name: 'cv.txt' } };
    expect((await applyOps(alice, [insert]))[0]).toMatchObject({ status: 'ok' });
    expect((await applyOps(alice, [insert]))[0]).toEqual({ status: 'exists' });
  });
});

describe('delete', () => {
  it('takes a session with its documents, lines, answers, notes and question bank, not its lessons', async () => {
    await applyOps(alice, [
      newSession(S1),
      { op: 'put', kind: 'document', id: DOC, sessionId: S1, baseRev: null, record: { text: 'x' } },
      {
        op: 'put',
        kind: 'utterance',
        id: LINE,
        sessionId: S1,
        baseRev: null,
        record: { text: 'x' },
      },
      {
        op: 'put',
        kind: 'answer',
        id: ANSWER,
        sessionId: S1,
        baseRev: null,
        record: { text: 'x' },
      },
      { op: 'put', kind: 'notes', id: S1, sessionId: S1, baseRev: null, record: { notes: {} } },
      {
        op: 'put',
        kind: 'questionBank',
        id: S1,
        sessionId: S1,
        baseRev: null,
        record: { groups: [] },
      },
      { op: 'put', kind: 'lesson', id: LESSON, baseRev: null, record: { text: 'Be brief' } },
    ]);
    await applyOps(alice, [{ op: 'delete', kind: 'session', id: S1 }]);
    const rows = await rawRows();
    const live = rows.filter((row) => !row.deleted).map((row) => row.kind);
    expect(live).toEqual(['lesson']);
    // Tombstones keep no content and no key.
    for (const row of rows.filter((row) => row.deleted)) {
      expect(row.content).toBeNull();
      expect(row.key_version).toBeNull();
    }
  });

  it('never revives a deleted record: a later put reports it deleted', async () => {
    const first = revOf(await applyOps(alice, [newSession(S1)]));
    await applyOps(alice, [{ op: 'delete', kind: 'session', id: S1 }]);
    const [late] = await applyOps(alice, [
      { op: 'put', kind: 'session', id: S1, baseRev: first.rev, record: { id: S1 } },
    ]);
    expect(late).toEqual({ status: 'deleted' });
    expect(await readRecord(alice, 'session', S1)).toBeNull();
  });

  it('leaves a tombstone for a record the server never had', async () => {
    await applyOps(alice, [{ op: 'delete', kind: 'answer', id: ANSWER }]);
    const { records } = await pullChanges(alice, 0, null);
    expect(records).toEqual([
      expect.objectContaining({ kind: 'answer', id: ANSWER, deleted: true, record: null }),
    ]);
  });

  it('delete all removes every record of this account only', async () => {
    await applyOps(alice, [newSession(S1), newSession(S2)]);
    await applyOps(bob, [newSession(S1)]);
    await applyOps(alice, [{ op: 'deleteAll' }]);
    expect(await readRecord(alice, 'session', S1)).toBeNull();
    expect(await readRecord(alice, 'session', S2)).toBeNull();
    expect(await readRecord(bob, 'session', S1)).not.toBeNull();
  });
});

describe('Save transcript off', () => {
  it('refuses lines for a session that does not save its transcript', async () => {
    await applyOps(alice, [newSession(S1, false)]);
    const [line] = await applyOps(alice, [
      {
        op: 'put',
        kind: 'utterance',
        id: LINE,
        sessionId: S1,
        baseRev: null,
        record: { text: 'x' },
      },
    ]);
    expect(line).toEqual({ status: 'refused', reason: 'transcript_off' });
    const [inserted] = await applyOps(alice, [
      { op: 'insert', kind: 'utterance', id: LINE, sessionId: S1, record: { text: 'x' } },
    ]);
    expect(inserted).toEqual({ status: 'refused', reason: 'transcript_off' });
    expect((await rawRows()).some((row) => row.kind === 'utterance')).toBe(false);
  });

  it('refuses a line whose session is not stored yet', async () => {
    const [line] = await applyOps(alice, [
      {
        op: 'put',
        kind: 'utterance',
        id: LINE,
        sessionId: S1,
        baseRev: null,
        record: { text: 'x' },
      },
    ]);
    expect(line).toEqual({ status: 'refused', reason: 'unknown_session' });
  });

  it('turning it off removes the lines already stored', async () => {
    const first = revOf(await applyOps(alice, [newSession(S1)]));
    await applyOps(alice, [
      {
        op: 'put',
        kind: 'utterance',
        id: LINE,
        sessionId: S1,
        baseRev: null,
        record: { text: 'x' },
      },
    ]);
    await applyOps(alice, [
      {
        op: 'put',
        kind: 'session',
        id: S1,
        baseRev: first.rev,
        record: { id: S1, saveTranscript: false },
      },
    ]);
    expect(await readRecord(alice, 'utterance', LINE)).toBeNull();
    const line = (await rawRows()).find((row) => row.kind === 'utterance');
    expect(line).toMatchObject({ deleted: true, content: null });
  });

  it('clear lines removes a session’s lines only', async () => {
    await applyOps(alice, [
      newSession(S1),
      {
        op: 'put',
        kind: 'utterance',
        id: LINE,
        sessionId: S1,
        baseRev: null,
        record: { text: 'x' },
      },
      {
        op: 'put',
        kind: 'answer',
        id: ANSWER,
        sessionId: S1,
        baseRev: null,
        record: { text: 'x' },
      },
    ]);
    await applyOps(alice, [{ op: 'clearLines', sessionId: S1 }]);
    expect(await readRecord(alice, 'utterance', LINE)).toBeNull();
    expect(await readRecord(alice, 'answer', ANSWER)).not.toBeNull();
  });
});

describe('another account', () => {
  it('cannot read, list, change or delete a record', async () => {
    await applyOps(alice, [newSession(S1)]);
    expect(await readRecord(bob, 'session', S1)).toBeNull();
    expect((await pullChanges(bob, 0, null)).records).toEqual([]);
    // Bob's put of the same id makes Bob's own record; Alice's stays as it was.
    await applyOps(bob, [
      { op: 'put', kind: 'session', id: S1, baseRev: null, record: { id: S1, company: 'Bob Co' } },
    ]);
    await applyOps(bob, [{ op: 'delete', kind: 'session', id: S1 }]);
    expect((await readRecord(alice, 'session', S1))?.record).toMatchObject({
      company: 'Invented Co',
    });
  });
});

describe('encryption at rest', () => {
  it('stores no readable text, and a ciphertext moved to another row fails to open', async () => {
    await applyOps(alice, [newSession(S1), newSession(S2)]);
    const rows = await rawRows();
    for (const row of rows) {
      expect(row.content).not.toContain('Invented');
      expect(Buffer.from(row.content!, 'base64').toString('utf8')).not.toContain('Invented');
      expect(row.key_version).toBe(1);
    }
    // Swap the two sessions' ciphertexts: each is bound to its own row, so reading fails.
    await t.pg.query(
      `UPDATE call_record SET content = (SELECT content FROM call_record WHERE id = $1) WHERE id = $2`,
      [S1, S2],
    );
    await expect(readRecord(alice, 'session', S2)).rejects.toThrow();
  });

  it('writes with the newest key version and still reads older rows', async () => {
    const env = testKeyEnv([1]);
    const v1 = { ...alice, keys: loadDataKeys(env) };
    await applyOps(v1, [newSession(S1)]);
    const v2 = { ...alice, keys: loadDataKeys({ ...env, ...testKeyEnv([2]) }) };
    await applyOps(v2, [newSession(S2)]);
    const versions = Object.fromEntries((await rawRows()).map((row) => [row.id, row.key_version]));
    expect(versions).toEqual({ [S1]: 1, [S2]: 2 });
    expect(await readRecord(v2, 'session', S1)).not.toBeNull();
    // Without key 1, its rows cannot be read: the error names the variable, never a value.
    const onlyV2 = { ...alice, keys: loadDataKeys(testKeyEnv([2])) };
    await expect(readRecord(onlyV2, 'session', S1)).rejects.toThrow('KITE_DATA_KEY_V1 is not set.');
  });
});

describe('pull', () => {
  it('pages through every change once, in order', async () => {
    const total = SYNC_LIMITS.pullRows + 25;
    const ops: SyncOp[] = Array.from({ length: total }, (_, index) => ({
      op: 'put',
      kind: 'lesson',
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      baseRev: null,
      record: { text: `lesson ${index}` },
    }));
    for (let start = 0; start < total; start += SYNC_LIMITS.opsPerPush) {
      await applyOps(alice, ops.slice(start, start + SYNC_LIMITS.opsPerPush));
    }
    const first = await pullChanges(alice, 0, null);
    expect(first.records).toHaveLength(SYNC_LIMITS.pullRows);
    expect(first.next).not.toBeNull();
    const second = await pullChanges(alice, 0, first.next);
    expect(second.next).toBeNull();
    const ids = [...first.records, ...second.records].map((record) => record.id);
    expect(new Set(ids).size).toBe(total);
  });

  it('returns only changes after `since`, and the server time', async () => {
    await applyOps(alice, [newSession(S1)]);
    const later = Date.now() + 60_000;
    const page = await pullChanges(alice, later, null, 1234);
    expect(page).toEqual({ records: [], serverTime: 1234, next: null });
  });

  it('rejects a page token it did not write', async () => {
    await expect(pullChanges(alice, 0, 'not-a-token')).rejects.toThrow('BAD_CURSOR');
    expect(decodeCursor(Buffer.from('[1,"a"]').toString('base64url'))).toBeNull();
  });
});
