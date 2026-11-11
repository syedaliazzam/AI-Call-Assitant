/**
 * File: apps/web/app/api/google/disconnect/route.ts
 * Purpose: POST /api/google/disconnect: revokes the token at Google and deletes the connection. Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleDisconnect } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/google/disconnect.
 *
 * @param request The request.
 * @returns See handleDisconnect().
 */
export function POST(request: Request): Promise<Response> {
  return handleDisconnect(request);
}
