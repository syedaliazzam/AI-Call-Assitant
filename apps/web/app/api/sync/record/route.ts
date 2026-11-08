/**
 * File: apps/web/app/api/sync/record/route.ts
 * Purpose: GET /api/sync/record: one of this account's call-data records, for example the session a
 *          desktop link opens (ADR-0049, ADR-0052). Thin: the work is in src/server/calldata/api.ts.
 * Used by: src/core/sync (Phase 3+, browser)
 * Depends on: src/server/calldata/api.ts
 * Architecture: ADR-0049
 */
import { handleRecord } from '@/server/calldata/api';

/** Next.js route setting: node:crypto decrypts the record. */
export const runtime = 'nodejs';

/** Next.js route setting: never cached. */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/sync/record.
 *
 * @param request The request.
 * @returns See handleRecord().
 */
export function GET(request: Request): Promise<Response> {
  return handleRecord(request);
}
