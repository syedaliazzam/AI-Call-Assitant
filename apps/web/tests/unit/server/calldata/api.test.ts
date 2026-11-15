/**
 * Tests for apps/web/src/server/calldata/api.ts (ADR-0049), the /api/sync/* handlers, with a real
 * Postgres in memory (PGlite) and a fake sign-in: every route answers 401 signed out, 403 before a
 * password change, and 404 for an account without the accountSync switch (status answers false);
 * each route keeps accounts apart (another account's record is 404 on /record, absent from /pull,
 * and untouched by /push); a request from a page opened for another account (ACCOUNT_HEADER, privacy
 * fix of 14 Nov 2026) answers 409 and stores or reveals nothing; a missing data key answers 503 and
 * stores nothing; a bad body answers 400
 * naming fields without echoing values.
 */
import { ACCOUNT_HEADER, type SyncPullResponse, type SyncPushResponse } from '@kite/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handlePull,
  handlePush,
  handleRecord,
  handleStatus,
  type SyncDeps,
} from '@/server/calldata/api';
import { DataKeyError } from '@/server/calldata/crypto';
import { ALICE, BOB, createTestDb, type TestDb, resetTestDb } from './pgliteDb';

// The real sign-in and database modules need production settings; these tests pass their own
// dependencies (SyncDeps), so the modules are replaced by empty stand-ins.
vi.mock('@/server/auth', () => ({ auth: {} }));
vi.mock('@/server/db', () => ({ db: {} }));

/** An invented session id. */
const S1 = '11111111-1111-4111-8111-111111111111';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb(t);
  // The handlers log counts and timings; keep test output quiet.
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

/**
 * Dependencies for one signed-in state.
 *
 * @param user     Who is signed in, or a refusal.
 * @param enabled  Accounts with the switch on.
 * @param keysFail True to make the data keys unavailable.
 * @returns The dependencies.
 */
function deps(
  user: string | 'signed-out' | 'password',
  enabled: readonly string[] = [ALICE, BOB],
  keysFail = false,
): SyncDeps {
  return {
    user: async () => (user === 'signed-out' || user === 'password' ? user : { id: user }),
    enabled: (userId) => enabled.includes(userId),
    db: () => t.db,
    keys: () => {
      if (keysFail) throw new DataKeyError('KITE_DATA_KEY_V1 is not set.');
      return t.keys;
    },
  };
}

/**
 * A push request.
 *
 * @param body The JSON body.
 * @returns The request.
 */
