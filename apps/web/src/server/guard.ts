/**
 * File: apps/web/src/server/guard.ts
 * Purpose: Who may open which page. decideRedirect() holds the rules as a pure function
 *          (unit tested); requireUser() and requireAdmin() apply them in server components and
 *          server actions.
 * Used by: app/(app)/layout.tsx, app/(app)/admin/layout.tsx, app/(app)/admin/users/actions.ts,
 *          app/(app)/dev/layout.tsx (Stage 3)
 * Depends on: src/server/auth.ts, next/navigation
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2, §8.3
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { getSession, type AuthSession } from './auth';

/** The parts of a session the rules look at. */
export interface GuardSession {
  /** The signed-in user. */
  user: {
    /** 'admin' or 'user' (null/undefined is treated as 'user'). */
    role?: string | null;
    /** True until the user has replaced their temporary password. */
    mustChangePassword: boolean;
  };
}

/** Where the guard can send someone. */
export type GuardRedirect = '/login' | '/change-password' | '/';

/** Pages that admins only may open (the path itself and everything below it). */
const ADMIN_PATHS = ['/admin', '/dev'];

/**
 * Tells whether `pathname` is `base` or a page below it ('/admin' matches '/admin/users'
 * but not '/administrator').
 *
 * @param pathname The requested path.
 * @param base     The section's root path.
 * @returns True when the path is inside the section.
 * Called from: decideRedirect()
 */
function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Decides whether a visitor may see a page, and if not, where to send them.
 * Rules, in order:
 * 1. Signed out: only /login is allowed; everything else goes to /login.
 * 2. Must change password: only /change-password is allowed.
 * 3. Signed in on /login: go to the dashboard.
 * 4. Not an admin on /admin or /dev pages: go to the dashboard.
 *
 * @param session  The current session, or null when signed out.
 * @param pathname The requested path, for example '/admin/users'.
 * @returns The path to redirect to, or null when the page may be shown.
 * Called from: requireUser(), requireAdmin(), app/login/page.tsx, app/change-password/page.tsx
 */
export function decideRedirect(
  session: GuardSession | null,
  pathname: string,
): GuardRedirect | null {
  if (!session) {
    return pathname === '/login' ? null : '/login';
  }
  if (session.user.mustChangePassword) {
    return pathname === '/change-password' ? null : '/change-password';
  }
  if (pathname === '/login') {
    return '/';
  }
  if (session.user.role !== 'admin' && ADMIN_PATHS.some((base) => isUnder(pathname, base))) {
    return '/';
  }
  return null;
}

/**
 * Makes sure someone is signed in and has changed their temporary password.
 * Redirects (which ends rendering) otherwise.
 *
 * @returns The signed-in session.
 * Called from: app/(app)/layout.tsx
 */
export async function requireUser(): Promise<AuthSession> {
  const session = await getSession();
  // '/' stands for "any signed-in page": the sign-in and password rules are the same for all.
  const target = decideRedirect(session, '/');
  if (target || !session) redirect(target ?? '/login');
  return session;
}

/**
 * Makes sure the signed-in user is an admin. Redirects non-admins to the dashboard and
 * signed-out visitors to /login.
 *
 * @returns The admin's session.
 * Called from: app/(app)/admin/layout.tsx, app/(app)/dev/layout.tsx (Stage 3), and every
 *              server action in app/(app)/admin/users/actions.ts (layouts do not protect actions)
 */
export async function requireAdmin(): Promise<AuthSession> {
  const session = await getSession();
  const target = decideRedirect(session, '/admin');
  if (target || !session) redirect(target ?? '/login');
  return session;
}
