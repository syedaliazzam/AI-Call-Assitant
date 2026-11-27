/**
 * File: apps/web/app/api/memory/route.ts
 * Purpose: POST /api/memory (ADR-0137): checks sign-in and the body, updates a call's running memory with the
 *          lines said since it was last written (server/callMemory.ts, fast model), and returns it as JSON.
 *          The device keeps it in memory for the call and sends it with every live answer.
 * Used by: src/core/answer/callMemory.ts (browser, in the background during a call)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/env.ts, src/server/validate.ts
 *             (parseCallMemoryRequest, MAX_REQUEST_BYTES), src/server/callMemory.ts, src/server/claude.ts
 *             (errors), src/server/requestBody.ts
 * Architecture: docs/decisions/ADR-0137-call-memory.md; docs/architecture/kite-architecture-v3.1.md §7.2
 *
 * Not counted towards the daily limit (ADR-0036): like a warm-up, the device asks for it on its own. Logs
 * ids, sizes, timings and token counts only: never transcript or memory text.
 */
import type { AnswerErrorCode, CallMemoryResponse } from '@kite/shared';
import { getCachedSession } from '@/server/auth';
import { EmptyMemoryError, updateCallMemory } from '@/server/callMemory';
import { describeClaudeError, errorLogDetails } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { readRequestText } from '@/server/requestBody';
import { MAX_REQUEST_BYTES, parseCallMemoryRequest } from '@/server/validate';

/** Next.js route setting: the Anthropic SDK needs Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: one short fast-model request. */
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
 * Handles POST /api/memory.
 *
 * @param request The incoming request; body is a CallMemoryRequest (JSON).
 * @returns 401, 400, 500, 502/503/504, or 200 with a CallMemoryResponse; each with any Set-Cookie from the
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
  const body = await readRequestText(request, MAX_REQUEST_BYTES);
  if (!body.ok) {
    return jsonError(
      400,
      'bad_request',
      body.reason === 'too-large' ? 'Request is larger than 4 MB' : 'Body is not valid gzip',
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  const parsed = parseCallMemoryRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);
  let model: string;
  try {
    model = getClaudeEnv().modelFast;
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }
  // Sizes only, never text.
  const sizes = { lines: parsed.data.lines.length, previousChars: parsed.data.previous.length };
  try {
    const { memory, usage, stopReason } = await updateCallMemory(parsed.data, model);
    const ms = Math.round(performance.now() - startedAt);
    console.info('memory: done', {
      userId: user.id,
      model,
      ...sizes,
      chars: memory.length,
      ms,
      usage,
      stopReason,
    });
    const reply: CallMemoryResponse = { memory, usage, ms };
    return Response.json(reply);
  } catch (error) {
    if (error instanceof EmptyMemoryError) {
      console.error('memory: failed', {
        userId: user.id,
        model,
        ...sizes,
        code: 'upstream_error',
        stopReason: error.stopReason,
        ms: Math.round(performance.now() - startedAt),
      });
      return jsonError(502, 'upstream_error', 'Claude returned no memory.');
    }
    const described = describeClaudeError(error);
    console.error('memory: failed', {
      userId: user.id,
      model,
      ...sizes,
      code: described.code,
      ms: Math.round(performance.now() - startedAt),
      ...errorLogDetails(error),
    });
    const status =
      described.code === 'timeout' ? 504 : described.code === 'claude_unavailable' ? 503 : 502;
    return jsonError(status, described.code, described.message);
  }
}
