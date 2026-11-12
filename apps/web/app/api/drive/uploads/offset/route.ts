/**
 * File: apps/web/app/api/drive/uploads/offset/route.ts
 * Purpose: POST /api/drive/uploads/offset: where an upload got to, for a resume (ADR-0074). Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0074
 */
import { handleUploadOffset } from '@/server/google/api';

/** Next.js route setting: never cached (per account). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/drive/uploads/offset.
 *
 * @param request The request.
 * @returns See handleUploadOffset().
 */
export function POST(request: Request): Promise<Response> {
  return handleUploadOffset(request);
}
