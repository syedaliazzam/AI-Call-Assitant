/**
 * File: apps/web/app/api/cron/drive-flush/route.ts
 * Purpose: GET /api/cron/drive-flush: Vercel's daily job (vercel.json "crons") that sends the "saved"
 *          emails of sessions that waited 24 hours for a recording upload. Needs CRON_SECRET (Vercel sends
 *          it as a Bearer token); without it the route answers 404. Thin: the work is in
 *          src/server/google/api.ts.
 * Used by: Vercel Cron
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleFlushCron } from '@/server/google/api';

/** Next.js route setting: never cached. */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/cron/drive-flush.
 *
 * @param request The request (Authorization: Bearer CRON_SECRET).
 * @returns See handleFlushCron().
 */
export function GET(request: Request): Promise<Response> {
  return handleFlushCron(request);
}
