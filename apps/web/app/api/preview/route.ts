/**
 * File: apps/web/app/api/preview/route.ts
 * Purpose: POST /api/preview (parity Phase 2): checks sign-in and the request, and writes one
 *          Answer preview with the fast model. The browser asks once per combination of settings
 *          and keeps the result (core/answer/preview.ts).
 * Used by: src/core/answer/preview.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/env.ts, src/server/validate.ts (and src/server/usage.ts: the daily limit, ADR-0036)
 *             (parsePreviewRequest), src/server/preview.ts, src/server/claude.ts (errors)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0029
 *
 * Logs ids, timings and token counts only.
 */
import { dailyLimitMessage } from '@kite/shared';
import type { AnswerErrorCode, AnswerPreviewResponse } from '@kite/shared';
import { getCachedSession } from '@/server/auth';
import { countRequest } from '@/server/usage';
import { describeClaudeError, errorLogDetails } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { generatePreview } from '@/server/preview';
import { parsePreviewRequest } from '@/server/validate';

/** Next.js route setting: the Anthropic SDK needs Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: one short answer. */
export const maxDuration = 60;

/**
 * Builds a JSON error response.
 *
 * @param status  HTTP status code.
 * @param code    Machine-readable reason.
 * @param message Short explanation.
 * @returns The Response.
 * Called from: respond()
 */
function jsonError(status: number, code: AnswerErrorCode, message: string): Response {
  return Response.json({ code, message }, { status });
}

/**
 * Handles POST /api/preview.
 *
 * @param request The incoming request; body is an AnswerPreviewRequest (JSON).
 * @returns 401, 429 (daily limit), 400, 500, 502/503/504, or 200 with an AnswerPreviewResponse; each with any
 *          Set-Cookie from the session check.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const { session, setCookies } = await getCachedSession(request.headers);
  const response = await respond(request, session?.user ?? null, startedAt);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/**
 * The preview request after the sign-in check.
 *
 * @param request   The incoming request.
 * @param user      The signed-in user, or null.
 * @param startedAt When the request arrived (performance.now()).
 * @returns The response (see POST()).
 * Called from: POST()
 */
async function respond(
  request: Request,
  user: { id: string; mustChangePassword: boolean } | null,
  startedAt: number,
): Promise<Response> {
  if (!user) return jsonError(401, 'unauthorized', 'Sign in required');
  if (user.mustChangePassword) {
    return jsonError(401, 'unauthorized', 'Change your temporary password first');
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  const parsed = parsePreviewRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);

  let model: string;
  try {
    model = getClaudeEnv().modelFast;
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }

  // The per-user daily limit (ADR-0036): counted before Claude is called; over it, nothing is sent.
  const counted = await countRequest(user.id);
  if (!counted.allowed) {
    console.info('preview: daily limit reached', { userId: user.id, limit: counted.limit });
    return jsonError(429, 'daily_limit', dailyLimitMessage(counted.limit));
  }
  try {
    const { text, usage } = await generatePreview(parsed.data, model);
    const ms = Math.round(performance.now() - startedAt);
    console.info('preview: done', { userId: user.id, model, ms, usage });
    return Response.json({ text } satisfies AnswerPreviewResponse);
  } catch (error) {
    const described = describeClaudeError(error);
    console.error('preview: failed', {
      userId: user.id,
      model,
      code: described.code,
      ...errorLogDetails(error),
    });
    const status =
      described.code === 'timeout' ? 504 : described.code === 'claude_unavailable' ? 503 : 502;
    return jsonError(status, described.code, described.message);
  }
}
