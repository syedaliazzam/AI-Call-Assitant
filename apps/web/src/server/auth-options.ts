/**
 * File: apps/web/src/server/auth-options.ts
 * Purpose: Kite's Better Auth user fields and session settings, including the 60-second session
 *          cookie cache (Day 5). Kept apart from auth.ts (which connects to the database) so
 *          the cookie-cache unit test can build a Better Auth instance with exactly these
 *          settings on an in-memory database.
 * Used by: src/server/auth.ts; tests/unit/server/auth-options.test.ts
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (ADR-0022, cookie cache
 *               trade-off); day-05-overlay-screenshots-notes.md Stage 0
 */
import 'server-only';

/** How long a sign-in lasts without use: 30 days (architecture §8.2). */
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

/** How often an active session's expiry is pushed forward: at most once a day. */
const SESSION_RENEW_SECONDS = 60 * 60 * 24;

/**
 * How long the session cookie cache is trusted, in seconds (Day 5). Within this time an answer
 * request reads the signed session cookie instead of the database, which removes the database
 * round trip (and the free database's cold starts of about 1.4 s) from the time to the first
 * word. The trade-off (ADR-0022): a disabled user, or one whose password was reset, can still
 * get answers for up to this long; every page and server action reads the database and is
 * refused at once.
 */
export const COOKIE_CACHE_SECONDS = 60;

/**
 * Kite's user fields (shared with the cookie-cache unit test, so it checks the same shape).
 * mustChangePassword is part of the user, so it is also in the cached session.
 */
export const USER_OPTIONS = {
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
} as const;

/** Kite's session settings (shared with the cookie-cache unit test). */
export const SESSION_OPTIONS = {
  expiresIn: SESSION_LIFETIME_SECONDS,
  updateAge: SESSION_RENEW_SECONDS,
  // The session (with the user, including mustChangePassword and the ban fields) is also kept
  // in a signed cookie for COOKIE_CACHE_SECONDS. Only getCachedSession() (the answer routes)
  // uses it; getSession() asks for a database read. When the cached copy is older than that,
  // Better Auth reads the database again and sets a new cookie, which the route must send
  // back (getCachedSession() returns it).
  cookieCache: { enabled: true, maxAge: COOKIE_CACHE_SECONDS },
} as const;
