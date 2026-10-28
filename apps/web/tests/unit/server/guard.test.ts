/**
 * Tests for apps/web/src/server/guard.ts, decideRedirect():
 * signed-out visitors go to /login, users with a temporary password go to /change-password,
 * signed-in users skip /login, and non-admins are kept out of /admin and /dev pages.
 */
import { describe, expect, it, vi } from 'vitest';

// guard.ts imports the Better Auth instance (which needs a database); decideRedirect() does
// not use it, so a stub is enough.
vi.mock('@/server/auth', () => ({ getSession: vi.fn() }));

const { decideRedirect } = await import('@/server/guard');

/**
 * Builds a session for a user with the given role and password state.
 *
 * @param role               'admin' or 'user'.
 * @param mustChangePassword True while the user still has a temporary password (default false).
 * @returns The session, in the shape decideRedirect() reads.
 */
function sessionFor(role: 'admin' | 'user', mustChangePassword = false) {
  return { user: { role, mustChangePassword } };
}

describe('decideRedirect', () => {
  it('sends signed-out visitors to /login', () => {
    expect(decideRedirect(null, '/')).toBe('/login');
    expect(decideRedirect(null, '/admin/users')).toBe('/login');
    expect(decideRedirect(null, '/change-password')).toBe('/login');
  });

  it('lets signed-out visitors see /login', () => {
    expect(decideRedirect(null, '/login')).toBeNull();
  });

  it('sends users with a temporary password to /change-password from every page', () => {
    const session = sessionFor('user', true);
    expect(decideRedirect(session, '/')).toBe('/change-password');
    expect(decideRedirect(session, '/login')).toBe('/change-password');
    expect(decideRedirect(sessionFor('admin', true), '/admin/users')).toBe('/change-password');
  });

  it('lets users with a temporary password see /change-password', () => {
    expect(decideRedirect(sessionFor('user', true), '/change-password')).toBeNull();
  });

  it('sends signed-in users away from /login to the dashboard', () => {
    expect(decideRedirect(sessionFor('user'), '/login')).toBe('/');
  });

  it('keeps non-admins out of /admin and /dev pages', () => {
    const session = sessionFor('user');
    expect(decideRedirect(session, '/admin')).toBe('/');
    expect(decideRedirect(session, '/admin/users')).toBe('/');
    expect(decideRedirect(session, '/dev/claude-test')).toBe('/');
  });

  it('treats a missing role as a normal user', () => {
    expect(decideRedirect({ user: { role: null, mustChangePassword: false } }, '/admin')).toBe('/');
  });

  it('does not treat look-alike paths as admin pages', () => {
    expect(decideRedirect(sessionFor('user'), '/administrator')).toBeNull();
    expect(decideRedirect(sessionFor('user'), '/devices')).toBeNull();
  });

  it('lets admins open admin and dev pages', () => {
    const session = sessionFor('admin');
    expect(decideRedirect(session, '/admin/users')).toBeNull();
    expect(decideRedirect(session, '/dev/claude-test')).toBeNull();
  });

  it('lets signed-in users open normal pages and change their password voluntarily', () => {
    expect(decideRedirect(sessionFor('user'), '/')).toBeNull();
    expect(decideRedirect(sessionFor('user'), '/change-password')).toBeNull();
  });
});
