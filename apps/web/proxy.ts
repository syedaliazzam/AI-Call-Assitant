/**
 * File: apps/web/proxy.ts
 * Purpose: Fast first check on every request (Next.js 16 "proxy", formerly middleware): if
 *          there is no session cookie, pages redirect to /login and API routes answer 401.
 *          It only checks that the cookie EXISTS; the real checks (valid session, password
 *          changed, admin role) run on the server in requireUser() / requireAdmin().
 * Used by: Next.js (runs before matching routes)
 * Depends on: better-auth/cookies
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.3 ("Sign-in required on every
 *               page and API route")
 */
import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Redirects or rejects requests that have no session cookie.
 *
 * @param request The incoming request.
 * @returns A redirect to /login (pages), a 401 JSON response (API routes), or "continue".
 * Called from: Next.js, before routing, for every request that config.matcher selects
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { code: 'unauthorized', message: 'Sign in required' },
      { status: 401 },
    );
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

/**
 * Which requests Next.js runs proxy() for. Signed-out pages and files must stay reachable.
 */
export const config = {
  // Run on everything except: the sign-in page, Better Auth's own endpoints (sign-in must work
  // without a cookie), Next.js build files, and static files with an extension (icons, models).
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
