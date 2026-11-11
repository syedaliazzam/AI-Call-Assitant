/**
 * File: apps/web/app/api/google/connect/route.ts
 * Purpose: GET /api/google/connect: sends the signed-in person to Google's consent page (drive.file only). Thin: the work is in src/server/google/api.ts.
 * Used by: src/features/settings/GoogleDriveSetting.tsx (a link)
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleConnect } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/google/connect.
 *
 * @param request The request.
 * @returns See handleConnect().
 */
export function GET(request: Request): Promise<Response> {
  return handleConnect(request);
}
