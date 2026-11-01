/**
 * File: apps/web/src/server/auth.ts
 * Purpose: The Better Auth instance: email + password sign-in (no public sign-up), the admin
 *          plugin, our `mustChangePassword` user field, 30-day sessions stored in Postgres, and
 *          a 60-second session cookie cache (Day 5). Also getSession() for server components and
 *          actions (always read from the database), and getCachedSession() for the answer
 *          routes (read from the cookie cache, with the refreshed cookie to send back).
 * Used by: app/api/auth/[...all]/route.ts, src/server/guard.ts, src/server/users.ts,
 *          app/change-password/actions.ts, app/api/answer/route.ts, scripts/create-admin.ts
 * Depends on: better-auth, src/server/auth-options.ts, src/server/session-cache.ts, src/server/db.ts, src/server/schema.ts,
 *             src/server/env.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (ADR-0022, cookie cache
 *               trade-off); day-05-overlay-screenshots-notes.md Stage 0
 */
import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins';
import { headers } from 'next/headers';
import { cache } from 'react';
import { db } from './db';
import { getAuthEnv } from './env';
import { SESSION_OPTIONS, USER_OPTIONS } from './auth-options';
import * as schema from './schema';
import { readAnswerSession } from './session-cache';

export { COOKIE_CACHE_SECONDS } from './auth-options';

/** Validated sign-in settings (secret, public address, trusted origins). */
const env = getAuthEnv();

/**
 * The Better Auth server instance. Its HTTP endpoints are served at /api/auth/*, and its
 * server API (auth.api.*) is used by server code with the caller's request headers.
 */
export const auth = betterAuth({
  // Public address: http://localhost:3000 in development, the *.vercel.app URL in production,
  // https://$VERCEL_URL on preview deployments (worked out in getAuthEnv()).
  baseURL: env.baseUrl,
  secret: env.secret,
  // Requests (for example the sign-in form) are only accepted from these origins (CSRF guard).
  trustedOrigins: env.trustedOrigins,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    // Accounts are created only by admins (/admin/users) or the create-admin script.
    disableSignUp: true,
    minPasswordLength: 10,
  },
  user: USER_OPTIONS,
  session: SESSION_OPTIONS,
  plugins: [
    // Admin operations: create user, list users, set role, set password, ban/unban.
    admin(),
    // Lets server actions set sign-in cookies through Next.js. Must be the last plugin.
    nextCookies(),
  ],
});

/** The signed-in user's session, as returned by getSession(). */
export type AuthSession = typeof auth.$Infer.Session;

/**
 * Returns the current request's session, or null when nobody is signed in. Always reads the
 * database (disableCookieCache), so disabling a user, changing a role or resetting a password
 * takes effect on the very next page or action. Wrapped in React's cache() so several calls
 * during one request (layout, page, action) hit the database only once.
 *
 * @returns The session (with `user.role` and `user.mustChangePassword`) or null.
 * Called from: src/server/guard.ts, app/login/page.tsx, app/change-password/*
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  return auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
});

/** What getCachedSession() returns. */
export interface CachedSession {
  /** The session, or null when nobody is signed in (or the session ended). */
  session: AuthSession | null;
  /**
   * Set-Cookie header values to send back on the route's response: the refreshed session cookie
   * cache (after a database read), or an expired one. Without them the browser keeps the old
   * cookie and every later request would read the database again.
   */
  setCookies: string[];
}

/**
 * Reads the session for an answer request from the 60-second cookie cache (a database read
 * only when the cached copy is missing or older than COOKIE_CACHE_SECONDS). A cached session
 * that says the user must change their password is checked against the database once, because
 * the cached flag can still be true for up to 60 s after the user changed it.
 *
 * @param requestHeaders The incoming request's headers (its cookies).
 * @returns The session and the cookies to send back.
 * Called from: app/api/answer/route.ts (and /api/notes, Day 5 Stage 5)
 */
export async function getCachedSession(requestHeaders: Headers): Promise<CachedSession> {
  return readAnswerSession<AuthSession>(async (fromDatabase) => {
    const result = await auth.api.getSession({
      headers: requestHeaders,
      ...(fromDatabase ? { query: { disableCookieCache: true } } : {}),
      returnHeaders: true,
    });
    return { session: result.response, setCookies: result.headers.getSetCookie() };
  });
}
