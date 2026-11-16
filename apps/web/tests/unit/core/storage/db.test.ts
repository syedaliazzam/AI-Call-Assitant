/**
 * Tests for apps/web/src/core/storage/db.ts, the choice of database (privacy fix of 14 Nov 2026): every
 * signed-in account has its own sync cache on this device ('kite-u-<id>'; account sync is always on,
 * ADR-0092), so switching accounts on one computer never shows one account's sessions to another; an
 * account's old local database ('kite-l-<id>') is never opened for it and records nothing for sync; the old shared 'kite'
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
  selectDatabaseForTests,
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
  selectAccountDatabase(null);
  await deleteAll();
});

describe('selectAccountDatabase', () => {
  it("names each account's own database, and 'kite' only without an account", () => {
    selectAccountDatabase(A);
    expect(activeDatabaseName()).toBe(accountDbName(A));
    expect(usingAccountDatabase()).toBe(true);
    selectDatabaseForTests(localAccountDbName(A));
    expect(activeDatabaseName()).toBe(localAccountDbName(A));
    expect(usingAccountDatabase()).toBe(false);
    selectAccountDatabase(null);
    expect(activeDatabaseName()).toBe(DB_NAME);
    expect(usingAccountDatabase()).toBe(false);
  });

  it("keeps A's sessions invisible to B on the same computer", async () => {
    selectAccountDatabase(A);
    await createSession(sessionInput({ company: 'Only A' }));
    selectAccountDatabase(B);
    expect(await listSessions()).toEqual([]);
    await createSession(sessionInput({ company: 'Only B' }));
    expect((await listSessions()).map((s) => s.company)).toEqual(['Only B']);
    selectAccountDatabase(A);
    expect((await listSessions()).map((s) => s.company)).toEqual(['Only A']);
  });

  it("never shows the old shared 'kite' database to a signed-in account", async () => {
    selectAccountDatabase(null);
    await createSession(sessionInput({ company: 'Ownerless' }));
    selectAccountDatabase(A);
    expect(await listSessions()).toEqual([]);
  });

  it('a signed-in account always opens its sync cache, never its old local database (ADR-0092)', async () => {
    selectDatabaseForTests(localAccountDbName(A));
    await createSession(sessionInput({ company: 'Old local' }));
    selectAccountDatabase(A);
    expect(activeDatabaseName()).toBe(accountDbName(A));
    expect(usingAccountDatabase()).toBe(true);
    expect(await listSessions()).toEqual([]);
  });

  it("records nothing for sync in an account's old local database", async () => {
    selectDatabaseForTests(localAccountDbName(A));
    await createSession(sessionInput());
    expect(await getDb().outbox.count()).toBe(0);
    selectAccountDatabase(A);
    await createSession(sessionInput());
    expect(await getDb().outbox.count()).toBeGreaterThan(0);
  });
});
