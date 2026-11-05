/**
 * File: apps/web/app/api/models/route.ts
 * Purpose: GET /api/models: whether sessions may choose the deeper model, so the wizard can say so. The
 *          answer route enforces it either way; this is only for showing the choice.
 * Used by: src/core/session/modelAccess.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/modelAccess.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §6
 */
import type { ModelAccessResponse } from '@kite/shared';
import { getCachedSession } from '@/server/auth';
import { getDeepModelEnabled } from '@/server/modelAccess';

/** Next.js route setting: an admin's change must show, so never cache this. */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/models.
 *
 * @param request The incoming request.
 * @returns 401 when not signed in, otherwise 200 with a ModelAccessResponse.
 */
export async function GET(request: Request): Promise<Response> {
  const { session, setCookies } = await getCachedSession(request.headers);
  const response = session
    ? Response.json({ deepModel: await getDeepModelEnabled() } satisfies ModelAccessResponse)
    : Response.json({ code: 'unauthorized', message: 'Sign in required' }, { status: 401 });
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}
