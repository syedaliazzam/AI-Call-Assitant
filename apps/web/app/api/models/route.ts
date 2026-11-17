/**
 * File: apps/web/app/api/models/route.ts
 * Purpose: GET /api/models: whether sessions may choose the deeper model and (ADR-0095) Groq, so the wizard
 *          and the overlay can say so; ADR-0099: whether this account is in the Gemini and GPT models' rollout,
 *          and whether each of those providers may be chosen. The answer route enforces all of them either way;
 *          this is only for showing the choice.
 * Used by: src/core/session/modelAccess.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/modelAccess.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §6; ADR-0095; ADR-0099
 */
import type { ModelAccessResponse } from '@kite/shared';
import { getCachedSession } from '@/server/auth';
import {
  getDeepModelEnabled,
  getGroqEnabled,
  getProviderEnabled,
  moreModelsFor,
} from '@/server/modelAccess';

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
  if (!session) {
    const refused = Response.json(
      { code: 'unauthorized', message: 'Sign in required' },
      { status: 401 },
    );
    for (const cookie of setCookies) refused.headers.append('set-cookie', cookie);
    return refused;
  }
  const userId = session.user.id;
  // ADR-0099: an account outside the rollout gets exactly the fields an older server sent.
  const more = moreModelsFor(userId);
  const [deepModel, groq, gemini, openai] = await Promise.all([
    getDeepModelEnabled(),
    getGroqEnabled(),
    more ? getProviderEnabled('gemini', userId) : Promise.resolve(false),
    more ? getProviderEnabled('openai', userId) : Promise.resolve(false),
  ]);
  const body: ModelAccessResponse = more
    ? { deepModel, groq, moreModels: true, gemini, openai }
    : { deepModel, groq };
  const response = Response.json(body);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}
