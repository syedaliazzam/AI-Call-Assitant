/**
 * File: apps/web/app/api/sync/status/route.ts
 * Purpose: GET /api/sync/status: whether this account has account sync (the accountSync switch,
 *          ADR-0049). Thin: the work is in src/server/calldata/api.ts.
 * Used by: src/core/sync (Phase 3, browser)
 * Depends on: src/server/calldata/api.ts
 * Architecture: ADR-0049
 */
import { handleStatus } from '@/server/calldata/api';

/** Next.js route setting: never cached (the switch can change with a deploy's settings). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/sync/status.
 *
 * @param request The request.
 * @returns See handleStatus().
 */
export function GET(request: Request): Promise<Response> {
  return handleStatus(request);
}
