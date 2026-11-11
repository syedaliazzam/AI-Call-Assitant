/**
 * File: apps/web/app/api/drive/notify/route.ts
 * Purpose: POST /api/drive/notify: a session's uploads finished; one saved email per session. Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleNotify } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/drive/notify.
 *
 * @param request The request.
 * @returns See handleNotify().
 */
export function POST(request: Request): Promise<Response> {
  return handleNotify(request);
}
