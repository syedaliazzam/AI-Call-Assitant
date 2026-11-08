/**
 * File: apps/web/app/api/sync/pull/route.ts
 * Purpose: GET /api/sync/pull: a device reads this account's call-data changes since a time
 *          (ADR-0049). Thin: the work is in src/server/calldata/api.ts.
 * Used by: src/core/sync (Phase 3, browser)
 * Depends on: src/server/calldata/api.ts
 * Architecture: ADR-0049
 */
import { handlePull } from '@/server/calldata/api';

/** Next.js route setting: node:crypto decrypts the records. */
export const runtime = 'nodejs';

/** Next.js route setting: never cached (the answer changes with every write). */
export const dynamic = 'force-dynamic';

/** Next.js route setting: one page is read and decrypted well inside this. */
export const maxDuration = 60;

/**
 * Handles GET /api/sync/pull.
 *
 * @param request The request.
 * @returns See handlePull().
 */
export function GET(request: Request): Promise<Response> {
  return handlePull(request);
}
