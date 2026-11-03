/**
 * File: apps/web/app/api/ask/route.ts
 * Purpose: POST /api/ask (parity Phase 3): checks sign-in and the body, answers a question about a
 *          finished call with the smart model (server/ask.ts), and returns the reply as JSON.
 * Used by: src/core/review/ask.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/env.ts, src/server/validate.ts (and src/server/usage.ts: the daily limit, ADR-0036)
 *             (parseAskRequest), src/server/ask.ts, src/server/claude.ts (errors)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0029
 *
 * Logs ids, sizes, timings and token counts only: never the question, reply or call. The estimated
 * cost is logged in development only.
 */
import { dailyLimitMessage } from '@kite/shared';
import type { AnswerErrorCode, AskResponse } from '@kite/shared';
import { answerAboutCall, estimatedCost } from '@/server/ask';
import { getCachedSession } from '@/server/auth';
import { countRequest } from '@/server/usage';
import { describeClaudeError, errorLogDetails } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { MAX_REQUEST_BYTES, parseAskRequest } from '@/server/validate';

/** Next.js route setting: the Anthropic SDK needs Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: a short reply. */
export const maxDuration = 60;

/**
 * Builds a JSON error response.
 *
 * @param status  HTTP status code.
 * @param code    Machine-readable reason.
 * @param message Short explanation (never request content).
 * @returns The Response.
 * Called from: respond()
 */
function jsonError(status: number, code: AnswerErrorCode, message: string): Response {
  return Response.json({ code, message }, { status });
}

/**
 * Handles POST /api/ask.
 *
 * @param request The incoming request; body is an AskRequest (JSON).
 * @returns 401, 429 (daily limit), 400, 500, 502/503/504, or 200 with an AskResponse; each with any Set-Cookie from
 *          the session check.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const { session, setCookies } = await getCachedSession(request.headers);
  const response = await respond(request, session?.user ?? null, startedAt);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/**
 * The request after the sign-in check.
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
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
    return jsonError(400, 'bad_request', 'Request is larger than 4 MB');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  const parsed = parseAskRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);

  let model: string;
  try {
    model = getClaudeEnv().modelSmart;
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }

  // The per-user daily limit (ADR-0036): counted before Claude is called; over it, nothing is sent.
  const counted = await countRequest(user.id);
  if (!counted.allowed) {
    console.info('ask: daily limit reached', { userId: user.id, limit: counted.limit });
    return jsonError(429, 'daily_limit', dailyLimitMessage(counted.limit));
  }
  const sizes = { lines: parsed.data.lines.length, answers: parsed.data.answers.length };
  try {
    const { text, usage } = await answerAboutCall(parsed.data, model);
    const ms = Math.round(performance.now() - startedAt);
    console.info('ask: done', {
      userId: user.id,
      model,
      ...sizes,
      ms,
      usage,
      ...(process.env.NODE_ENV === 'development' ? { estimatedUsd: estimatedCost(usage) } : {}),
    });
    return Response.json({ text } satisfies AskResponse);
  } catch (error) {
    const described = describeClaudeError(error);
    console.error('ask: failed', {
      userId: user.id,
      model,
      ...sizes,
      code: described.code,
      ...errorLogDetails(error),
    });
    const status =
      described.code === 'timeout' ? 504 : described.code === 'claude_unavailable' ? 503 : 502;
    return jsonError(status, described.code, described.message);
  }
}
