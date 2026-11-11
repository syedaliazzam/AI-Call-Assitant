/**
 * File: apps/web/app/api/summary/route.ts
 * Purpose: POST /api/summary (ADR-0067): checks sign-in and the body, writes the short summary of a
 *          session's documents other than the CV with the fast model (server/summary.ts), and returns
 *          it as JSON. The device keeps the summary and sends it to the smart-model routes.
 * Used by: src/core/documents/summary.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/env.ts, src/server/validate.ts
 *             (parseSummaryRequest, MAX_REQUEST_BYTES), src/server/summary.ts, src/server/claude.ts
 *             (errors)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0067
 *
 * Not counted towards the daily limit (ADR-0036): like a warm-up, the device asks for it on its own,
 * once per set of documents. Logs ids, sizes, timings and token counts only: never document or
 * summary text.
 */
import type { AnswerErrorCode, DocumentsSummaryResponse } from '@kite/shared';
import { getCachedSession } from '@/server/auth';
import { describeClaudeError, errorLogDetails } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { writeDocumentsSummary } from '@/server/summary';
import { MAX_REQUEST_BYTES, parseSummaryRequest } from '@/server/validate';
import { readRequestText } from '@/server/requestBody';

/** Next.js route setting: the Anthropic SDK needs Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: reading 500k characters of documents can take a while. */
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
 * Handles POST /api/summary.
 *
 * @param request The incoming request; body is a DocumentsSummaryRequest (JSON).
 * @returns 401, 400, 500, 502/503/504, or 200 with a DocumentsSummaryResponse; each with any
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
  // 1.5.1 (ADR-0069): large bodies arrive gzipped (server/requestBody.ts); 4 MB as sent and unpacked.
  const body = await readRequestText(request, MAX_REQUEST_BYTES);
  if (!body.ok) {
    return jsonError(
      400,
      'bad_request',
      body.reason === 'too-large' ? 'Request is larger than 4 MB' : 'Body is not valid gzip',
    );
  }
  const raw = body.text;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  const parsed = parseSummaryRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);

  let model: string;
  try {
    model = getClaudeEnv().modelFast;
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }

  // Sizes only, never text.
  const sizes = {
    documents: parsed.data.documents.length,
    chars: parsed.data.documents.reduce((total, document) => total + document.text.length, 0),
  };
  try {
    const { summary, usage } = await writeDocumentsSummary(parsed.data, model);
    const ms = Math.round(performance.now() - startedAt);
    console.info('summary: done', { userId: user.id, model, ...sizes, ms, usage });
    const body: DocumentsSummaryResponse = { summary, usage, ms };
    return Response.json(body);
  } catch (error) {
    const described = describeClaudeError(error);
    console.error('summary: failed', {
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
