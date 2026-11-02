/**
 * File: apps/web/app/api/prepare/route.ts
 * Purpose: POST /api/prepare (parity Phase 4): checks sign-in and the body, runs one Prepare tool
 *          request (server/prepare.ts), and returns the reply as JSON.
 * Used by: src/core/prepare/client.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/env.ts, src/server/validate.ts
 *             (parsePrepareRequest), src/server/prepare.ts, src/server/claude.ts (errors)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0029
 *
 * Logs ids, the request's kind, timings and token counts only: never the session, questions or
 * answers.
 */
import type { AnswerErrorCode } from '@kite/shared';
import { getCachedSession } from '@/server/auth';
import { describeClaudeError, errorLogDetails } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { runPrepare, type PrepareModels } from '@/server/prepare';
import { MAX_REQUEST_BYTES, parsePrepareRequest } from '@/server/validate';

/** Next.js route setting: the Anthropic SDK needs Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: a whole question bank can take about a minute. */
export const maxDuration = 120;

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
 * Handles POST /api/prepare.
 *
 * @param request The incoming request; body is a PrepareRequest (JSON).
 * @returns 401, 400, 500, 502/503/504, or 200 with the reply; each with any Set-Cookie from the
 *          session check.
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
  const parsed = parsePrepareRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);

  let models: PrepareModels;
  try {
    const env = getClaudeEnv();
    models = { fast: env.modelFast, smart: env.modelSmart };
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }
  const { kind } = parsed.data;
  try {
    const { data, usage } = await runPrepare(parsed.data, models);
    const ms = Math.round(performance.now() - startedAt);
    console.info('prepare: done', { userId: user.id, kind, ms, usage });
    return Response.json(data);
  } catch (error) {
    const described = describeClaudeError(error);
    console.error('prepare: failed', {
      userId: user.id,
      kind,
      code: described.code,
      ...errorLogDetails(error),
    });
    const status =
      described.code === 'timeout' ? 504 : described.code === 'claude_unavailable' ? 503 : 502;
    return jsonError(status, described.code, described.message);
  }
}
