/**
 * File: apps/web/app/api/drive/uploads/complete/route.ts
 * Purpose: POST /api/drive/uploads/complete: verifies a finished upload (tag, size, MD5) (ADR-0074). Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0074
 */
import { handleUploadComplete } from '@/server/google/api';

/** Next.js route setting: never cached (per account). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/drive/uploads/complete.
 *
 * @param request The request.
 * @returns See handleUploadComplete().
 */
export function POST(request: Request): Promise<Response> {
  return handleUploadComplete(request);
}
