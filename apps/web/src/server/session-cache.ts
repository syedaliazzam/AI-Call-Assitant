/**
 * File: apps/web/src/server/session-cache.ts
 * Purpose: The rule for reading an answer request's session from the 60-second cookie cache:
 *          one cached read, plus one database read when the cached session says the user must
 *          change their password (that cached flag can still be true for up to 60 s after the
 *          user changed it, and must not block their answers). Collects every Set-Cookie the
 *          reads produce, so the route can send them back.
 * Used by: src/server/auth.ts (getCachedSession)
 * Depends on: nothing (the session reads are passed in)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2; day-05-overlay-screenshots-notes.md
 *               Stage 0
 */
import 'server-only';

/** One session read: the session (or null) and the Set-Cookie values it produced. */
export interface SessionRead<S> {
  /** The session, or null when nobody is signed in. */
  session: S | null;
  /** Set-Cookie header values to send back on the response. */
  setCookies: string[];
}

/**
 * Reads the session once.
 *
 * @param fromDatabase True to skip the cookie cache.
 * @returns The read.
 */
export type SessionReader<S> = (fromDatabase: boolean) => Promise<SessionRead<S>>;

/** The part of a session this rule reads. */
export interface FlaggedSession {
  /** The signed-in user. */
  user: {
    /** True while the user must still replace a temporary password. */
    mustChangePassword: boolean;
  };
}

/**
 * Reads an answer request's session: from the cookie cache, and again from the database when
 * the cached copy says the password must still be changed.
 *
 * @param read Reads the session (from the cache, or from the database).
 * @returns The session to use and every Set-Cookie value, in order.
 * Called from: getCachedSession() in auth.ts; tests
 */
export async function readAnswerSession<S extends FlaggedSession>(
  read: SessionReader<S>,
): Promise<SessionRead<S>> {
  const cached = await read(false);
  if (!cached.session?.user.mustChangePassword) return cached;
  const fresh = await read(true);
  return { session: fresh.session, setCookies: [...cached.setCookies, ...fresh.setCookies] };
}
