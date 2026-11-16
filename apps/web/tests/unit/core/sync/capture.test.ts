/**
 * Tests for apps/web/src/core/sync/capture.ts (ADR-0049) with fake-indexeddb, through the real
 * storage repositories on an account's cache: a new record is recorded whole; an update records only
 * the fields that changed; a write that changes nothing records nothing; deleting a session records a
 * delete for it and each of its documents and lines; writes in a transaction marked as remote are not
 * recorded; this device's own database ('kite', no account sync) records nothing; the listener hears
 * which store changed. Invented data only.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDocument } from '@/core/storage/documents';
import { forgetDb, getDb, selectAccountDatabase } from '@/core/storage/db';
import { createSession, deleteSession, updateSession } from '@/core/storage/sessions';
import { saveUtterance } from '@/core/storage/utterances';
import { changedFields, markRemote, onLocalChange } from '@/core/sync/capture';
import { sessionInput } from '../storage/helpers';

/** An invented account id. */
const USER = 'user-capture-test';

beforeEach(async () => {
  selectAccountDatabase(USER);
  await getDb().delete();
  forgetDb();
});

afterEach(async () => {
  onLocalChange(null);
  await getDb().delete();
  selectAccountDatabase(null);
  forgetDb();
});

/**
 * The outbox, oldest first, without sequence numbers and times.
 *
 * @returns The entries.
 */
async function outbox() {
  const entries = await getDb().outbox.orderBy('seq').toArray();
  return entries.map(({ ref, op, changed }) => ({ ref, op, changed }));
}

describe('changedFields', () => {
  it('is null for a new record, and lists only fields that differ', () => {
    expect(changedFields(undefined, { a: 1 })).toBeNull();
    expect(changedFields({ a: 1, b: { c: 2 }, d: 'x' }, { a: 1, b: { c: 3 }, e: true })).toEqual([
      'b',
      'd',
      'e',
    ]);
  });
});

describe('recording changes in the account cache', () => {
  it('records a new session whole, then only the fields an update changed', async () => {
    const session = await createSession(sessionInput());
    await updateSession(session.id, { company: 'Northwind Logistics' });
    expect(await outbox()).toEqual([
      { ref: `sessions|${session.id}`, op: 'put', changed: null },
      { ref: `sessions|${session.id}`, op: 'put', changed: ['company'] },
    ]);
  });

  it('records nothing for a write that changes nothing', async () => {
    const session = await createSession(sessionInput());
    await updateSession(session.id, { company: session.company });
    expect(await outbox()).toHaveLength(1);
  });

  it('records a delete for the session and each of its documents and lines', async () => {
    const session = await createSession(sessionInput());
    const doc = await addDocument({
      sessionId: session.id,
      name: 'notes.txt',
      text: 'Invented text.',
    });
    await saveUtterance({
      id: `${session.id}:call:1`,
      sessionId: session.id,
      speaker: 'them',
      text: 'Invented line.',
      tStart: 1,
      tEnd: 2,
    });
    await getDb().outbox.clear();
    await deleteSession(session.id);
    const deletes = (await outbox()).filter((entry) => entry.op === 'delete').map((e) => e.ref);
    expect(deletes.sort()).toEqual(
      [`documents|${doc.id}`, `sessions|${session.id}`, `utterances|${session.id}:call:1`].sort(),
    );
  });

  it('does not record writes from the server (a remote transaction)', async () => {
    const db = getDb();
    await db.transaction('rw', db.sessions, db.outbox, async (tx) => {
      markRemote(tx.idbtrans);
      await db.sessions.put({ ...(await createSessionRecord()), id: 'remote-1' });
    });
    expect(await outbox()).toEqual([]);
  });

  it('tells the listener which store changed', async () => {
    const heard = vi.fn();
    onLocalChange(heard);
    await createSession(sessionInput());
    expect(heard).toHaveBeenCalledWith('sessions');
  });
});

describe("this device's own database (no account sync)", () => {
  it('records nothing', async () => {
    selectAccountDatabase(null);
    await getDb().delete();
    forgetDb();
    await createSession(sessionInput());
    expect(await getDb().outbox.count()).toBe(0);
    await getDb().delete();
    forgetDb();
  });
});

/**
 * A session record built without the repositories (so no outbox entry is made for it).
 *
 * @returns The record.
 */
async function createSessionRecord() {
  return {
    id: 'remote-1',
    ...sessionInput(),
    createdAt: 1,
    status: 'not-started' as const,
    lastActiveAt: null,
  };
}
