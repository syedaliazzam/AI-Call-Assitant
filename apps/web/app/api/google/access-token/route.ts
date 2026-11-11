/**
 * File: apps/web/app/api/google/access-token/route.ts
 * Purpose: GET /api/google/access-token: a short-lived Google access token (rate-limited); never the refresh token. Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleAccessToken } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/google/access-token.
 *
 * @param request The request.
 * @returns See handleAccessToken().
 */
export function GET(request: Request): Promise<Response> {
  return handleAccessToken(request);
}
