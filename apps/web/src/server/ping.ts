/**
 * File: apps/web/src/server/ping.ts
 * Purpose: The keep-alive ping of a live call (Batch C, P1-2; investigation D2). During a call the page
 *          calls it every 25 s, so the browser keeps its HTTP/2 connection to Vercel's edge open and the
 *          next answer request skips a new TLS handshake (about 180 ms measured from Pakistan). It checks
 *          the sign-in from the 60-second cookie cache (a database read at most once a minute) and answers
 *          204 with no body; a refreshed session cookie goes back with it. Nothing is counted or logged.
 * Used by: app/api/answer/ping/route.ts
 * Depends on: src/server/auth.ts (getCachedSession)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md D2; ADR-0078
 */
import 'server-only';
import { getCachedSession } from './auth';

/**
 * Handles the ping.
 *
 * @param request The request (only its cookies are read).
 * @returns 204 when signed in, 401 otherwise; with any refreshed session cookie. Never cached.
 * Called from: app/api/answer/ping/route.ts (GET and HEAD)
 */
export async function handlePing(request: Request): Promise<Response> {
  const { session, setCookies } = await getCachedSession(request.headers);
  const response = new Response(null, {
    status: session ? 204 : 401,
    // Never served from a cache: the point is a real round trip on the open connection.
    headers: { 'cache-control': 'no-store' },
  });
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}
