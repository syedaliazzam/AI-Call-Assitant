/**
 * Tests for apps/web/src/core/storage/db.ts, the choice of database (privacy fix of 14 Nov 2026): every
 * signed-in account has its own database on this device ('kite-u-<id>' with account sync, 'kite-l-<id>'
 * without), so switching accounts on one computer never shows one account's sessions to another, with
 * or without sync; an account's local database records nothing for sync; the old shared 'kite'
 * database is only chosen without an account (tests and harnesses). Invented data only.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  accountDbName,
  activeDatabaseName,
  forgetDb,
  getDb,
  localAccountDbName,
  selectAccountDatabase,
  usingAccountDatabase,
} from '@/core/storage/db';
import { createSession, listSessions } from '@/core/storage/sessions';
import { sessionInput } from './helpers';

/** Two invented accounts on one computer. */
const A = 'account-a-test';
const B = 'account-b-test';

/** Deletes every database these tests use. */
async function deleteAll(): Promise<void> {
  forgetDb();
  for (const name of [
    DB_NAME,
    accountDbName(A),
    accountDbName(B),
    localAccountDbName(A),
    localAccountDbName(B),
  ]) {
    await Dexie.delete(name);
  }
}

beforeEach(deleteAll);

afterEach(async () => {
  selectAccountDatabase(null, false);
  await deleteAll();
});

describe('selectAccountDatabase', () => {
  it("names each account's own database, and 'kite' only without an account", () => {
    selectAccountDatabase(A, true);
    expect(activeDatabaseName()).toBe(accountDbName(A));
    expect(usingAccountDatabase()).toBe(true);
    selectAccountDatabase(A, false);
    expect(activeDatabaseName()).toBe(localAccountDbName(A));
    expect(usingAccountDatabase()).toBe(false);
    selectAccountDatabase(null, true);
    expect(activeDatabaseName()).toBe(DB_NAME);
    expect(usingAccountDatabase()).toBe(false);
  });

  it.each([
    ['with account sync', true],
    ['without account sync', false],
  ])("keeps A's sessions invisible to B on the same computer (%s)", async (_label, sync) => {
    selectAccountDatabase(A, sync);
    await createSession(sessionInput({ company: 'Only A' }));
    selectAccountDatabase(B, sync);
    expect(await listSessions()).toEqual([]);
    await createSession(sessionInput({ company: 'Only B' }));
    expect((await listSessions()).map((s) => s.company)).toEqual(['Only B']);
    selectAccountDatabase(A, sync);
    expect((await listSessions()).map((s) => s.company)).toEqual(['Only A']);
  });

  it("never shows the old shared 'kite' database to a signed-in account", async () => {
    selectAccountDatabase(null, false);
    await createSession(sessionInput({ company: 'Ownerless' }));
    for (const sync of [true, false]) {
      selectAccountDatabase(A, sync);
      expect(await listSessions()).toEqual([]);
    }
  });

  it("records nothing for sync in an account's local database", async () => {
    selectAccountDatabase(A, false);
    await createSession(sessionInput());
    expect(await getDb().outbox.count()).toBe(0);
    selectAccountDatabase(A, true);
    await createSession(sessionInput());
    expect(await getDb().outbox.count()).toBeGreaterThan(0);
  });
});
