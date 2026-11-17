/**
 * File: apps/web/src/server/liveLock.ts
 * Purpose: The live-call lock (ADR-0098): a session's call runs on one device at a time. The store functions
 *          (takeLiveLock, beatLiveLock, releaseLiveLock, listLiveSessions) are single statements on
 *          live_call_lock, so two devices racing for one session are settled by Postgres; the handlers turn
 *          GET / POST /api/live-lock into those calls for the signed-in account. Expiry needs no clean-up job:
 *          a lock whose heartbeat is older than LIVE_LOCK_STALE_MS simply no longer counts.
 * Used by: app/api/live-lock/route.ts; tests/unit/server/liveLock.test.ts
 * Depends on: drizzle-orm, zod, @kite/shared (liveLock.ts), src/server/auth.ts, src/server/db.ts,
 *             src/server/schema.ts (liveCallLock)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2, §8.1; ADR-0098
 *
 * Logs carry the action, the outcome and timings only: never a session, call, device or account id.
 */
import 'server-only';
import {
  ACCOUNT_HEADER,
  DEVICE_HEADER,
  LIVE_ELSEWHERE_CODE,
  LIVE_LOCK_ID_MAX,
  LIVE_LOCK_STALE_MS,
  type LiveLockReply,
  type LiveLockRequest,
  type LiveSessionsReply,
} from '@kite/shared';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from './auth';
import type { CallDataDb } from './calldata/store';
import { db } from './db';
import { liveCallLock } from './schema';

/**
 * The moment before which a heartbeat is too old (database clock, so device clocks never matter). The
 * number is a constant of the app, never a request value, so writing it into the SQL is safe.
 */
const STALE_BEFORE = sql.raw(
  `(now() - interval '${Math.round(LIVE_LOCK_STALE_MS / 1000)} seconds')`,
);

/** One account's session: what every store function works on. */
export interface LockKey {
  /** The database (Neon in the app, PGlite in tests). */
  db: CallDataDb;
  /** The signed-in account. Every statement is limited to it. */
  userId: string;
  /** The session. */
  sessionId: string;
}

/**
 * Takes the session's lock for a call (its start, or a reconnect of the same call). One statement: insert,
 * or replace the existing row only when it may be replaced: the same call (a reconnect), the same device (its
 * earlier call died: a device runs one call at a time, core/live/callLock.ts), a released or expired lock,
 * or a take-over. A call replaced before it ended is remembered in replaced_call_id, so it learns it was
 * moved on its next heartbeat.
 *
 * @param key      The account and session.
 * @param callId   The call.
 * @param deviceId The device running it.
 * @param takeOver True after the person confirmed "Take over".
 * @returns True when the call now holds the lock; false when another device's call holds it.
 * Called from: handleLiveLockPost() (start), beatLiveLock() (an expired lock taken again)
 */
export async function takeLiveLock(
  key: LockKey,
  callId: string,
  deviceId: string,
  takeOver: boolean,
): Promise<boolean> {
  const t = liveCallLock;
  const rows = await key.db
    .insert(t)
    .values({ userId: key.userId, sessionId: key.sessionId, callId, deviceId })
    .onConflictDoUpdate({
      target: [t.userId, t.sessionId],
      set: {
        callId: sql`excluded.call_id`,
        deviceId: sql`excluded.device_id`,
        // A reconnect keeps the call's start; another call starts now.
        startedAt: sql`case when ${t.callId} = excluded.call_id then ${t.startedAt} else now() end`,
        heartbeatAt: sql`now()`,
        releasedAt: sql`null`,
        // A different call that had not ended is the one replaced (it ends on its next heartbeat).
        replacedCallId: sql`case when ${t.callId} = excluded.call_id then ${t.replacedCallId} when ${t.releasedAt} is null then ${t.callId} else null end`,
      },
      ...(takeOver
        ? {}
        : {
            setWhere: sql`${t.callId} = excluded.call_id or ${t.deviceId} = excluded.device_id or ${t.releasedAt} is not null or ${t.heartbeatAt} < ${STALE_BEFORE}`,
          }),
    })
    .returning({ callId: t.callId });
  return rows.length === 1;
}

