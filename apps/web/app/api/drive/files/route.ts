/**
 * File: apps/web/app/api/drive/files/route.ts
 * Purpose: POST /api/drive/files: uploads the page's own small files (transcript, notes) server-side (ADR-0074). Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0074
 */
import { handleSmallUpload } from '@/server/google/api';

/** Next.js route setting: never cached (per account). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/drive/files.
 *
 * @param request The request.
 * @returns See handleSmallUpload().
 */
export function POST(request: Request): Promise<Response> {
  return handleSmallUpload(request);
}
