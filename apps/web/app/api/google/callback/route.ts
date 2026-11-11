/**
 * File: apps/web/app/api/google/callback/route.ts
 * Purpose: GET /api/google/callback: Google's redirect back; checks the state, stores the refresh token encrypted, goes to Settings. Thin: the work is in src/server/google/api.ts.
 * Used by: Google OAuth (the redirect URI registered in Google Cloud)
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleCallback } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/google/callback.
 *
 * @param request The request.
 * @returns See handleCallback().
 */
export function GET(request: Request): Promise<Response> {
  return handleCallback(request);
}
