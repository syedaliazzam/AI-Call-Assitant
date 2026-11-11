/**
 * File: apps/web/app/api/drive/test-email/route.ts
 * Purpose: POST /api/drive/test-email: a test email to the signed-in person only (rate-limited), to
 *          check the SMTP settings. Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts (Settings → Google Drive → Send test email)
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handleTestEmail } from '@/server/google/api';

/** Next.js route setting: never cached. */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/drive/test-email.
 *
 * @param request The request.
 * @returns See handleTestEmail().
 */
export function POST(request: Request): Promise<Response> {
  return handleTestEmail(request);
}
