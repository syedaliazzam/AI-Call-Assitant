/**
 * File: apps/web/app/api/drive/uploads/route.ts
 * Purpose: POST /api/drive/uploads: starts one recording upload and returns only its session address and ticket (ADR-0074). Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0074
 */
import { handleUploadStart } from '@/server/google/api';

/** Next.js route setting: never cached (per account). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/drive/uploads.
 *
 * @param request The request.
 * @returns See handleUploadStart().
 */
export function POST(request: Request): Promise<Response> {
  return handleUploadStart(request);
}
