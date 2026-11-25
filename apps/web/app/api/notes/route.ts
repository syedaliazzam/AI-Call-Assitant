/**
 * File: apps/web/app/api/notes/route.ts
 * Purpose: POST /api/notes (Day 5): checks sign-in (the 60-second session cookie cache, with
 *          any refreshed cookie sent back) and the request body, writes the call's notes with
 *          the smart model (server/notes.ts), and returns them as JSON (not streamed: the notes
 *          are written after the call, and nobody waits word by word).
 * Used by: src/core/notes/generate.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/env.ts, src/server/validate.ts (and src/server/usage.ts: the daily limit, ADR-0036)
 *             (parseNotesRequest), src/server/notes.ts, src/server/claude.ts (errors)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/notes);
 *               day-05-overlay-screenshots-notes.md Stage 5
 *
 * Logs ids, sizes, timings and token counts only: never transcript, answer, note or session text.
 */
import { dailyLimitMessage } from '@kite/shared';
import type { AnswerErrorCode, NotesResponse } from '@kite/shared';
import { getCachedSession } from '@/server/auth';
import { countRequest } from '@/server/usage';
import { describeClaudeError, errorLogDetails, ReplyCutOffError } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { generateCallNotes } from '@/server/notes';
import { companySettings } from '@/server/aiInstructions';
import { MAX_REQUEST_BYTES, parseNotesRequest } from '@/server/validate';

/** Next.js route setting: the Anthropic SDK needs Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: the notes of a long call can take about 20–40 s. */
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
 * Handles POST /api/notes.
 *
 * @param request The incoming request; body is a NotesRequest (JSON).
 * @returns 401 (not signed in), 429 (daily limit), 400 (bad body), 500 (not configured), 502/504 (Claude failed;
 *          ADR-0121: 502 'cut_off' or 'refused' for a reply that would fail the same way again),
 *          503 (Claude unavailable: usage limit or overload),
 *          or 200 with a NotesResponse; each with any Set-Cookie from the session check.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const { session, setCookies } = await getCachedSession(request.headers);
  const response = await respond(request, session?.user ?? null, startedAt);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/** The signed-in user, as far as this route reads it. */
interface NotesUser {
  /** User id (logged). */
  id: string;
  /** True while the user must still change a temporary password. */
  mustChangePassword: boolean;
}

/**
 * The notes request after the sign-in check.
 *
 * @param request   The incoming request.
 * @param user      The signed-in user, or null.
 * @param startedAt When the request arrived (performance.now()).
 * @returns The response (see POST()).
 * Called from: POST()
 */
async function respond(
  request: Request,
  user: NotesUser | null,
  startedAt: number,
): Promise<Response> {
  const requestId = crypto.randomUUID();
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
  const parsed = parseNotesRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);

  let model: string;
  try {
    model = getClaudeEnv().modelSmart;
  } catch (error) {
    console.error('notes: Claude is not configured', {
      requestId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }

  // The per-user daily limit (ADR-0036): counted before Claude is called; over it, nothing is sent.
  const counted = await countRequest(user.id);
  if (!counted.allowed) {
    console.info('notes: daily limit reached', { userId: user.id, limit: counted.limit });
    return jsonError(429, 'daily_limit', dailyLimitMessage(counted.limit));
  }

  // Sizes only (never text).
  const sizes = {
    lines: parsed.data.lines.length,
    chars: parsed.data.lines.reduce((total, line) => total + line.text.length, 0),
    answers: parsed.data.answers.length,
  };
  try {
    // ADR-0089: the notes global prompt of the version the call started with (ADR-0083 pin), or, with
    // no pin, the one in force.
    const company = await companySettings('notes', parsed.data.instructionsVersion);
    const { notes, usage, stopReason } = await generateCallNotes(
      parsed.data,
      model,
      company.globalPrompt,
    );
    const ms = Math.round(performance.now() - startedAt);
    console.info('notes: done', {
      requestId,
      userId: user.id,
      model,
      ...sizes,
      ms,
      usage,
      // ADR-0121: why the reply stopped, and whether the notes stop early (flags only, never text).
      stopReason,
      cutOff: notes.cutOff === true,
      counts: {
        summary: notes.summary.length,
        questions: notes.questions.length,
        nextSteps: notes.nextSteps.length,
        unclear: notes.unclear.length,
        lessons: notes.lessons.length,
      },
    });
    return Response.json({ notes, usage, ms } satisfies NotesResponse);
  } catch (error) {
    const described = describeClaudeError(error);
    console.error('notes: failed', {
      requestId,
      userId: user.id,
      model,
      ...sizes,
      code: described.code,
      ...errorLogDetails(error),
      // ADR-0121: a reply cut off before anything usable: how many tokens it used (a count only).
      ...(error instanceof ReplyCutOffError ? { outputTokens: error.outputTokens } : {}),
      ms: Math.round(performance.now() - startedAt),
    });
    // 503 when Claude is unavailable for everyone (usage limit or overload): the browser shows
    // that plainly instead of a generic failure (core/answer/unavailable.ts).
    const status =
      described.code === 'timeout' ? 504 : described.code === 'claude_unavailable' ? 503 : 502;
    return jsonError(status, described.code, described.message);
  }
}
