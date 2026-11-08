/**
 * Two devices of one account syncing through the REAL server code (ADR-0049): each "device" is its own
 * account cache (fake-indexeddb) driven by the real storage repositories and src/core/sync/engine.ts,
 * and the "server" is src/server/calldata/store.ts on PGlite (a real Postgres in memory) with test
 * keys. Covers: a session made on one device appears on the other; edits to different fields on two
 * devices both survive (conflict merge); a delete on one device removes the session and its documents
 * and lines on the other, and a stale edit cannot revive it; offline changes wait in the outbox and go
 * once the server answers again; Save transcript off keeps lines off the server; account preferences
 * follow the account; an already-applied revision is not applied again. Invented data only.
 */
import 'fake-indexeddb/auto';
import type { SyncOp } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDocument, listDocuments } from '@/core/storage/documents';
import { forgetDb, getDb, selectAccountDatabase } from '@/core/storage/db';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from '@/core/storage/sessions';
import { listUtterances, saveUtterance } from '@/core/storage/utterances';
import { pullAll, pushOnce, type SyncTransport } from '@/core/sync/engine';
import { accountPrefChanged } from '@/core/sync/prefsSignal';
import { applyOps, pullChanges, type StoreContext } from '@/server/calldata/store';
import { ALICE, createTestDb } from '../../server/calldata/pgliteDb';
import { sessionInput } from '../storage/helpers';

/** The two devices' cache names (one account, two browsers). */
const DEVICE_A = `${ALICE}-device-a`;
const DEVICE_B = `${ALICE}-device-b`;

let server: StoreContext;
let offline = false;

/** The transport: the real server functions, as the routes would call them (JSON round trip). */
const transport: SyncTransport = {
  async push(ops: SyncOp[]) {
    if (offline) throw new TypeError('Failed to fetch');
    return { results: await applyOps(server, JSON.parse(JSON.stringify(ops)) as SyncOp[]) };
  },
  async pull(since, after) {
    if (offline) throw new TypeError('Failed to fetch');
    return JSON.parse(JSON.stringify(await pullChanges(server, since, after)));
  },
};

/**
 * Switches the storage modules to a device's cache.
 *
 * @param device The device's cache name.
 */
function on(device: string): void {
  selectAccountDatabase(device);
}

/** Pushes everything a device has waiting (several rounds when needed). */
async function pushAll(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    const done = await pushOnce(getDb(), transport);
    if (!done.more) break;
  }
}

beforeEach(async () => {
  const t = await createTestDb();
  server = { db: t.db, keys: t.keys, userId: ALICE };
  offline = false;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const device of [DEVICE_A, DEVICE_B]) {
    on(device);
    await getDb().delete();
  }
  selectAccountDatabase(null);
  forgetDb();
  vi.unstubAllGlobals();
});

