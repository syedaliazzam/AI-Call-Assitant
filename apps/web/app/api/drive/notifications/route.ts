/**
 * File: apps/web/app/api/drive/notifications/route.ts
 * Purpose: GET /api/drive/notifications (the latest saved emails) and POST (Retry a failed one). Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleNotifications, handleRetry } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/drive/notifications.
 *
 * @param request The request.
 * @returns See handleNotifications().
 */
export function GET(request: Request): Promise<Response> {
  return handleNotifications(request);
}

/**
 * Handles POST /api/drive/notifications (Retry).
 *
 * @param request The request (body: DriveRetryRequest).
 * @returns See handleRetry().
 */
export function POST(request: Request): Promise<Response> {
  return handleRetry(request);
}
