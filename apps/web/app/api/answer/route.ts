/**
 * File: apps/web/app/api/answer/route.ts
 * Purpose: POST /api/answer: checks sign-in and the request body, calls Claude, and streams the
 *          reply back as server-sent events (delta, done, error). Day 1 supports mode 'hello'.
 * Used by: src/core/answer/answerClient.ts (browser)
 * Depends on: src/server/auth.ts, src/server/env.ts, src/server/validate.ts, src/server/claude.ts,
 *             src/server/sse.ts, src/server/prompts/hello.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6 (answer flow), §7.2 (/api/answer)
 *
 * The reply must stream, not be collected and sent at the end: "time to first word" is the main
 * latency number, and buffering would turn it into "time to last word". Each Claude text piece
 * is written to the response immediately (src/server/sse.ts), and the headers turn off caching
 * and compression, which would otherwise hold output back.
 *
 * Logs contain ids, timings and token counts only, never prompt or answer text.
 */
import type { AnswerErrorCode, AnswerEvent, AnswerMode, AnswerTimings } from '@kite/shared';
import { getSession } from '@/server/auth';
import {
  CLAUDE_TIMEOUT_MS,
  describeClaudeError,
  errorLogDetails,
  streamReply,
} from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { HELLO_MAX_TOKENS, HELLO_MESSAGES, HELLO_SYSTEM } from '@/server/prompts/hello';
import { SSE_HEADERS, toEventStream } from '@/server/sse';
import { MAX_REQUEST_BYTES, parseAnswerRequest } from '@/server/validate';

// The Anthropic SDK and streaming bodies need the Node.js runtime (not Edge).
export const runtime = 'nodejs';
// Never cache or pre-render this route: every request is a new answer.
export const dynamic = 'force-dynamic';
// Vercel function limit in seconds; matches the 60 s Claude time limit.
export const maxDuration = 60;

/** Which day each not-yet-built mode arrives (architecture §12.3). */
const MODE_DAY: Record<Exclude<AnswerMode, 'hello'>, number> = {
  warm: 3,
  answer: 4,
  chat: 4,
  screenshot: 5,
};

/**
 * Builds a JSON error response (used before streaming starts).
 *
 * @param status  HTTP status code.
 * @param code    Machine-readable reason.
 * @param message Short explanation (never request content).
 * @returns The Response.
 * Called from: POST()
 */
function jsonError(status: number, code: AnswerErrorCode, message: string): Response {
  return Response.json({ code, message }, { status });
}

/**
 * Milliseconds between two performance.now() readings, rounded to whole milliseconds.
 *
 * @param from Start reading.
 * @param to   End reading.
 * @returns Rounded difference.
 * Called from: POST() (timings in the done event and logs)
 */
function elapsed(from: number, to: number): number {
  return Math.round(to - from);
}

/**
 * Handles POST /api/answer.
 *
 * @param request The incoming request; body is an AnswerRequest (JSON).
 * @returns 401 (not signed in), 400 (bad body or mode not built yet), 500 (Claude not
 *          configured), or 200 with a text/event-stream body.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();

  const session = await getSession();
  const authDoneAt = performance.now();
  if (!session) return jsonError(401, 'unauthorized', 'Sign in required');
  // A temporary password must be replaced before using the app (architecture §8.2).
  if (session.user.mustChangePassword) {
    return jsonError(401, 'unauthorized', 'Change your temporary password first');
  }

  // Size check before parsing (architecture §7.2: request ≤ 4 MB).
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    return jsonError(400, 'bad_request', 'Request is larger than 4 MB');
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
  const parsed = parseAnswerRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);

  const { mode } = parsed.data;
  if (mode !== 'hello') {
    return jsonError(400, 'not_implemented', `not implemented yet: Day ${MODE_DAY[mode]}`);
  }

  let model: string;
  try {
    const env = getClaudeEnv();
    model = parsed.data.model === 'smart' ? env.modelSmart : env.modelFast;
  } catch (error) {
    // The message names missing variables only (no values), so it is safe to log.
    console.error('answer: Claude is not configured', {
      requestId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }

  // Stop Claude when the browser disconnects or the 60 s limit passes, whichever comes first.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(CLAUDE_TIMEOUT_MS)]);
  let streamOpenAt: number | null = null;
  const source = streamReply({
    model,
    system: HELLO_SYSTEM,
    messages: HELLO_MESSAGES,
    maxTokens: HELLO_MAX_TOKENS,
    signal,
    onStreamOpen: () => {
      streamOpenAt ??= performance.now();
    },
  });

  const body = toEventStream(source, {
    onDone: (result, stats): AnswerEvent => {
      const doneAt = performance.now();
      // A reply with no text has no first delta; fall back to the end time.
      const firstTextAt = stats.firstDeltaAt ?? doneAt;
      const openAt = streamOpenAt ?? firstTextAt;
      const ms: AnswerTimings = {
        auth: elapsed(startedAt, authDoneAt),
        toStreamOpen: elapsed(startedAt, openAt),
        streamOpenToFirstText: elapsed(openAt, firstTextAt),
        toFirstText: elapsed(startedAt, firstTextAt),
        total: elapsed(startedAt, doneAt),
      };
      console.info('answer: done', {
        requestId,
        userId: session.user.id,
        mode,
        model,
        stopReason: result.stopReason,
        ms,
        usage: result.usage,
      });
      if (result.stopReason === 'refusal') {
        return { type: 'error', code: 'refused', message: 'Claude declined to answer this.' };
      }
      return { type: 'done', usage: result.usage, ms };
    },
    onError: (error): AnswerEvent => {
      const described = describeClaudeError(error);
      console.error('answer: failed', {
        requestId,
        userId: session.user.id,
        mode,
        model,
        code: described.code,
        ...errorLogDetails(error),
        msAuth: elapsed(startedAt, authDoneAt),
        msToStreamOpen: streamOpenAt === null ? null : elapsed(startedAt, streamOpenAt),
        msElapsed: elapsed(startedAt, performance.now()),
      });
      return { type: 'error', ...described };
    },
  });

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
