/**
 * File: apps/web/app/api/google/folder/route.ts
 * Purpose: POST /api/google/folder: stores the folder picked in Google Picker (checked with Drive). Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleFolder } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/google/folder.
 *
 * @param request The request.
 * @returns See handleFolder().
 */
export function POST(request: Request): Promise<Response> {
  return handleFolder(request);
}