describe('two devices of one account', () => {
  it('a session made on one device appears on the other', async () => {
    on(DEVICE_A);
    const session = await createSession(sessionInput({ company: 'Invented One' }));
    await addDocument({ sessionId: session.id, name: 'cv.txt', text: 'Invented CV.' });
    await pushAll();
    expect(await getDb().outbox.count()).toBe(0);

    on(DEVICE_B);
    await pullAll(getDb(), transport);
    expect((await listSessions()).map((s) => s.company)).toEqual(['Invented One']);
    expect((await listDocuments(session.id)).map((d) => d.name)).toEqual(['cv.txt']);
  });

  it('edits to different fields on two devices both survive', async () => {
    on(DEVICE_A);
    const session = await createSession(sessionInput({ company: 'Before', role: 'Before' }));
    await pushAll();
    on(DEVICE_B);
    await pullAll(getDb(), transport);

    on(DEVICE_A);
    await updateSession(session.id, { company: 'Changed on A' });
    on(DEVICE_B);
    await updateSession(session.id, { role: 'Changed on B' });
    on(DEVICE_A);
    await pushAll();
    on(DEVICE_B);
    await pushAll(); // conflict → merge (keeps B's role, takes A's company) → resend
    expect(await getSession(session.id)).toMatchObject({
      company: 'Changed on A',
      role: 'Changed on B',
    });
    on(DEVICE_A);
    await pullAll(getDb(), transport);
    expect(await getSession(session.id)).toMatchObject({
      company: 'Changed on A',
      role: 'Changed on B',
    });
  });

  it('a delete on one device removes the session, its documents and lines on the other', async () => {
    on(DEVICE_A);
    const session = await createSession(sessionInput());
    await addDocument({ sessionId: session.id, name: 'a.txt', text: 'Invented.' });
    await saveUtterance({
      id: `${session.id}:call:1`,
      sessionId: session.id,
      speaker: 'them',
      text: 'Invented line.',
      tStart: 1,
      tEnd: 2,
    });
    await pushAll();
    on(DEVICE_B);
    await pullAll(getDb(), transport);
    expect(await listUtterances(session.id)).toHaveLength(1);

    on(DEVICE_A);
    await updateSession(session.id, { company: 'Stale edit' }); // not pushed yet
    on(DEVICE_B);
    await deleteSession(session.id);
    await pushAll();

    on(DEVICE_A);
    await pushAll(); // the stale edit: the server says deleted, so A removes its copy
    await pullAll(getDb(), transport);
    expect(await getSession(session.id)).toBeNull();
    expect(await listDocuments(session.id)).toEqual([]);
    expect(await listUtterances(session.id)).toEqual([]);
  });

  it('offline changes wait in the outbox and go once the server answers', async () => {
    on(DEVICE_A);
    offline = true;
    await createSession(sessionInput({ company: 'Made offline' }));
    await expect(pushOnce(getDb(), transport)).rejects.toThrow('Failed to fetch');
    expect(await getDb().outbox.count()).toBe(1);
    offline = false;
    await pushAll();
    expect(await getDb().outbox.count()).toBe(0);
    on(DEVICE_B);
    await pullAll(getDb(), transport);
    expect((await listSessions()).map((s) => s.company)).toEqual(['Made offline']);
  });

  it('Save transcript off: lines never reach the server', async () => {
    on(DEVICE_A);
    const session = await createSession(sessionInput({ saveTranscript: false }));
    await saveUtterance({
      id: `${session.id}:call:1`,
      sessionId: session.id,
      speaker: 'you',
      text: 'Invented line.',
      tStart: 1,
      tEnd: 2,
    });
    await pushAll();
    expect(await getDb().outbox.count()).toBe(0);
    const stored = await pullChanges(server, 0, null);
    expect(stored.records.map((r) => r.kind)).toEqual(['session']);
  });

  it('applies a revision once: a second pull of the same changes changes nothing', async () => {
    on(DEVICE_A);
    await createSession(sessionInput());
    await pushAll();
    on(DEVICE_B);
    expect(await pullAll(getDb(), transport)).toBe(1);
    // The next pull reaches back over the same change (overlap): it is skipped.
    expect(await pullAll(getDb(), transport)).toBe(0);
  });
});

describe('account preferences', () => {
  it('follow the account from one device to the other', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    on(DEVICE_A);
    store.set('kite.companySuggestions', 'off');
    store.set('kite.codingLanguage', 'Go');
    // What the setters do, without the listener of a running sync: mark the preferences changed.
    await getDb().syncMeta.put({ id: 'prefs', value: Date.now() });
    accountPrefChanged();
    await pushAll();
    expect(await getDb().syncMeta.get('prefs')).toBeUndefined();

    store.clear();
    on(DEVICE_B);
    await pullAll(getDb(), transport);
    expect(store.get('kite.companySuggestions')).toBe('off');
    expect(store.get('kite.codingLanguage')).toBe('Go');
    expect(store.has('kite.autoAnswer')).toBe(false);
  });
});
