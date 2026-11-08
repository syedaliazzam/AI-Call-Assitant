/**
 * File: apps/web/src/server/calldata/api.ts
 * Purpose: The /api/sync/* handlers (ADR-0049): who may call them, and turning requests into store
 *          calls and responses. The account always comes from the signed-in session, read from
 *          the database on every call (a disabled account is refused at once), never from the
 *          request. Accounts without the accountSync switch get 404, as if the routes did not exist.
 * Used by: app/api/sync/push/route.ts, app/api/sync/pull/route.ts, app/api/sync/record/route.ts,
 *          app/api/sync/status/route.ts
 * Depends on: src/server/auth.ts, src/server/db.ts, src/server/calldata/{store,crypto,flag,validate}.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2, §8.1; ADR-0049
 *
 * Logs carry the route, operation counts and timings only: never ids of records, never content.
 */
import 'server-only';
import type { SyncPushResponse, SyncStatusResponse } from '@kite/shared';
import { auth } from '../auth';
import { db } from '../db';
import { DataKeyError, dataKeys } from './crypto';
import { syncEnabledFor } from './flag';
import { applyOps, pullChanges, readRecord, type CallDataDb, type StoreContext } from './store';
import { checkPull, checkPush, checkRecordQuery } from './validate';

/** What the handlers need from outside (tests replace them). */
export interface SyncDeps {
  /** The signed-in account's id, or a refusal: 'signed-out' or 'password' (must change it first). */
  user(headers: Headers): Promise<{ id: string } | 'signed-out' | 'password'>;
  /** Whether the account has account sync. */
  enabled(userId: string): boolean;
  /** The database. */
  db(): CallDataDb;
  /** The data keys (throws DataKeyError when none is set). */
  keys(): ReturnType<typeof dataKeys>;
}

/** The real dependencies. */
export const realDeps: SyncDeps = {
  async user(headers) {
    // Always the database, not the 60-second cookie cache: call data needs a live account.
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!session) return 'signed-out';
    if (session.user.mustChangePassword) return 'password';
    return { id: session.user.id };
  },
  enabled: (userId) => syncEnabledFor(userId),
  // The app's Neon client is a Drizzle Postgres database like PGlite's in the tests; the store needs
  // only that common shape, which TypeScript cannot see through the two drivers' result types.
  db: () => db as unknown as CallDataDb,
  keys: () => dataKeys(),
};

/**
 * A JSON error response in the app's usual shape.
 *
 * @param status  HTTP status.
 * @param code    Machine-readable code.
 * @param message Text for the user or developer (never call data).
 * @returns The response.
 */
function failure(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

/**
 * Runs a handler for a signed-in account that has account sync, with its store context.
 *
 * @param request The request.
 * @param deps    The dependencies.
 * @param route   The route's name, for the log.
 * @param run     The handler.
 * @returns The handler's response, or 401 (signed out), 403 (password change needed), 404 (no account
 *          sync), 503 (no data key), 500 (anything else).
 */
async function withAccount(
  request: Request,
  deps: SyncDeps,
  route: string,
  run: (ctx: StoreContext) => Promise<Response>,
): Promise<Response> {
  const user = await deps.user(request.headers);
  if (user === 'signed-out') return failure(401, 'unauthorized', 'Sign in required');
  if (user === 'password')
    return failure(403, 'password_change_required', 'Change your password first');
  if (!deps.enabled(user.id)) return failure(404, 'not_found', 'Not found');
  const started = Date.now();
  try {
    const response = await run({ db: deps.db(), keys: deps.keys(), userId: user.id });
    console.info(`sync: ${route}`, { status: response.status, ms: Date.now() - started });
    return response;
  } catch (error) {
    if (error instanceof DataKeyError) {
      console.error('sync: data key unavailable', { route });
      return failure(503, 'sync_unavailable', 'Sync is not available right now.');
    }
    // The error's name only: a database message can quote values.
    console.error(`sync: ${route} failed`, {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return failure(500, 'sync_failed', 'Sync failed. It will try again.');
  }
}

/**
 * POST /api/sync/push: applies a device's operations.
 *
 * @param request The request (body: SyncPushRequest).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 with SyncPushResponse, or 400 naming the fields that are wrong.
 * Called from: app/api/sync/push/route.ts
 */
export async function handlePush(request: Request, deps: SyncDeps = realDeps): Promise<Response> {
  return withAccount(request, deps, 'push', async (ctx) => {
    const checked = checkPush(await request.text());
    if (!checked.ok) return failure(400, 'invalid_request', checked.problems.join('; '));
    const results = await applyOps(ctx, checked.value);
    console.info('sync: push applied', {
      ops: checked.value.length,
      conflicts: results.filter((result) => result.status === 'conflict').length,
      refused: results.filter((result) => result.status === 'refused').length,
    });
    return Response.json({ results } satisfies SyncPushResponse);
  });
}

/**
 * GET /api/sync/pull?since=<ms>&after=<token>: this account's changes, one page.
 *
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 with SyncPullResponse, or 400 for a bad query or page token.
 * Called from: app/api/sync/pull/route.ts
 */
export async function handlePull(request: Request, deps: SyncDeps = realDeps): Promise<Response> {
  return withAccount(request, deps, 'pull', async (ctx) => {
    const checked = checkPull(new URL(request.url).searchParams);
    if (!checked.ok) return failure(400, 'invalid_request', checked.problems.join('; '));
    try {
      return Response.json(await pullChanges(ctx, checked.value.since, checked.value.after));
    } catch (error) {
      if (error instanceof Error && error.message === 'BAD_CURSOR') {
        return failure(400, 'invalid_request', 'after: invalid');
      }
      throw error;
    }
  });
}

/**
 * GET /api/sync/record?kind=<kind>&id=<id>: one of this account's records.
 *
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 with the SyncPulledRecord; 404 when this account has no such record, including when
 *          another account does (a record of another account is never revealed).
 * Called from: app/api/sync/record/route.ts
 */
export async function handleRecord(request: Request, deps: SyncDeps = realDeps): Promise<Response> {
  return withAccount(request, deps, 'record', async (ctx) => {
    const checked = checkRecordQuery(new URL(request.url).searchParams);
    if (!checked.ok) return failure(400, 'invalid_request', checked.problems.join('; '));
    const record = await readRecord(ctx, checked.value.kind, checked.value.id);
    return record ? Response.json(record) : failure(404, 'not_found', 'Not found');
  });
}

/**
 * GET /api/sync/status: whether this account has account sync. Answers for every signed-in account
 * (false when the switch is off), so the app can choose between synced and local behaviour.
 *
 * @param request The request.
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 with SyncStatusResponse, or 401 / 403 as the other routes.
 * Called from: app/api/sync/status/route.ts
 */
export async function handleStatus(request: Request, deps: SyncDeps = realDeps): Promise<Response> {
  const user = await deps.user(request.headers);
  if (user === 'signed-out') return failure(401, 'unauthorized', 'Sign in required');
  if (user === 'password')
    return failure(403, 'password_change_required', 'Change your password first');
  return Response.json({ enabled: deps.enabled(user.id) } satisfies SyncStatusResponse);
}
