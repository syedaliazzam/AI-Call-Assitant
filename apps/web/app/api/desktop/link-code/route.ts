/**
 * File: apps/web/app/api/desktop/link-code/route.ts
 * Purpose: POST /api/desktop/link-code: a one-time desktop sign-in code for one of the account's
 *          sessions (ADR-0052). Thin: the work is in src/server/desktopLinkIssue.ts.
 * Used by: src/core/auth/desktopLink.ts (browser)
 * Depends on: src/server/desktopLinkIssue.ts
 * Architecture: ADR-0052
 */
import { handleIssueLinkCode } from '@/server/desktopLinkIssue';

/** Next.js route setting: node:crypto makes the code. */
export const runtime = 'nodejs';

/** Next.js route setting: never cached (every answer is a new secret). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/desktop/link-code.
 *
 * @param request The request.
 * @returns See handleIssueLinkCode().
 */
export function POST(request: Request): Promise<Response> {
  return handleIssueLinkCode(request);
}
