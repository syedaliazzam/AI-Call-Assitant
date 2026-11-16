/**
 * Tests for apps/web/src/core/sync/client.ts and engine.ts after an account switch on one computer
 * (privacy fix of 14 Nov 2026), with fake-indexeddb and a fake server: when the previous account's
 * preferences were removed (core/storage/accountScope.ts), the start of account sync reads the account's
 * own preferences again (a normal pull would not bring them back), drops a preferences change that
 * waited (its values were the removed ones) and never pushes defaults in their place; the real transport
 * names the page's account in every request (ACCOUNT_HEADER); "Delete all my data" deletes the
 * account's own local database ('kite-l-<id>') and never the shared 'kite' database. Invented data only.
 */
import 'fake-indexeddb/auto';
import { ACCOUNT_HEADER, type SyncOp, type SyncPushResponse } from '@kite/shared';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enterAccount, forgetPageAccount, PREFS_RESET_KEY } from '@/core/storage/accountScope';
import { AUTO_ANSWER_KEY } from '@/core/storage/autoAnswer';
import { COMPANY_SUGGESTIONS_KEY } from '@/core/storage/companyPrefs';
import {
  DB_NAME,
  forgetDb,
  getDb,
  localAccountDbName,
  selectAccountDatabase,
  selectDatabaseForTests,
} from '@/core/storage/db';
import { createSession } from '@/core/storage/sessions';
import { deleteAllAccountData, startAccountSync } from '@/core/sync/client';
import { httpTransport, type SyncTransport } from '@/core/sync/engine';
import { sessionInput } from '../storage/helpers';

/** The invented account. */
const USER = 'user-account-switch-test';

let local: Map<string, string>;

/**
 * A fake server whose account has preferences (company suggestions off, auto-answer on).
 *
 * @returns The transport and what was pushed.
 */
function fakeServer() {
  const pushes: SyncOp[][] = [];
  const transport: SyncTransport = {
    push: vi.fn(async (ops: SyncOp[]): Promise<SyncPushResponse> => {
      pushes.push(ops);
      return { results: ops.map(() => ({ status: 'ok' as const, rev: 1 })) };
    }),
    pull: vi.fn(async () => ({ records: [], serverTime: Date.now(), next: null })),
    record: vi.fn(async () => ({
      kind: 'prefs' as const,
      id: 'account',
      sessionId: null,
      rev: 7,
      deleted: false,
      record: { companySuggestions: 'off', autoAnswer: 'on', codingLanguage: null },
    })),
  };
  return { transport, pushes };
}

/** Lets the fake database and the promise chains work. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await new Promise((done) => setImmediate(done));
}

beforeEach(async () => {
  local = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return local.size;
    },
    key: (index: number) => [...local.keys()][index] ?? null,
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, value),
    removeItem: (key: string) => void local.delete(key),
  });
  vi.stubGlobal('sessionStorage', { removeItem: () => undefined });
  vi.stubGlobal('window', {});
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  forgetPageAccount();
  selectAccountDatabase(USER);
  await getDb().delete();
  forgetDb();
});

afterEach(async () => {
  forgetPageAccount();
  selectAccountDatabase(USER);
  await getDb().delete();
  selectAccountDatabase(null);
  forgetDb();
  await Dexie.delete(DB_NAME);
  await Dexie.delete(localAccountDbName(USER));
});

describe('after an account switch', () => {
  it("reads the account's preferences again before any push, and drops a waiting change", async () => {
    // The account changed a preference here before the switch; the switch removed its values.
    await getDb().syncMeta.put({ id: 'prefs', value: 1 });
    local.set(PREFS_RESET_KEY, '1');
    const server = fakeServer();
    const stop = startAccountSync({
      transport: server.transport,
      target: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        navigator: { onLine: true },
      },
    });
    await settle();
    stop();
    expect(server.transport.record).toHaveBeenCalledWith('prefs', 'account');
    expect(local.get(COMPANY_SUGGESTIONS_KEY)).toBe('off');
    expect(local.get(AUTO_ANSWER_KEY)).toBe('on');
    expect(local.has(PREFS_RESET_KEY)).toBe(false);
    expect(await getDb().syncMeta.get('prefs')).toBeUndefined();
    // No defaults were sent over the account's values.
    expect(server.pushes.flat().filter((op) => op.op === 'put' && op.kind === 'prefs')).toEqual([]);
  });

  it('reads nothing again when no switch happened', async () => {
    const server = fakeServer();
    const stop = startAccountSync({
      transport: server.transport,
      target: { addEventListener: () => undefined, removeEventListener: () => undefined },
    });
    await settle();
    stop();
    expect(server.transport.record).not.toHaveBeenCalled();
  });
});

describe('httpTransport', () => {
  it("names the page's account in every request", async () => {
    enterAccount(USER);
    const fetchMock = vi.fn(async () => Response.json({ records: [], serverTime: 1, next: null }));
    vi.stubGlobal('fetch', fetchMock);
    await httpTransport.pull(0, null);
    await httpTransport.push([]).catch(() => undefined);
    const headers = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => (init.headers as Record<string, string>)[ACCOUNT_HEADER],
    );
    expect(headers).toEqual([USER, USER]);
  });
});

describe('deleteAllAccountData', () => {
  it("deletes the account's own local database, never the shared 'kite' one", async () => {
    selectAccountDatabase(null);
    await createSession(sessionInput({ company: 'Ownerless' }));
    selectDatabaseForTests(localAccountDbName(USER));
    await createSession(sessionInput({ company: 'Own local' }));
    forgetDb();
    enterAccount(USER);
    selectAccountDatabase(USER);
    await createSession(sessionInput({ company: 'Synced' }));
    const server = fakeServer();
    await deleteAllAccountData(server.transport);
    expect(server.pushes[0]).toEqual([{ op: 'deleteAll' }]);
    expect(await Dexie.exists(localAccountDbName(USER))).toBe(false);
    expect(await Dexie.exists(DB_NAME)).toBe(true);
  });
});
