/**
 * File: apps/web/app/api/google/settings/route.ts
 * Purpose: POST /api/google/settings: the Save and Email switches and the Also notify list. Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleSettings } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/google/settings.
 *
 * @param request The request.
 * @returns See handleSettings().
 */
export function POST(request: Request): Promise<Response> {
  return handleSettings(request);
}
