/**
 * Tests for apps/web/src/server/auth-options.ts, with a real Better Auth instance built from
 * Kite's session and user settings on Better Auth's in-memory database, and a mocked clock:
 * the cookie cache is on with a 60-second max age; a cached session carries mustChangePassword;
 * a user disabled the way the admin plugin does it (ban fields set, sessions deleted) is still
 * accepted from the cookie cache at 59 s and rejected at 61 s, while a database read
 * (disableCookieCache, as every page does) rejects at once; after 60 s the database read sets
 * a fresh cache cookie (Set-Cookie) for an active user. Invented account only.
 */
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { admin } from 'better-auth/plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COOKIE_CACHE_SECONDS, SESSION_OPTIONS, USER_OPTIONS } from '@/server/auth-options';

/** Base time of the mocked clock. */
const T0 = new Date('2026-10-31T09:00:00Z').getTime();

/**
 * A Better Auth instance with Kite's settings on an empty in-memory database.
 *
 * @returns The instance and its tables.
 */
function testAuth() {
  const tables: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'test-secret-test-secret-test-secret-1234',
    database: memoryAdapter(tables),
    // Sign-up is on here only to create the invented account (Kite turns it off).
    emailAndPassword: { enabled: true },
    user: USER_OPTIONS,
    session: SESSION_OPTIONS,
    plugins: [admin()],
    logger: { disabled: true },
  });
  return { auth, tables };
}

/**
 * Signs up and in, and returns a Cookie header carrying both the session token and the
 * session cookie cache.
 *
 * @param auth The instance.
 * @returns The Cookie header value and the user id.
 */
async function signedIn(auth: ReturnType<typeof testAuth>['auth']) {
  const email = 'invented-user@example.com';
  const password = 'invented-password-123';
  await auth.api.signUpEmail({ body: { name: 'Invented', email, password } });
  const result = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const cookie = result.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
  return { cookie, userId: result.response.user.id };
}

/**
 * Reads the session.
 *
 * @param auth   The instance.
 * @param cookie The Cookie header.
 * @param fromDb True to skip the cookie cache, as getSession() does for pages.
 * @returns The session (or null) and the Set-Cookie values.
 */
async function read(auth: ReturnType<typeof testAuth>['auth'], cookie: string, fromDb = false) {
  const result = await auth.api.getSession({
    headers: new Headers({ cookie }),
    ...(fromDb ? { query: { disableCookieCache: true } } : {}),
    returnHeaders: true,
  });
  return { session: result.response, setCookies: result.headers.getSetCookie() };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('session cookie cache', () => {
  it('is on with a 60-second max age', () => {
    expect(COOKIE_CACHE_SECONDS).toBe(60);
    expect(SESSION_OPTIONS.cookieCache).toEqual({ enabled: true, maxAge: 60 });
  });

  it('carries mustChangePassword in the cached session', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const { auth } = testAuth();
    const { cookie } = await signedIn(auth);
    const { session } = await read(auth, cookie);
    // A new account must change its password (defaultValue true), and the cache says so.
    expect(session?.user.mustChangePassword).toBe(true);
  });

  it('a disabled user: cache accepts until 60 s, rejects after; a database read rejects at once', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const { auth } = testAuth();
    const { cookie, userId } = await signedIn(auth);
    // Disable as the admin plugin's banUser does: ban fields, then every session deleted.
    const context = await auth.$context;
    await context.internalAdapter.updateUser(userId, { banned: true, banReason: 'test' });
    await context.internalAdapter.deleteUserSessions(userId);

    // Pages read the database: refused straight away.
    expect((await read(auth, cookie, true)).session).toBeNull();

    vi.setSystemTime(T0 + 59_000);
    expect((await read(auth, cookie)).session?.user.id).toBe(userId);

    vi.setSystemTime(T0 + 61_000);
    expect((await read(auth, cookie)).session).toBeNull();
  });

  it('after 60 s an active user is read from the database and gets a fresh cache cookie', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const { auth } = testAuth();
    const { cookie, userId } = await signedIn(auth);
    // Within 60 s: from the cache, no new cookie.
    vi.setSystemTime(T0 + 30_000);
    const cached = await read(auth, cookie);
    expect(cached.session?.user.id).toBe(userId);
    expect(cached.setCookies.some((line) => line.includes('session_data='))).toBe(false);
    // After 60 s: a database read, and a new session_data cookie to send back.
    vi.setSystemTime(T0 + 61_000);
    const refreshed = await read(auth, cookie);
    expect(refreshed.session?.user.id).toBe(userId);
    expect(refreshed.setCookies.some((line) => line.includes('session_data='))).toBe(true);
  });
});
