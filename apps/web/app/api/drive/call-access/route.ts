/**
 * File: apps/web/app/api/drive/call-access/route.ts
 * Purpose: POST /api/drive/call-access (ADR-0096, the Meetings library): gives the signed-in person Viewer
 *          access to their own session folder in the company Drive and returns one call's saved files.
 *          Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts (callAccess)
 * Depends on: src/server/google/api.ts
 * Architecture: docs/decisions/ADR-0096-meetings-library.md
 */
import { handleCallAccess } from '@/server/google/api';

/** Next.js route setting: never cached (per account). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/drive/call-access.
 *
 * @param request The request.
 * @returns See handleCallAccess().
 */
export function POST(request: Request): Promise<Response> {
  return handleCallAccess(request);
}
