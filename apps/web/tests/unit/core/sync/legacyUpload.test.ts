/**
 * Tests for apps/web/src/core/sync/legacyUpload.ts (ADR-0049, Phase 4), the one-time upload, with a
 * legacy-database harness: this device's own 'kite' database is filled through the real storage
 * repositories (fake-indexeddb), then uploaded into the REAL server code (src/server/calldata/store.ts
 * on PGlite). Covers: the summary counts what the device holds (none when it has no database); the
 * upload adds each session with its documents, lines and answers, and the account cache has them
 * afterwards; uploading again adds nothing ("already there"); two devices holding the same session
 * combine its records by id without duplicates; a lesson or library item the account already has is
 * not added again; the device's own database is not changed; the done marker. Invented data only.
 */
import 'fake-indexeddb/auto';
import type { SyncOp } from '@kite/shared';
import Dexie from 'dexie';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, forgetDb, getDb, selectAccountDatabase } from '@/core/storage/db';
import { addDocument, listDocuments } from '@/core/storage/documents';
import { saveLesson } from '@/core/storage/lessons';
import { addLibraryItem } from '@/core/storage/library';
import { createSession, listSessions } from '@/core/storage/sessions';
import { listUtterances, saveUtterance } from '@/core/storage/utterances';
import type { SyncTransport } from '@/core/sync/engine';
import {
  legacySummary,
  legacyUploadDone,
  markLegacyUploadDone,
  uploadLegacyData,
} from '@/core/sync/legacyUpload';
import { applyOps, pullChanges, type StoreContext } from '@/server/calldata/store';
import { ALICE, createTestDb, resetTestDb, type TestDb } from '../../server/calldata/pgliteDb';
import { sessionInput } from '../storage/helpers';

let server: StoreContext;

/** The real server functions as the routes would call them. */
const transport: SyncTransport = {
  push: async (ops: SyncOp[]) => ({
    results: await applyOps(server, JSON.parse(JSON.stringify(ops)) as SyncOp[]),
  }),
  pull: async (since, after) => JSON.parse(JSON.stringify(await pullChanges(server, since, after))),
};

/** Switches to this device's own database ('kite'), to fill it as the app did before sync. */
function onDeviceData(): void {
  selectAccountDatabase(null);
}

/** Switches to the account's cache, as a synced page does. */
function onAccountCache(): void {
  selectAccountDatabase(ALICE);
}

/** Empties both databases (a "new device"). */
async function newDevice(): Promise<void> {
  onAccountCache();
  await getDb().delete();
  forgetDb();
  await Dexie.delete(DB_NAME);
}

/**
 * Server records of a kind.
 *
 * @param kind The kind.
 * @returns The live (not deleted) records.
 */
async function onServer(kind: string) {
  return (await pullChanges(server, 0, null)).records.filter((r) => r.kind === kind && !r.deleted);
}

/**
 * A session with a document and a line, on this device's own database.
 *
 * @param company The company.
 * @returns The session's id.
 */
async function seedSession(company: string): Promise<string> {
  onDeviceData();
  const session = await createSession(sessionInput({ company }));
  await addDocument({ sessionId: session.id, name: `${company}.txt`, text: 'Invented text.' });
  await saveUtterance({
    id: `${session.id}:call:1`,
    sessionId: session.id,
    speaker: 'them',
    text: 'Invented line.',
    tStart: 1,
    tEnd: 2,
  });
  return session.id;
}

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb(t);
  server = { db: t.db, keys: t.keys, userId: ALICE };
  await newDevice();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(async () => {
  await newDevice();
  selectAccountDatabase(null);
  forgetDb();
  vi.unstubAllGlobals();
});

describe('legacySummary', () => {
  it('is null when this device has no database of its own', async () => {
    onAccountCache();
    expect(await legacySummary()).toBeNull();
  });

  it('counts sessions and other items', async () => {
    await seedSession('Invented One');
    onDeviceData();
    await addLibraryItem('resume', 'cv.txt', 'Invented CV.');
    onAccountCache();
    expect(await legacySummary()).toEqual({ sessions: 1, other: 1 });
  });
});

