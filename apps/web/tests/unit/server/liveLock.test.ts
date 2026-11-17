/**
 * Tests for apps/web/src/server/liveLock.ts (ADR-0098) against a real Postgres in memory (PGlite) with the
 * committed migrations: a start takes a free lock and is refused while another device's call holds it; the
 * same call (reconnect) and the same device (its earlier call died) may take it again; an expired lock (no
 * heartbeat for 90 s) and a released one are free; a take-over replaces a live call, which learns it was
 * moved on its next heartbeat (also after the new call ended); a call whose lock expired with nobody else
 * on the session takes it again; a late heartbeat never revives a released lock; End releases only its own
 * call; other sessions and other accounts are never affected; the list says which live sessions run here.
 * The handlers: sign-in, password, account and body checks, and the 409 code of a refused start.
 */
import { ACCOUNT_HEADER, DEVICE_HEADER, LIVE_ELSEWHERE_CODE } from '@kite/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beatLiveLock,
  handleLiveLockGet,
  handleLiveLockPost,
  listLiveSessions,
  releaseLiveLock,
  takeLiveLock,
  type LiveLockDeps,
  type LockKey,
} from '@/server/liveLock';
import { ALICE, BOB, createTestDb, type TestDb, resetTestDb } from './calldata/pgliteDb';

// The real auth and database are never loaded: the handlers get fakes, the store gets PGlite.
vi.mock('@/server/auth', () => ({ auth: {} }));
vi.mock('@/server/db', () => ({ db: {} }));

/** Invented ids. */
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const CALL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CALL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CALL_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LAPTOP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DESKTOP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb(t);
  await t.pg.exec('DELETE FROM live_call_lock;');
});

/**
 * One account's session.
 * @param sessionId The session (default S1).
 * @param userId    The account (default ALICE).
 * @returns The key.
 */
function key(sessionId = S1, userId = ALICE): LockKey {
  return { db: t.db, userId, sessionId };
}

/**
 * Moves a session's last heartbeat into the past, as if no heartbeat came for that long.
 * @param seconds How long ago.
 * @param sessionId The session.
 */
async function ageHeartbeat(seconds: number, sessionId = S1): Promise<void> {
  await t.pg.query(
    `UPDATE live_call_lock SET heartbeat_at = now() - make_interval(secs => $1) WHERE session_id = $2`,
    [seconds, sessionId],
  );
}

describe('takeLiveLock', () => {
  it('takes a free lock and refuses another device while it is held', async () => {
    expect(await takeLiveLock(key(), CALL_A, LAPTOP, false)).toBe(true);
    expect(await takeLiveLock(key(), CALL_B, DESKTOP, false)).toBe(false);
    expect(await listLiveSessions(t.db, ALICE, DESKTOP)).toEqual([{ sessionId: S1, here: false }]);
  });

  it('lets the same call take it again (a reconnect) and the same device start a new call', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    expect(await takeLiveLock(key(), CALL_A, LAPTOP, false)).toBe(true);
    expect(await takeLiveLock(key(), CALL_B, LAPTOP, false)).toBe(true);
  });

  it('frees an expired lock after 90 s without a heartbeat, but not before', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    await ageHeartbeat(80);
    expect(await takeLiveLock(key(), CALL_B, DESKTOP, false)).toBe(false);
    await ageHeartbeat(91);
    expect(await listLiveSessions(t.db, ALICE, DESKTOP)).toEqual([]);
    expect(await takeLiveLock(key(), CALL_B, DESKTOP, false)).toBe(true);
  });

  it('frees a released lock at once', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    await releaseLiveLock(key(), CALL_A);
    expect(await listLiveSessions(t.db, ALICE, null)).toEqual([]);
    expect(await takeLiveLock(key(), CALL_B, DESKTOP, false)).toBe(true);
  });

  it('never affects another session or another account', async () => {
    await takeLiveLock(key(S1), CALL_A, LAPTOP, false);
    expect(await takeLiveLock(key(S2), CALL_B, DESKTOP, false)).toBe(true);
    expect(await takeLiveLock(key(S1, BOB), CALL_C, DESKTOP, false)).toBe(true);
    expect(await listLiveSessions(t.db, BOB, null)).toEqual([{ sessionId: S1, here: false }]);
    // Alice's first call still holds her S1.
    expect(await beatLiveLock(key(S1), CALL_A, LAPTOP)).toBe('held');
  });
});

