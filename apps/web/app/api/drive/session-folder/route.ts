/**
 * File: apps/web/app/api/drive/session-folder/route.ts
 * Purpose: POST /api/drive/session-folder: finds or makes a session's folders in the company folder (ADR-0074). Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0074
 */
import { handleSessionFolder } from '@/server/google/api';

/** Next.js route setting: never cached (per account). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/drive/session-folder.
 *
 * @param request The request.
 * @returns See handleSessionFolder().
 */
export function POST(request: Request): Promise<Response> {
  return handleSessionFolder(request);
}
