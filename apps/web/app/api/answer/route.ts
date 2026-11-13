/**
 * File: apps/web/app/api/answer/route.ts
 * Purpose: POST /api/answer: checks sign-in and the request body, calls Claude, and streams the
 *          reply back as server-sent events (delta, done, error). Modes: 'hello' (Day 1 test),
 *          'warm' (Day 3: writes a session's prompt cache; no text, just done with usage), and
 *          'answer' and 'chat' (Day 4: an answer built on the session, the conversation so far
 *          and the earlier answers, from server/prompt.ts), and 'screenshot' (Day 5: the same,
 *          with the screenshot in the uncached part), and 'kite' (ADR-0030: the Ask Kite page, from
 *          server/kite-chat.ts). Answers open with a hidden line that becomes a 'meta' event.
 * Used by: src/core/answer/answerClient.ts (browser)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/env.ts, src/server/validate.ts, src/server/claude.ts,
 *             src/server/sse.ts, src/server/prompts/hello.ts, src/server/prompt.ts,
 *             src/server/usage.ts (the daily limit, ADR-0036)
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
  AnswerRequest,
  AnswerTimings,
  ModelTier,
} from '@kite/shared';
import { dailyLimitMessage } from '@kite/shared';
import { getCachedSession, type AuthSession } from '@/server/auth';
import {
  CLAUDE_TIMEOUT_MS,
  describeClaudeError,
  errorLogDetails,
  streamReply,
  warmCache,
  type ReplyResult,
} from '@/server/claude';
import { withAnswerMeta, type ReplyItem } from '@/server/answer-meta';
import { getClaudeEnv } from '@/server/env';
import { buildKiteChatPrompt, KITE_CHAT_MAX_TOKENS } from '@/server/kite-chat';
import { ANSWER_MAX_TOKENS, buildPrompt } from '@/server/prompt';
import { HELLO_MAX_TOKENS, HELLO_MESSAGES, HELLO_SYSTEM } from '@/server/prompts/hello';
import { SSE_HEADERS, toEventStream } from '@/server/sse';
import { allowedTier, getDeepModelEnabled } from '@/server/modelAccess';
import { countRequest } from '@/server/usage';
import { MAX_REQUEST_BYTES, parseAnswerRequest } from '@/server/validate';
import { readRequestText } from '@/server/requestBody';
import { prime } from '@/server/prime';

/**
 * Modes that count towards the daily limit: what the user asked for. Warm-ups and the Day 1 hello
 * test are automatic or for developers, so they never count (ADR-0036).
 */
const COUNTED_MODES: ReadonlySet<AnswerRequest['mode']> = new Set([
  'answer',
  'chat',
  'screenshot',
  'kite',
]);

/** Next.js route setting: the Anthropic SDK and streaming bodies need Node.js (not Edge). */
export const runtime = 'nodejs';
/** Next.js route setting: never cache or pre-render this route; every request is a new answer. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds; matches the 60 s Claude time limit. */
export const maxDuration = 60;

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
 * Handles POST /api/answer. The sign-in check reads the 60-second session cookie cache
 * (server/auth.ts getCachedSession()), and any refreshed session cookie is sent back on the
 * response, whatever it is (an error or the stream), so the next request can use it too.
 *
 * @param request The incoming request; body is an AnswerRequest (JSON).
 * @returns 401 (not signed in), 400 (bad body or mode not built yet), 500 (Claude not
 *          configured), or 200 with a text/event-stream body; each with any Set-Cookie
 *          headers from the session check.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const { session, setCookies } = await getCachedSession(request.headers);
  const authDoneAt = performance.now();
  const response = await respond(request, session, startedAt, authDoneAt);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/**
 * The answer request after the sign-in check.
 *
 * @param request    The incoming request.
 * @param session    The session from the cookie cache (null when not signed in).
 * @param startedAt  When the request arrived (performance.now()).
 * @param authDoneAt When the sign-in check finished (performance.now()).
 * @returns The response (see POST()).
 * Called from: POST()
 */
