/**
 * File: apps/web/src/server/auth.ts
 * Purpose: The Better Auth instance: email + password sign-in (no public sign-up), the admin
 *          plugin, our `mustChangePassword` user field, and 30-day sessions stored in Postgres.
 *          Also getSession() for server components and actions.
 * Used by: app/api/auth/[...all]/route.ts, src/server/guard.ts, src/server/users.ts,
 *          app/change-password/actions.ts, scripts/create-admin.ts
 * Depends on: better-auth, src/server/db.ts, src/server/schema.ts, src/server/env.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (ADR-0022)
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
import * as schema from './schema';

/** Validated sign-in settings (secret, public address, trusted origins). */
const env = getAuthEnv();

/** How long a sign-in lasts without use: 30 days (architecture §8.2). */
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

/** How often an active session's expiry is pushed forward: at most once a day. */
const SESSION_RENEW_SECONDS = 60 * 60 * 24;

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
  user: {
    additionalFields: {
      mustChangePassword: {
        type: 'boolean',
        required: true,
        defaultValue: true,
        // input: false means users cannot set this through any Better Auth endpoint
        // (for example update-user); only server code changes it (src/server/users.ts).
        input: false,
      },
    },
  },
  session: {
    expiresIn: SESSION_LIFETIME_SECONDS,
    updateAge: SESSION_RENEW_SECONDS,
    // The cookie cache stays off (Better Auth's default): every check reads the session from
    // the database, so disabling a user or resetting a password takes effect on their next request.
  },
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
 * Returns the current request's session, or null when nobody is signed in.
 * Wrapped in React's cache() so several calls during one request (layout, page, action)
 * hit the database only once.
 *
 * @returns The session (with `user.role` and `user.mustChangePassword`) or null.
 * Called from: src/server/guard.ts, app/login/page.tsx, app/change-password/*
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  return auth.api.getSession({ headers: await headers() });
});
