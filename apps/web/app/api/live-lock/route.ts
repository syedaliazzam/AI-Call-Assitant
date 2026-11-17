/**
 * File: apps/web/app/api/live-lock/route.ts
 * Purpose: GET /api/live-lock (this account's live sessions) and POST /api/live-lock (a call's start,
 *          heartbeat and end) for the live-call lock (ADR-0098). Thin: the work is in src/server/liveLock.ts.
 * Used by: src/core/live/liveLock.ts
 * Depends on: src/server/liveLock.ts
 * Architecture: docs/decisions/ADR-0098-live-call-lock.md
 */
import { handleLiveLockGet, handleLiveLockPost } from '@/server/liveLock';

/** Next.js route setting: never cached (per account, changes every few seconds). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/live-lock.
 *
 * @param request The request.
 * @returns See handleLiveLockGet().
 */
export function GET(request: Request): Promise<Response> {
  return handleLiveLockGet(request);
}

/**
 * Handles POST /api/live-lock.
 *
 * @param request The request.
 * @returns See handleLiveLockPost().
 */
export function POST(request: Request): Promise<Response> {
  return handleLiveLockPost(request);
}
