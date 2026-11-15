/**
 * Two devices of one account syncing through the REAL server code (ADR-0049): each "device" is its own
 * account cache (fake-indexeddb) driven by the real storage repositories and src/core/sync/engine.ts,
 * and the "server" is src/server/calldata/store.ts on PGlite (a real Postgres in memory) with test
 * keys. Covers: a session made on one device appears on the other; edits to different fields on two
 * devices both survive (conflict merge); a delete on one device removes the session and its documents
 * and lines on the other, and a stale edit cannot revive it; offline changes wait in the outbox and go
 * once the server answers again; Save transcript off keeps lines off the server; account preferences
 * follow the account; an already-applied revision is not applied again. ADR-0067: two 250k-character
 * documents (one in a 3-byte script) and a session's documents summary go in pushes the server
 * accepts (checkPush(), under its byte limit) and arrive on the other device unchanged, through the
 * real encryption. Invented data only.
 */
import 'fake-indexeddb/auto';
import { SYNC_LIMITS, type SyncOp } from '@kite/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { checkPush } from '@/server/calldata/validate';
import { ALICE, createTestDb, resetTestDb, type TestDb } from '../../server/calldata/pgliteDb';
import { sessionInput } from '../storage/helpers';

/** The two devices' cache names (one account, two browsers). */
const DEVICE_A = `${ALICE}-device-a`;
const DEVICE_B = `${ALICE}-device-b`;

let server: StoreContext;
let offline = false;
/** UTF-8 sizes of the push bodies sent, and whether the server's body check accepted each. */
let pushed: { bytes: number; accepted: boolean }[] = [];

/** The transport: the real server functions, as the routes would call them (JSON round trip). */
const transport: SyncTransport = {
  async push(ops: SyncOp[]) {
    if (offline) throw new TypeError('Failed to fetch');
    // The body as httpTransport sends it, checked as POST /api/sync/push checks it.
    const body = JSON.stringify({ ops });
    pushed.push({ bytes: Buffer.byteLength(body), accepted: checkPush(body).ok });
    return { results: await applyOps(server, JSON.parse(body).ops as SyncOp[]) };
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
  selectAccountDatabase(device, true);
}

/** Pushes everything a device has waiting (several rounds when needed). */
async function pushAll(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    const done = await pushOnce(getDb(), transport);
    if (!done.more) break;
  }
}

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb(t);
  server = { db: t.db, keys: t.keys, userId: ALICE };
  offline = false;
  pushed = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const device of [DEVICE_A, DEVICE_B]) {
    on(device);
    await getDb().delete();
  }
  selectAccountDatabase(null, false);
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

describe('large documents (ADR-0067)', () => {
  it('two 250k-character documents and a summary sync in accepted pushes and arrive unchanged', async () => {
    on(DEVICE_A);
    const session = await createSession(sessionInput({ company: 'Invented Large' }));
    const english = 'Invented handbook line. '.repeat(10_417).slice(0, 250_000);
    const japanese = '日本語の資料'.repeat(41_667).slice(0, 250_000);
    await addDocument({ sessionId: session.id, name: 'en.txt', text: english });
    await addDocument({ sessionId: session.id, name: 'ja.txt', text: japanese });
    const summary = { fingerprint: 'f'.repeat(64), text: '## en.txt\n- Invented.', createdAt: 7 };
    await updateSession(session.id, { documentsSummary: summary });
    await pushAll();
    expect(await getDb().outbox.count()).toBe(0);
    expect(pushed.length).toBeGreaterThan(0);
    for (const push of pushed) {
      expect(push.accepted).toBe(true);
      expect(push.bytes).toBeLessThanOrEqual(SYNC_LIMITS.requestBytes);
    }

    on(DEVICE_B);
    await pullAll(getDb(), transport);
    const texts = new Map((await listDocuments(session.id)).map((d) => [d.name, d.text]));
    expect(texts.get('en.txt')).toBe(english);
    expect(texts.get('ja.txt')).toBe(japanese);
    expect((await getSession(session.id))?.documentsSummary).toEqual(summary);
  });

  it('splits pushes by UTF-8 bytes: six 3-byte-script documents need more than one push', async () => {
    on(DEVICE_A);
    const japanese = '日本語の資料'.repeat(41_667).slice(0, 250_000);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const session = await createSession(sessionInput({ company: `Invented ${i}` }));
      ids.push(session.id);
      await addDocument({ sessionId: session.id, name: 'a.txt', text: japanese });
      await addDocument({ sessionId: session.id, name: 'b.txt', text: japanese });
    }
    // About 4.5 MB as UTF-8 but only 1.5M characters: one push by string length, refused by the server.
    await pushAll();
    expect(await getDb().outbox.count()).toBe(0);
    expect(pushed.length).toBeGreaterThan(1);
    expect(pushed.every((push) => push.accepted && push.bytes <= SYNC_LIMITS.requestBytes)).toBe(
      true,
    );

    on(DEVICE_B);
    await pullAll(getDb(), transport);
    for (const id of ids) {
      expect((await listDocuments(id)).map((d) => d.text === japanese)).toEqual([true, true]);
    }
  }, 60_000);
});
