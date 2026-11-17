/**
 * File: apps/web/app/api/drive/my-folder/route.ts
 * Purpose: GET /api/drive/my-folder (ADR-0097): the signed-in person's own Google Drive folder, for the
 *          link in Settings → Google Drive. Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts (myFolder)
 * Depends on: src/server/google/api.ts
 * Architecture: docs/decisions/ADR-0097-one-drive-folder-per-person.md
 */
import { handleMyFolder } from '@/server/google/api';

/** Next.js route setting: never cached (per account). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/drive/my-folder.
 *
 * @param request The request.
 * @returns See handleMyFolder().
 */
export function GET(request: Request): Promise<Response> {
  return handleMyFolder(request);
}
