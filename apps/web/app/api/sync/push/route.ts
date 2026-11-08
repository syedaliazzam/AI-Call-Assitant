/**
 * File: apps/web/app/api/sync/push/route.ts
 * Purpose: POST /api/sync/push: a device sends its call-data changes (ADR-0049). Thin: the work is in
 *          src/server/calldata/api.ts.
 * Used by: src/core/sync (Phase 3, browser)
 * Depends on: src/server/calldata/api.ts
 * Architecture: ADR-0049
 */
import { handlePush } from '@/server/calldata/api';

/** Next.js route setting: node:crypto encrypts the records. */
export const runtime = 'nodejs';

/** Next.js route setting: never cached. */
export const dynamic = 'force-dynamic';

/** Next.js route setting: a full push of single statements fits well inside this. */
export const maxDuration = 60;

/**
 * Handles POST /api/sync/push.
 *
 * @param request The request.
 * @returns See handlePush().
 */
export function POST(request: Request): Promise<Response> {
  return handlePush(request);
}