async function respond(
  request: Request,
  session: AuthSession | null,
  startedAt: number,
  authDoneAt: number,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (!session) return jsonError(401, 'unauthorized', 'Sign in required');
  // A temporary password must be replaced before using the app (architecture §8.2).
  if (session.user.mustChangePassword) {
    return jsonError(401, 'unauthorized', 'Change your temporary password first');
  }

  // Size check before parsing (architecture §7.2: request ≤ 4 MB, as sent and unpacked). 1.5.1
  // (ADR-0069): large bodies arrive gzipped (server/requestBody.ts).
  const received = await readRequestText(request, MAX_REQUEST_BYTES);
  if (!received.ok) {
    return jsonError(
      400,
      'bad_request',
      received.reason === 'too-large' ? 'Request is larger than 4 MB' : 'Body is not valid gzip',
    );
  }
  const raw = received.text;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  const parsed = parseAnswerRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);
  // The rollback switch is for admins (ADR-0032): the setting is shown only to them, and this is
  // what enforces it. Anyone else gets the current rules whatever the request asked for.
  const data: AnswerRequest =
    session.user.role === 'admin' ? parsed.data : { ...parsed.data, styleVersion: undefined };

  const { mode } = data;

  // Ask Kite has no call to keep up with, so it defaults to the smart model (ADR-0030).
  const wanted: ModelTier = data.model ?? (mode === 'kite' ? 'smart' : 'fast');
  // A session's deeper model can be turned off by an admin (spec §6): its calls keep working on the
  // fast one. Ask AI's page has no per-session model. Reads the setting only for such a request.
  const tier: ModelTier =
    wanted === 'smart' && mode !== 'kite'
      ? allowedTier(wanted, await getDeepModelEnabled())
      : wanted;
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

  // The per-user daily limit (ADR-0036). Batch C (P1-2): counted at the same time as Claude is called
  // (one database round trip, 30–100 ms, no longer in front of Claude's first token). Over the limit, the
  // Claude request is stopped at once and the reply is the same 429 as before: no text is ever sent. Its
  // time is logged as msLimit.
  const counting = COUNTED_MODES.has(mode) ? countRequest(session.user.id) : null;
  // Stops Claude when the request is over the daily limit.
  const overLimit = new AbortController();

  // Stop Claude when the browser disconnects, the 60 s limit passes or the request is over the daily limit,
  // whichever comes first.
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
    overLimit.signal,
  ]);
  let streamOpenAt: number | null = null;
  const markOpen = () => {
    streamOpenAt ??= performance.now();
  };
  // Sizes only (never text), so the logs show how much context each answer carried.
  const context = {
    chunks: data.conversation?.length ?? 0,
    tailLines: data.tail?.length ?? 0,
    // The screenshot's size only (Day 5), never its content.
    imageChars: data.image?.length ?? 0,
    // How many approved lessons were sent (Day 5 Stage 7), never their text.
    lessons: data.lessons?.length ?? 0,
    // Batch C (P2-1): how many document parts went with the question, never their text.
    documentChunks: data.documentChunks?.length ?? 0,
    // Counts only for the Ask Kite page (ADR-0030), never their text.
    historyTurns: data.history?.length ?? 0,
    attachments: data.attachments?.length ?? 0,
    images: data.images?.length ?? 0,
    // Which answer rules were used: 'previous' only after an admin's rollback (ADR-0032).
    styleVersion: data.styleVersion ?? 'current',
    // How long the daily-limit check took (ADR-0036); null for modes that do not count (set below).
    msLimit: null as number | null,
  };
  let source: AsyncGenerator<ReplyItem, ReplyResult, undefined>;
  if (mode === 'warm') {
    source = warmReply(data, { model, tier, signal, onResponse: markOpen });
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
    // 'answer', 'chat' and 'screenshot': the three cached parts, then the uncached tail
    // (with the screenshot first for 'screenshot'; server/prompt.ts). 'kite': the Ask Kite page.
    // The SDK's single retry happens only before any text arrives (server/claude.ts).
    const prompt = mode === 'kite' ? buildKiteChatPrompt(data) : buildPrompt(data);
    // The hidden first line becomes its own event, so the first delta is the first real word.
    source = withAnswerMeta(
      streamReply({
        model,
        tier,
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: mode === 'kite' ? KITE_CHAT_MAX_TOKENS : ANSWER_MAX_TOKENS,
        signal,
        onStreamOpen: markOpen,
      }),
    );
  }

  if (counting) {
    // Batch C (P1-2): Claude's request starts now (the source's first read), while the count is checked.
    const primed = prime(source);
    const counted = await counting;
    context.msLimit = counted.ms;
    if (!counted.allowed) {
      overLimit.abort();
      primed.discard();
      console.info('answer: daily limit reached', {
        requestId,
        userId: session.user.id,
        mode,
        limit: counted.limit,
      });
      return jsonError(429, 'daily_limit', dailyLimitMessage(counted.limit));
    }
    source = primed.source;
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
