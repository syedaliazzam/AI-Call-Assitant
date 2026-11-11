/**
 * File: apps/web/app/api/google/status/route.ts
 * Purpose: GET /api/google/status: the Drive connection, folder, switches and email set-up, for Settings and the uploader. Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleStatus } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/google/status.
 *
 * @param request The request.
 * @returns See handleStatus().
 */
export function GET(request: Request): Promise<Response> {
  return handleStatus(request);
}
