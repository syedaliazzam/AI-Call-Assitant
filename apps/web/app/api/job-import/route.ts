/**
 * File: apps/web/app/api/job-import/route.ts
 * Purpose: POST /api/job-import (parity Phase 2, "Paste a job link"): checks sign-in, fetches the
 *          public job page (only public addresses: server/job-page.ts), extracts the company, role
 *          and description with the fast model, and returns them for the user to check and edit.
 * Used by: src/core/session/jobImport.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/env.ts, src/server/validate.ts (and src/server/usage.ts: the daily limit, ADR-0036)
 *             (parseJobImportRequest), src/server/job-page.ts, src/server/job-import.ts,
 *             src/server/claude.ts (errors)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2, §8; ADR-0029
 *
 * Logs ids, sizes, timings and token counts only: never the page text, what was extracted, or the
 * full address (it can carry personal tokens); the host name at most.
 */
import { dailyLimitMessage } from '@kite/shared';
import type { AnswerErrorCode, JobImportResponse } from '@kite/shared';
import { getCachedSession } from '@/server/auth';
import { countRequest } from '@/server/usage';
import { describeClaudeError, errorLogDetails } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { extractJobDetails } from '@/server/job-import';
import { fetchJobPage, JobPageError, pageText, type JobPageFailure } from '@/server/job-page';
import { parseJobImportRequest } from '@/server/validate';

/** Next.js route setting: raw sockets and the Anthropic SDK need Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: up to 10 s for the page, then one short Claude reply. */
export const maxDuration = 60;

/** A page with less text than this holds no job posting (often a page built only by scripts). */
const MIN_PAGE_CHARS = 80;

/** What the user is told for each reason a page could not be read. */
const PAGE_MESSAGES: Record<JobPageFailure, string> = {
  bad_url: 'That does not look like a web link. Copy the full address of the job page.',
  blocked: 'Paramount AI can only read public web pages.',
  unreadable:
    'Paramount AI could not read that page: some job sites block automatic reading. Paste the details below instead.',
};

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
 * Handles POST /api/job-import.
 *
 * @param request The incoming request; body is a JobImportRequest (JSON).
 * @returns 401, 429 (daily limit), 400, 422 (the page could not be read), 500, 502/503/504, or 200 with a
 *          JobImportResponse; each with any Set-Cookie from the session check.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const { session, setCookies } = await getCachedSession(request.headers);
  const response = await respond(request, session?.user ?? null, startedAt);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/**
 * The import after the sign-in check.
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
  const parsed = parseJobImportRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);

  let model: string;
  try {
    model = getClaudeEnv().modelFast;
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }

  let text: string;
  let host: string;
  try {
    const page = await fetchJobPage(parsed.data.url);
    text = pageText(page.body);
    host = page.url.hostname;
  } catch (error) {
    const reason = error instanceof JobPageError ? error.reason : 'unreadable';
    console.info('job-import: page refused', { userId: user.id, reason });
    return jsonError(422, 'bad_request', PAGE_MESSAGES[reason]);
  }
  if (text.length < MIN_PAGE_CHARS) {
    console.info('job-import: page empty', { userId: user.id, chars: text.length });
    return jsonError(422, 'bad_request', PAGE_MESSAGES.unreadable);
  }

  // The per-user daily limit (ADR-0036): counted before Claude is called; over it, nothing is sent.
  const counted = await countRequest(user.id);
  if (!counted.allowed) {
    console.info('job-import: daily limit reached', { userId: user.id, limit: counted.limit });
    return jsonError(429, 'daily_limit', dailyLimitMessage(counted.limit));
  }

  try {
    const { fields, usage } = await extractJobDetails(text, model);
    const ms = Math.round(performance.now() - startedAt);
    console.info('job-import: done', { userId: user.id, model, chars: text.length, ms, usage });
    return Response.json({ fields, host } satisfies JobImportResponse);
  } catch (error) {
    const described = describeClaudeError(error);
    console.error('job-import: failed', {
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