/**
 * A running call's heartbeat. Usually one statement (the heartbeat time). When the row no longer names this
 * call: 'moved' if a take-over (or a start after this call's lock expired) replaced it; otherwise the lock
 * expired or was released with nobody else on the session (this device was offline), so the call takes it
 * again, and 'moved' only if another device's call holds it now.
 *
 * @param key      The account and session.
 * @param callId   The call.
 * @param deviceId The device running it.
 * @returns 'held', 'moved' (the call ends on this device), or 'released' (this call already ended).
 * Called from: handleLiveLockPost() (beat)
 */
export async function beatLiveLock(
  key: LockKey,
  callId: string,
  deviceId: string,
): Promise<LiveLockReply['state']> {
  const t = liveCallLock;
  const mine = and(eq(t.userId, key.userId), eq(t.sessionId, key.sessionId));
  const beaten = await key.db
    .update(t)
    .set({ heartbeatAt: sql`now()` })
    .where(and(mine, eq(t.callId, callId), isNull(t.releasedAt)))
    .returning({ callId: t.callId });
  if (beaten.length === 1) return 'held';
  const [row] = await key.db
    .select({ callId: t.callId, replacedCallId: t.replacedCallId, releasedAt: t.releasedAt })
    .from(t)
    .where(mine);
  // A heartbeat that arrives after this call's own End (requests can cross): never revives the lock.
  if (row && row.callId === callId && row.releasedAt !== null) return 'released';
  if (row && row.callId !== callId && row.replacedCallId === callId) return 'moved';
  return (await takeLiveLock(key, callId, deviceId, false)) ? 'held' : 'moved';
}

/**
 * Releases the session's lock at End, only while this call holds it (a call that was moved changes nothing).
 *
 * @param key    The account and session.
 * @param callId The call that ended.
 * Called from: handleLiveLockPost() (end)
 */
export async function releaseLiveLock(key: LockKey, callId: string): Promise<void> {
  const t = liveCallLock;
  await key.db
    .update(t)
    .set({ releasedAt: sql`now()` })
    .where(
      and(
        eq(t.userId, key.userId),
        eq(t.sessionId, key.sessionId),
        eq(t.callId, callId),
        isNull(t.releasedAt),
      ),
    );
}

/**
 * The account's sessions with a lock held now (not released, heartbeat within LIVE_LOCK_STALE_MS).
 *
 * @param database The database.
 * @param userId   The account.
 * @param deviceId The asking device, or null (then no entry is "here").
 * @returns The live sessions, each saying whether its call runs on the asking device.
 * Called from: handleLiveLockGet()
 */
export async function listLiveSessions(
  database: CallDataDb,
  userId: string,
  deviceId: string | null,
): Promise<LiveSessionsReply['live']> {
  const t = liveCallLock;
  const rows = await database
    .select({ sessionId: t.sessionId, deviceId: t.deviceId })
    .from(t)
    .where(and(eq(t.userId, userId), isNull(t.releasedAt), gte(t.heartbeatAt, STALE_BEFORE)));
  return rows.map((row) => ({ sessionId: row.sessionId, here: row.deviceId === deviceId }));
}

/** A session, call or device id: a UUID made by the device (letters, digits and dashes). */
const id = z
  .string()
  .min(1)
  .max(LIVE_LOCK_ID_MAX)
  .regex(/^[A-Za-z0-9-]+$/);

/** POST /api/live-lock's body. */
const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    sessionId: id,
    callId: id,
    deviceId: id,
    takeOver: z.boolean().default(false),
  }),
  z.object({ action: z.literal('beat'), sessionId: id, callId: id, deviceId: id }),
  z.object({ action: z.literal('end'), sessionId: id, callId: id }),
]);

/** What the handlers need from outside (tests replace them). */
export interface LiveLockDeps {
  /** The signed-in account's id, or a refusal: 'signed-out' or 'password' (must change it first). */
  user(headers: Headers): Promise<{ id: string } | 'signed-out' | 'password'>;
  /** The database. */
  db(): CallDataDb;
}

