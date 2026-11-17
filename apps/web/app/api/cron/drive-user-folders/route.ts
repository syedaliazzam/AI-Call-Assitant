/**
 * File: apps/web/app/api/cron/drive-user-folders/route.ts
 * Purpose: POST /api/cron/drive-user-folders (ADR-0097, one-time; under api/cron/ because, like the daily
 *          jobs, it checks its own secret and has no sign-in cookie): moves each session folder still in
 *          the company Drive folder itself into its owner's own folder. Dry run by default; open only with
 *          KITE_DRIVE_MOVE_SECRET (404 without it). Thin: the work is in src/server/google/move.ts.
 * Used by: the developer, once, with curl
 * Depends on: src/server/google/move.ts
 * Architecture: docs/decisions/ADR-0097-one-drive-folder-per-person.md
 */
import { handleMoveToUserFolders } from '@/server/google/move';

/** Next.js route setting: never cached. */
export const dynamic = 'force-dynamic';

/** Next.js route setting: a batch of moves takes a few Drive calls per folder. */
export const maxDuration = 60;

/**
 * Handles POST /api/cron/drive-user-folders.
 *
 * @param request The request (Authorization: Bearer KITE_DRIVE_MOVE_SECRET).
 * @returns See handleMoveToUserFolders().
 */
export function POST(request: Request): Promise<Response> {
  return handleMoveToUserFolders(request);
}
