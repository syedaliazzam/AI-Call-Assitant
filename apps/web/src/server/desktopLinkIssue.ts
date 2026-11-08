/**
 * File: apps/web/src/server/desktopLinkIssue.ts
 * Purpose: POST /api/desktop/link-code (ADR-0052): makes a one-time desktop sign-in code for one of
 *          the signed-in account's sessions. Only for accounts with the accountSync switch (the session
 *          must be in the account for the desktop app to open it). The account always comes from the
 *          session cookie (read from the database), never from the request.
 * Used by: app/api/desktop/link-code/route.ts
 * Depends on: src/server/auth.ts, src/server/db.ts, src/server/calldata/flag.ts,
 *             src/server/desktopLink.ts, zod
 * Architecture: ADR-0052
 */
import 'server-only';
import { z } from 'zod';
import { auth } from './auth';
import type { CallDataDb } from './calldata/store';
import { syncEnabledFor } from './calldata/flag';
import { db } from './db';
import { issueLinkCode } from './desktopLink';

/** The request body. */
const bodySchema = z.object({ sessionId: z.string().uuid() }).strict();

/** What the handler needs from outside (tests replace them). */
export interface IssueDeps {
  /** The signed-in account's id, or a refusal. */
  user(headers: Headers): Promise<{ id: string } | 'signed-out' | 'password'>;
  /** Whether the account has the accountSync switch. */
  enabled(userId: string): boolean;
  /** The database. */
  db(): CallDataDb;
}

/** The real dependencies. */
export const realIssueDeps: IssueDeps = {
  async user(headers) {
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!session) return 'signed-out';
    if (session.user.mustChangePassword) return 'password';
    return { id: session.user.id };
  },
  enabled: (userId) => syncEnabledFor(userId),
  // The app's Neon client has the common Drizzle Postgres shape the code store needs.
  db: () => db as unknown as CallDataDb,
};

/**
 * A JSON error.
 *
 * @param status  HTTP status.
 * @param code    Machine-readable code.
 * @param message Text for the developer (never a code or call data).
 * @returns The response.
 */
function failure(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Handles POST /api/desktop/link-code.
 *
 * @param request The request (body: { sessionId }).
 * @param deps    The dependencies (tests pass fakes).
 * @returns 200 { code, expiresAt } (never cached); 401 signed out; 403 password change needed; 404 no
 *          account sync or not this account's session; 429 more than 10 codes in a minute; 400 bad body.
 * Called from: app/api/desktop/link-code/route.ts
 */
export async function handleIssueLinkCode(
  request: Request,
  deps: IssueDeps = realIssueDeps,
): Promise<Response> {
  const user = await deps.user(request.headers);
  if (user === 'signed-out') return failure(401, 'unauthorized', 'Sign in required');
  if (user === 'password')
    return failure(403, 'password_change_required', 'Change your password first');
  if (!deps.enabled(user.id)) return failure(404, 'not_found', 'Not found');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(400, 'invalid_request', 'body: not JSON');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return failure(400, 'invalid_request', 'sessionId: invalid');
  const issued = await issueLinkCode(deps.db(), user.id, parsed.data.sessionId);
  if (issued === 'not_found') return failure(404, 'not_found', 'Not found');
  if (issued === 'too_many') return failure(429, 'too_many', 'Too many links; wait a minute.');
  console.info('desktop-link: code issued');
  return Response.json(issued, { headers: { 'Cache-Control': 'no-store' } });
}