/** The real dependencies. */
export const realLiveLockDeps: LiveLockDeps = {
  async user(headers) {
    // The cookie cache (60 s) is enough here: heartbeats come every 15 s, and a lock holds no data.
    const session = await auth.api.getSession({ headers });
    if (!session) return 'signed-out';
    if (session.user.mustChangePassword) return 'password';
    return { id: session.user.id };
  },
  // The Neon client and PGlite share the Drizzle Postgres shape the store uses (see calldata/api.ts).
  db: () => db as unknown as CallDataDb,
};

/**
 * A JSON error response in the app's usual shape.
 *
 * @param status  HTTP status.
 * @param code    Machine-readable code.
 * @param message Text for the person or the developer (never an id).
 * @returns The response.
 */
function failure(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

/**
 * Runs a handler for the signed-in account.
 *
 * @param request The request.
 * @param deps    The dependencies.
 * @param run     The handler, given the account id.
 * @returns Its response, or 401 / 403 / 409 (the page was opened for another account) / 500.
 */
async function withAccount(
  request: Request,
  deps: LiveLockDeps,
  run: (userId: string) => Promise<Response>,
): Promise<Response> {
  const user = await deps.user(request.headers);
  if (user === 'signed-out') return failure(401, 'unauthorized', 'Sign in required');
  if (user === 'password')
    return failure(403, 'password_change_required', 'Change your password first');
  // A page opened for another account (left open across a sign-out and sign-in) changes nothing.
  const named = request.headers.get(ACCOUNT_HEADER);
  if (named && named !== user.id)
    return failure(409, 'account_changed', 'Another account signed in. Reload the page.');
  try {
    return await run(user.id);
  } catch (error) {
    // The error's name only: a database message can quote values.
    console.error('live-lock: failed', { error: error instanceof Error ? error.name : 'unknown' });
    return failure(500, 'live_lock_failed', 'The call could not be checked. Try again.');
  }
}

/**
 * GET /api/live-lock: the account's live sessions, for the session cards and Meetings.
 *
 * @param request The request (DEVICE_HEADER names the asking device).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 with LiveSessionsReply.
 * Called from: app/api/live-lock/route.ts
 */
export function handleLiveLockGet(
  request: Request,
  deps: LiveLockDeps = realLiveLockDeps,
): Promise<Response> {
  return withAccount(request, deps, async (userId) => {
    const device = request.headers.get(DEVICE_HEADER);
    const deviceId = device && id.safeParse(device).success ? device : null;
    const live = await listLiveSessions(deps.db(), userId, deviceId);
    return Response.json({ live } satisfies LiveSessionsReply, {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}

/**
 * POST /api/live-lock: a call's start (409 LIVE_ELSEWHERE_CODE when another device runs the session and
 * this is not a take-over), heartbeat, or end.
 *
 * @param request The request (body: LiveLockRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 with LiveLockReply, 400 for a bad body, 409 when the start is refused.
 * Called from: app/api/live-lock/route.ts
 */
export function handleLiveLockPost(
  request: Request,
  deps: LiveLockDeps = realLiveLockDeps,
): Promise<Response> {
  return withAccount(request, deps, async (userId) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, 'invalid_request', 'The request is not JSON.');
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return failure(400, 'invalid_request', 'The request is not valid.');
    const input: LiveLockRequest = parsed.data;
    const key: LockKey = { db: deps.db(), userId, sessionId: input.sessionId };
    if (input.action === 'start') {
      const held = await takeLiveLock(key, input.callId, input.deviceId, input.takeOver);
      // Outcome only: no session, call or device id.
      console.info('live-lock: start', { held, takeOver: input.takeOver });
      if (!held)
        return failure(409, LIVE_ELSEWHERE_CODE, 'This session is live on another device.');
      return Response.json({ state: 'held' } satisfies LiveLockReply);
    }
    if (input.action === 'beat') {
      const state = await beatLiveLock(key, input.callId, input.deviceId);
      // Heartbeats are not logged when held (one every 15 s per call); a move is.
      if (state === 'moved') console.info('live-lock: call moved to another device');
      return Response.json({ state } satisfies LiveLockReply);
    }
    await releaseLiveLock(key, input.callId);
    return Response.json({ state: 'released' } satisfies LiveLockReply);
  });
}
