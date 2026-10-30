/**
 * File: apps/web/app/api/answer/route.ts
 * Purpose: POST /api/answer: checks sign-in and the request body, calls Claude, and streams the
 *          reply back as server-sent events (delta, done, error). Modes: 'hello' (Day 1 test),
 *          'warm' (Day 3: writes a session's prompt cache; no text, just done with usage), and
 *          'answer' and 'chat' (Day 4: an answer built on the session, the conversation so far
 *          and the earlier answers, from server/prompt.ts). 'screenshot' arrives on Day 5.
 * Used by: src/core/answer/answerClient.ts (browser)
 * Depends on: src/server/auth.ts, src/server/env.ts, src/server/validate.ts, src/server/claude.ts,
 *             src/server/sse.ts, src/server/prompts/hello.ts, src/server/prompt.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6 (answer flow), §7.2 (/api/answer);
 *               day-04-answers.md Stage 3
 *
 * The reply must stream, not be collected and sent at the end: "time to first word" is the main
 * latency number, and buffering would turn it into "time to last word". Each Claude text piece
 * is written to the response immediately (src/server/sse.ts), and the headers turn off caching
 * and compression, which would otherwise hold output back.
 *
 * Logs contain ids, timings and token counts only, never prompt or answer text.
 */
import type {
  AnswerErrorCode,
  AnswerEvent,
  AnswerMode,
  AnswerRequest,
  AnswerTimings,
  ModelTier,
} from '@kite/shared';
import { getSession } from '@/server/auth';
import {
  CLAUDE_TIMEOUT_MS,
  describeClaudeError,
  errorLogDetails,
  streamReply,
  warmCache,
  type ReplyResult,
} from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { ANSWER_MAX_TOKENS, buildPrompt } from '@/server/prompt';
import { HELLO_MAX_TOKENS, HELLO_MESSAGES, HELLO_SYSTEM } from '@/server/prompts/hello';
import { SSE_HEADERS, toEventStream } from '@/server/sse';
import { MAX_REQUEST_BYTES, parseAnswerRequest } from '@/server/validate';

/** Next.js route setting: the Anthropic SDK and streaming bodies need Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route; every request is a new answer. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds; matches the 60 s Claude time limit. */
export const maxDuration = 60;

/** Which day each not-yet-built mode arrives (architecture §12.3). */
const MODE_DAY: Record<Exclude<AnswerMode, 'hello' | 'warm' | 'answer' | 'chat'>, number> = {
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

/** Options for warmReply(). */
interface WarmReplyOptions {
  /** Full model name. */
  model: string;
  /** Its tier (thinking setting). */
  tier: ModelTier;
  /** Aborts the request. */
  signal: AbortSignal;
  /** Called when Claude's response arrives (there is no stream to open). */
  onResponse: () => void;
}

/**
 * A warm-up as a text source with no text, so it goes through the same event stream as a reply:
 * the browser receives only `done` (usage and timings) or `error`. The request starts on the
 * first read of the stream.
 *
 * @param request A validated 'warm' request (with session).
 * @param options Model, tier, abort signal and the response callback.
 * @returns A generator that yields nothing and returns the warm-up's usage.
 * Called from: POST()
 */
async function* warmReply(
  request: AnswerRequest,
  options: WarmReplyOptions,
): AsyncGenerator<string, ReplyResult, undefined> {
  const prompt = buildPrompt(request);
  const result = await warmCache({
    model: options.model,
    tier: options.tier,
    system: prompt.system,
    messages: prompt.messages,
    signal: options.signal,
  });
  options.onResponse();
  return result;
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
  if (mode === 'screenshot') {
    return jsonError(400, 'not_implemented', `not implemented yet: Day ${MODE_DAY[mode]}`);
  }

  const tier: ModelTier = parsed.data.model ?? 'fast';
  let model: string;
  try {
    const env = getClaudeEnv();
    model = tier === 'smart' ? env.modelSmart : env.modelFast;
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
  const markOpen = () => {
    streamOpenAt ??= performance.now();
  };
  // Sizes only (never text), so the logs show how much context each answer carried.
  const context = {
    chunks: parsed.data.conversation?.length ?? 0,
    tailLines: parsed.data.tail?.length ?? 0,
  };
  let source: AsyncGenerator<string, ReplyResult, undefined>;
  if (mode === 'warm') {
    source = warmReply(parsed.data, { model, tier, signal, onResponse: markOpen });
  } else if (mode === 'hello') {
    source = streamReply({
      model,
      tier,
      system: HELLO_SYSTEM,
      messages: HELLO_MESSAGES,
      maxTokens: HELLO_MAX_TOKENS,
      signal,
      onStreamOpen: markOpen,
    });
  } else {
    // 'answer' and 'chat': the three cached parts and the uncached tail (server/prompt.ts).
    // The SDK's single retry happens only before any text arrives (server/claude.ts).
    const prompt = buildPrompt(parsed.data);
    source = streamReply({
      model,
      tier,
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: ANSWER_MAX_TOKENS,
      signal,
      onStreamOpen: markOpen,
    });
  }

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
        ...context,
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
        ...context,
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