function push(body: unknown): Request {
  return new Request('https://kite.test/api/sync/push', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * A request for Alice's session record.
 *
 * @returns The request.
 */
const recordRequest = () => new Request(`https://kite.test/api/sync/record?kind=session&id=${S1}`);

/**
 * A first pull.
 *
 * @returns The request.
 */
const pullRequest = () => new Request('https://kite.test/api/sync/pull?since=0');

/** Alice's session, created through the push route. */
async function aliceCreatesSession(): Promise<void> {
  const response = await handlePush(
    push({
      ops: [
        {
          op: 'put',
          kind: 'session',
          id: S1,
          baseRev: null,
          record: { id: S1, company: 'Invented Co', saveTranscript: true },
        },
      ],
    }),
    deps(ALICE),
  );
  expect(response.status).toBe(200);
}

describe('who may call', () => {
  const routes = [
    ['push', () => handlePush(push({ ops: [{ op: 'deleteAll' }] }), deps('signed-out'))],
    ['pull', () => handlePull(pullRequest(), deps('signed-out'))],
    ['record', () => handleRecord(recordRequest(), deps('signed-out'))],
    ['status', () => handleStatus(pullRequest(), deps('signed-out'))],
  ] as const;

  it.each(routes)('%s: 401 when signed out', async (_name, call) => {
    expect((await call()).status).toBe(401);
  });

  it('every route: 403 before the temporary password is changed', async () => {
    const d = deps('password');
    expect((await handlePush(push({ ops: [{ op: 'deleteAll' }] }), d)).status).toBe(403);
    expect((await handlePull(pullRequest(), d)).status).toBe(403);
    expect((await handleRecord(recordRequest(), d)).status).toBe(403);
    expect((await handleStatus(pullRequest(), d)).status).toBe(403);
  });

  it('without the accountSync switch: 404 everywhere, status says false, nothing stored', async () => {
    const off = deps(ALICE, []);
    const pushed = await handlePush(
      push({ ops: [{ op: 'put', kind: 'session', id: S1, baseRev: null, record: { id: S1 } }] }),
      off,
    );
    expect(pushed.status).toBe(404);
    expect((await handlePull(pullRequest(), off)).status).toBe(404);
    expect((await handleRecord(recordRequest(), off)).status).toBe(404);
    expect(await (await handleStatus(pullRequest(), off)).json()).toEqual({ enabled: false });
    expect((await t.pg.query('SELECT 1 FROM call_record')).rows).toHaveLength(0);
  });

  it('status says true with the switch on', async () => {
    expect(await (await handleStatus(pullRequest(), deps(ALICE))).json()).toEqual({
      enabled: true,
    });
  });
});

describe('another account (one check per route)', () => {
  it('/record: 404 for a record another account has', async () => {
    await aliceCreatesSession();
    expect((await handleRecord(recordRequest(), deps(ALICE))).status).toBe(200);
    const bob = await handleRecord(recordRequest(), deps(BOB));
    expect(bob.status).toBe(404);
    expect(await bob.text()).not.toContain('Invented');
  });

  it('/pull: another account’s records are not listed', async () => {
    await aliceCreatesSession();
    const page = (await (await handlePull(pullRequest(), deps(BOB))).json()) as SyncPullResponse;
    expect(page.records).toEqual([]);
  });

  it('/push: deleting or overwriting the same id leaves the other account’s record alone', async () => {
    await aliceCreatesSession();
    const response = await handlePush(
      push({
        ops: [
          { op: 'put', kind: 'session', id: S1, baseRev: null, record: { id: S1, company: 'Bob' } },
          { op: 'delete', kind: 'session', id: S1 },
          { op: 'deleteAll' },
        ],
      }),
      deps(BOB),
    );
    expect(((await response.json()) as SyncPushResponse).results[0]).toMatchObject({
      status: 'ok',
    });
    const alice = await (await handleRecord(recordRequest(), deps(ALICE))).json();
    expect(alice).toMatchObject({ record: { company: 'Invented Co' } });
  });

  it('409 and nothing stored or read when the page was opened for another account', async () => {
    await aliceCreatesSession();
    // A window of Alice's, still open after Bob signed in on the same browser profile.
    const named = { [ACCOUNT_HEADER]: ALICE };
    const pushed = await handlePush(
      new Request('https://kite.test/api/sync/push', {
        method: 'POST',
        headers: named,
        body: JSON.stringify({
          ops: [{ op: 'put', kind: 'session', id: S1, baseRev: null, record: { id: S1 } }],
        }),
      }),
      deps(BOB),
    );
    expect(pushed.status).toBe(409);
    expect(await pushed.json()).toMatchObject({ code: 'account_changed' });
    const pulled = await handlePull(
      new Request('https://kite.test/api/sync/pull?since=0', { headers: named }),
      deps(BOB),
    );
    expect(pulled.status).toBe(409);
    expect(await pulled.text()).not.toContain('Invented');
    const bob = (await (await handlePull(pullRequest(), deps(BOB))).json()) as SyncPullResponse;
    expect(bob.records).toEqual([]);
    // The page's own account (or an older page without the header) is served as before.
    const own = await handlePull(
      new Request('https://kite.test/api/sync/pull?since=0', { headers: named }),
      deps(ALICE),
    );
    expect(own.status).toBe(200);
  });
});

describe('failures', () => {
  it('503 and nothing stored when no data key is set', async () => {
    const response = await handlePush(
      push({ ops: [{ op: 'put', kind: 'session', id: S1, baseRev: null, record: { id: S1 } }] }),
      deps(ALICE, [ALICE], true),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'sync_unavailable' });
    expect((await t.pg.query('SELECT 1 FROM call_record')).rows).toHaveLength(0);
  });

  it('400 for a bad body, naming the field without echoing the value', async () => {
    const response = await handlePush(
      push({
        ops: [
          {
            op: 'put',
            kind: 'document',
            id: S1,
            baseRev: null,
            record: { text: 'SECRET-DOCUMENT-TEXT' },
          },
        ],
      }),
      deps(ALICE),
    );
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain('ops.0.sessionId');
    expect(text).not.toContain('SECRET');
    expect((await handlePush(push('not json'), deps(ALICE))).status).toBe(400);
  });

  it('400 for a bad pull query or page token', async () => {
    const bad = new Request('https://kite.test/api/sync/pull?since=-1');
    expect((await handlePull(bad, deps(ALICE))).status).toBe(400);
    const token = new Request('https://kite.test/api/sync/pull?since=0&after=nonsense');
    expect((await handlePull(token, deps(ALICE))).status).toBe(400);
  });
});