describe('uploadLegacyData', () => {
  it('adds every session with its records, then the account cache has them; again adds nothing', async () => {
    const one = await seedSession('Invented One');
    await seedSession('Invented Two');
    onAccountCache();
    const progress = vi.fn();
    expect(await uploadLegacyData(progress, transport)).toEqual({
      added: 2,
      existing: 0,
      skipped: 0,
      total: 2,
    });
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    expect((await listSessions()).map((s) => s.company).sort()).toEqual([
      'Invented One',
      'Invented Two',
    ]);
    expect(await listDocuments(one)).toHaveLength(1);
    expect(await listUtterances(one)).toHaveLength(1);

    expect(await uploadLegacyData(undefined, transport)).toEqual({
      added: 0,
      existing: 2,
      skipped: 0,
      total: 2,
    });
    expect(await onServer('session')).toHaveLength(2);
    expect(await onServer('document')).toHaveLength(2);
  });

  it('combines two devices holding the same session, without duplicates', async () => {
    const id = await seedSession('Shared');
    onAccountCache();
    await uploadLegacyData(undefined, transport);

    // A second device has the same session (from the old file hand-off), plus a line of its own.
    const copy = (await getDb().sessions.get(id))!;
    const documents = await listDocuments(id);
    await newDevice();
    onDeviceData();
    await getDb().sessions.put(copy);
    await getDb().documents.bulkPut(documents);
    await saveUtterance({
      id: `${id}:call:2`,
      sessionId: id,
      speaker: 'you',
      text: 'Another invented line.',
      tStart: 3,
      tEnd: 4,
    });
    onAccountCache();
    expect(await uploadLegacyData(undefined, transport)).toMatchObject({ added: 0, existing: 1 });
    expect(await onServer('session')).toHaveLength(1);
    expect(await onServer('document')).toHaveLength(1);
    expect((await onServer('utterance')).map((r) => r.id).sort()).toEqual([
      `${id}:call:1`,
      `${id}:call:2`,
    ]);
  });

  it('skips a lesson or library item the account already has', async () => {
    onDeviceData();
    await saveLesson({
      id: 'lesson-device',
      text: 'Keep answers short.',
      scope: 'all',
      status: 'approved',
      sourceSessionId: 'old',
      sourceKey: 'keep answers short',
      evidence: '',
      decidedAt: 1,
      approvedAt: 1,
    });
    await addLibraryItem('resume', 'cv.txt', 'Invented CV.');
    // The account already has both, under other ids (added from another device).
    await transport.push([
      {
        op: 'put',
        kind: 'lesson',
        id: 'lesson-account',
        baseRev: null,
        record: {
          id: 'lesson-account',
          text: 'Keep answers short.',
          sourceKey: 'keep answers short',
        },
      },
      {
        op: 'put',
        kind: 'library',
        id: 'item-account',
        baseRev: null,
        record: { id: 'item-account', kind: 'resume', name: 'cv.txt', text: 'Invented CV.' },
      },
    ]);
    onAccountCache();
    await uploadLegacyData(undefined, transport);
    expect((await onServer('lesson')).map((r) => r.id)).toEqual(['lesson-account']);
    expect((await onServer('library')).map((r) => r.id)).toEqual(['item-account']);
  });

  it("leaves this device's own database as it was", async () => {
    await seedSession('Kept');
    onAccountCache();
    await uploadLegacyData(undefined, transport);
    onDeviceData();
    expect((await listSessions()).map((s) => s.company)).toEqual(['Kept']);
  });
});

describe('done marker', () => {
  it('is per account', () => {
    expect(legacyUploadDone(ALICE)).toBe(false);
    markLegacyUploadDone(ALICE);
    expect(legacyUploadDone(ALICE)).toBe(true);
    expect(legacyUploadDone('someone-else')).toBe(false);
  });
});
