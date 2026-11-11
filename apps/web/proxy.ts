/**
 * File: apps/web/proxy.ts
 * Purpose: Fast first check on every request (Next.js 16 "proxy", formerly middleware): if
 *          there is no session cookie, pages redirect to /login and API routes answer 401. The
 *          Google Drive connect and callback addresses (ADR-0072) are visited like pages (a link, which
 *          the desktop app opens in the system browser, and Google's redirect back), so they redirect.
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
 * API addresses a person visits like a page (1.6.0, ADR-0072): signed out, they go to /login rather than
 * get a JSON 401. Signed in, the route itself checks the session as usual.
 */
export const PAGE_LIKE_API_PATHS: readonly string[] = [
  '/api/google/connect',
  '/api/google/callback',
];

/**
 * Redirects or rejects requests that have no session cookie.
 *
 * @param request The incoming request.
 * @returns A redirect to /login (pages and PAGE_LIKE_API_PATHS), a 401 JSON response (other API
 *          routes), or "continue".
 * Called from: Next.js, before routing, for every request that config.matcher selects
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    return NextResponse.next();
  }
  const path = request.nextUrl.pathname;
  if (path.startsWith('/api/') && !PAGE_LIKE_API_PATHS.includes(path)) {
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
  // Run on everything except: the sign-in page, the desktop link page (ADR-0052: it signs the app in
  // with a one-time code, so it must open signed out), Better Auth's own endpoints (sign-in must work
  // without a cookie), Next.js build files, and static files with an extension (icons, models).
  matcher: [
    '/((?!login|desktop/link|api/auth|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)',
  ],
};
