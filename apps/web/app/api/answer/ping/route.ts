/**
 * File: apps/web/app/api/answer/ping/route.ts
 * Purpose: GET/HEAD /api/answer/ping (Batch C, P1-2): the authenticated keep-alive of a live call, so the
 *          connection the answers use stays open. Thin: the work is in src/server/ping.ts.
 * Used by: src/core/answer/keepAlive.ts (browser, every 25 s during a call)
 * Depends on: src/server/ping.ts
 * Architecture: docs/investigations/2026-11-13-production-readiness.md D2; ADR-0078
 */
import { handlePing } from '@/server/ping';

/** Next.js route setting: Node.js (the session check may read the database). */
export const runtime = 'nodejs';
/** Next.js route setting: never cached or pre-rendered (every ping is a real round trip). */
export const dynamic = 'force-dynamic';

/**
 * Handles HEAD /api/answer/ping (what the page sends).
 *
 * @param request The request.
 * @returns See handlePing().
 */
export function HEAD(request: Request): Promise<Response> {
  return handlePing(request);
}

/**
 * Handles GET /api/answer/ping (the same; for tools that cannot send HEAD).
 *
 * @param request The request.
 * @returns See handlePing().
 */
export function GET(request: Request): Promise<Response> {
  return handlePing(request);
}