describe('take-over and heartbeats', () => {
  it('replaces a live call; the old call learns it was moved and cannot take it back', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    expect(await takeLiveLock(key(), CALL_B, DESKTOP, true)).toBe(true);
    expect(await beatLiveLock(key(), CALL_A, LAPTOP)).toBe('moved');
    expect(await beatLiveLock(key(), CALL_B, DESKTOP)).toBe('held');
    expect(await listLiveSessions(t.db, ALICE, DESKTOP)).toEqual([{ sessionId: S1, here: true }]);
  });

  it('still tells the old call it was moved after the new call ended', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    await takeLiveLock(key(), CALL_B, DESKTOP, true);
    await releaseLiveLock(key(), CALL_B);
    expect(await beatLiveLock(key(), CALL_A, LAPTOP)).toBe('moved');
    expect(await listLiveSessions(t.db, ALICE, null)).toEqual([]);
  });

  it('tells a call whose expired lock another device took that it was moved', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    await ageHeartbeat(120);
    expect(await takeLiveLock(key(), CALL_B, DESKTOP, false)).toBe(true);
    expect(await beatLiveLock(key(), CALL_A, LAPTOP)).toBe('moved');
  });

  it('lets a call that was offline past expiry keep its lock when nobody else started', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    await ageHeartbeat(300);
    expect(await beatLiveLock(key(), CALL_A, LAPTOP)).toBe('held');
    expect(await listLiveSessions(t.db, ALICE, LAPTOP)).toEqual([{ sessionId: S1, here: true }]);
  });

  it('never revives a lock with a heartbeat that arrives after its own End', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    await releaseLiveLock(key(), CALL_A);
    expect(await beatLiveLock(key(), CALL_A, LAPTOP)).toBe('released');
    expect(await listLiveSessions(t.db, ALICE, null)).toEqual([]);
  });

  it('takes a lock that has no row yet on a heartbeat (its start did not reach the server)', async () => {
    expect(await beatLiveLock(key(), CALL_A, LAPTOP)).toBe('held');
  });

  it('releases only the call that holds the lock', async () => {
    await takeLiveLock(key(), CALL_A, LAPTOP, false);
    await takeLiveLock(key(), CALL_B, DESKTOP, true);
    await releaseLiveLock(key(), CALL_A);
    expect(await listLiveSessions(t.db, ALICE, null)).toEqual([{ sessionId: S1, here: false }]);
  });
});

/**
 * Handler dependencies with a fixed account.
 * @param user The signed-in account, or a refusal.
 * @returns The dependencies.
 */
function deps(user: string | 'signed-out' | 'password'): LiveLockDeps {
  return {
    user: async () => (user === 'signed-out' || user === 'password' ? user : { id: user }),
    db: () => t.db,
  };
}

/**
 * A POST /api/live-lock request.
 * @param body    The JSON body.
 * @param headers Extra headers.
 * @returns The request.
 */
function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/live-lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('handlers', () => {
  const start = (callId: string, deviceId: string, takeOver = false) => ({
    action: 'start',
    sessionId: S1,
    callId,
    deviceId,
    takeOver,
  });

  it('starts, refuses a second device with 409 live_elsewhere, and takes over when asked', async () => {
    expect((await handleLiveLockPost(post(start(CALL_A, LAPTOP)), deps(ALICE))).status).toBe(200);
    const refused = await handleLiveLockPost(post(start(CALL_B, DESKTOP)), deps(ALICE));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: LIVE_ELSEWHERE_CODE });
    const taken = await handleLiveLockPost(post(start(CALL_B, DESKTOP, true)), deps(ALICE));
    expect(await taken.json()).toEqual({ state: 'held' });
    const beat = await handleLiveLockPost(
      post({ action: 'beat', sessionId: S1, callId: CALL_A, deviceId: LAPTOP }),
      deps(ALICE),
    );
    expect(await beat.json()).toEqual({ state: 'moved' });
  });

  it('lists the live sessions with "here" for the asking device', async () => {
    await handleLiveLockPost(post(start(CALL_A, LAPTOP)), deps(ALICE));
    const request = new Request('http://localhost/api/live-lock', {
      headers: { [DEVICE_HEADER]: LAPTOP },
    });
    const listed = await handleLiveLockGet(request, deps(ALICE));
    expect(await listed.json()).toEqual({ live: [{ sessionId: S1, here: true }] });
    const other = await handleLiveLockGet(new Request('http://localhost/api/live-lock'), deps(BOB));
    expect(await other.json()).toEqual({ live: [] });
  });

  it('ends the call with action end', async () => {
    await handleLiveLockPost(post(start(CALL_A, LAPTOP)), deps(ALICE));
    const ended = await handleLiveLockPost(
      post({ action: 'end', sessionId: S1, callId: CALL_A }),
      deps(ALICE),
    );
    expect(await ended.json()).toEqual({ state: 'released' });
    expect(await listLiveSessions(t.db, ALICE, null)).toEqual([]);
  });

  it('refuses signed-out (401), a password change (403), another account (409) and a bad body (400)', async () => {
    expect((await handleLiveLockPost(post(start(CALL_A, LAPTOP)), deps('signed-out'))).status).toBe(
      401,
    );
    expect((await handleLiveLockPost(post(start(CALL_A, LAPTOP)), deps('password'))).status).toBe(
      403,
    );
    const otherAccount = await handleLiveLockPost(
      post(start(CALL_A, LAPTOP), { [ACCOUNT_HEADER]: BOB }),
      deps(ALICE),
    );
    expect(otherAccount.status).toBe(409);
    expect(await otherAccount.json()).toMatchObject({ code: 'account_changed' });
    expect(
      (
        await handleLiveLockPost(
          post({ ...start(CALL_A, LAPTOP), sessionId: "x'; drop" }),
          deps(ALICE),
        )
      ).status,
    ).toBe(400);
    expect((await handleLiveLockPost(post({ action: 'nope' }), deps(ALICE))).status).toBe(400);
    // Nothing was taken by the refused requests.
    expect(await listLiveSessions(t.db, ALICE, null)).toEqual([]);
  });
});
