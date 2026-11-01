/**
 * Tests for apps/web/src/server/session-cache.ts, readAnswerSession(), with a fake session
 * reader: a normal session is read once from the cookie cache; a cached "must change password"
 * is checked once against the database, so a user who has just changed it is let through and a
 * user who still must change it stays blocked (the route then refuses); every Set-Cookie value
 * from both reads is kept, in order; no session stays null.
 */
import { describe, expect, it, vi } from 'vitest';
import { readAnswerSession, type SessionRead } from '@/server/session-cache';

/** A fake signed-in user. */
interface FakeUser {
  /** User id. */
  id: string;
  /** True while a temporary password must still be changed. */
  mustChangePassword: boolean;
}

/** A session with the field the rule reads. */
interface FakeSession {
  /** The user. */
  user: FakeUser;
}

/**
 * A fake reader returning a fixed cached and database result.
 *
 * @param cached   What the cookie cache gives.
 * @param database What the database gives.
 * @returns The reader spy.
 */
function reader(cached: SessionRead<FakeSession>, database: SessionRead<FakeSession>) {
  return vi.fn(async (fromDatabase: boolean) => (fromDatabase ? database : cached));
}

/**
 * A session.
 *
 * @param mustChangePassword The flag.
 * @returns The session.
 */
const session = (mustChangePassword: boolean): FakeSession => ({
  user: { id: 'u1', mustChangePassword },
});

describe('readAnswerSession', () => {
  it('reads a normal session once, from the cache', async () => {
    const read = reader(
      { session: session(false), setCookies: ['a=1'] },
      { session: null, setCookies: [] },
    );
    expect(await readAnswerSession(read)).toEqual({ session: session(false), setCookies: ['a=1'] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(false);
  });

  it('re-checks a cached "must change password" against the database', async () => {
    const changed = reader(
      { session: session(true), setCookies: ['a=1'] },
      { session: session(false), setCookies: ['session_data=new'] },
    );
    expect(await readAnswerSession(changed)).toEqual({
      session: session(false),
      setCookies: ['a=1', 'session_data=new'],
    });
    expect(changed).toHaveBeenLastCalledWith(true);

    const stillMust = reader(
      { session: session(true), setCookies: [] },
      { session: session(true), setCookies: [] },
    );
    expect((await readAnswerSession(stillMust)).session?.user.mustChangePassword).toBe(true);
  });

  it('returns null when nobody is signed in, without a database read', async () => {
    const read = reader(
      { session: null, setCookies: [] },
      { session: session(false), setCookies: [] },
    );
    expect((await readAnswerSession(read)).session).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
