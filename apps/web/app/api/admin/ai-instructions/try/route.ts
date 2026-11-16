/**
 * File: apps/web/app/api/admin/ai-instructions/try/route.ts
 * Purpose: POST /api/admin/ai-instructions/try: Admin → AI settings' "Try it" (ADR-0083, ADR-0089). Runs
 *          one request with an unsaved draft of a tab's global prompt and returns the reply, with a token
 *          that lets that exact draft be saved. Admins only (401 signed out, 403 for anyone else); counts
 *          against the daily limit like any request.
 * Used by: src/core/admin/aiTry.ts (browser)
 * Depends on: src/server/auth.ts (auth: a fresh session read), src/server/aiTry.ts (handleTry, runTry),
 *             src/server/env.ts, src/server/usage.ts, src/server/requestBody.ts,
 *             src/server/promptTryToken.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               ADR-0089-global-prompts-with-locked-contract.md
 */
import { auth } from '@/server/auth';
import { handleTry, runTry, type TryDeps } from '@/server/aiTry';
import { CLAUDE_TIMEOUT_MS } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { promptTryToken } from '@/server/promptTryToken';
import { readRequestText } from '@/server/requestBody';
import { countRequest } from '@/server/usage';
import { MAX_REQUEST_BYTES } from '@/server/validate';

/** Next.js route setting: the Anthropic SDK needs Node.js. */
export const runtime = 'nodejs';
/** Next.js route setting: never cache; every try is a new request. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: a try of the notes can take as long as the notes. */
export const maxDuration = 120;

/** The real dependencies. */
const deps: TryDeps = {
  models: () => {
    const env = getClaudeEnv();
    return { fast: env.modelFast, smart: env.modelSmart };
  },
  count: (userId) => countRequest(userId),
  run: runTry,
  tokenFor: promptTryToken,
};

/**
 * Handles POST /api/admin/ai-instructions/try.
 *
 * @param request The incoming request; body is an AiTryRequest (JSON).
 * @returns See handleTry() in src/server/aiTry.ts.
 */
export async function POST(request: Request): Promise<Response> {
  // Read from the database, not the 60-second cookie cache: an admin whose role was just removed is
  // refused at once. A try is not in a call, so the extra read costs nothing that matters.
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  let response: Response;
  // The role is checked before the body is read (handleTry() answers 403 for anyone but an admin).
  if (session && session.user.role === 'admin') {
    const received = await readRequestText(request, MAX_REQUEST_BYTES);
    response = received.ok
      ? await handleTry(
          session.user,
          received.text,
          deps,
          AbortSignal.any([request.signal, AbortSignal.timeout(CLAUDE_TIMEOUT_MS * 2)]),
        )
      : Response.json({ code: 'bad_request', message: 'Request is too large' }, { status: 400 });
  } else {
    response = await handleTry(session?.user ?? null, '', deps, request.signal);
  }
  return response;
}
