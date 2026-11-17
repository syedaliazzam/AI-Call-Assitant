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
 *             src/server/usage.ts (the daily limit, ADR-0036), src/server/aiInstructions.ts (the admin's
 *             global prompt, ADR-0089, from the call's pinned version, ADR-0083)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6 (answer flow), §7.2 (/api/answer);
 *               day-04-answers.md Stage 3; ADR-0095 (Groq as a third answer model, with Claude Haiku as
 *               its fallback: src/server/groq.ts); ADR-0099 (Google's Gemini and OpenAI as answer models for
 *               the accounts in the rollout, screenshots included, with the same Claude Haiku fallback:
 *               src/server/gemini.ts, src/server/openai.ts, src/server/providerStream.ts)
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
  AnswerModel,
  AnswerProvider,
  AnswerRequest,
  AnswerTimings,
  ModelTier,
} from '@kite/shared';
import { dailyLimitMessage, providerOf } from '@kite/shared';
import { getCachedSession, type AuthSession } from '@/server/auth';
import {
  CLAUDE_TIMEOUT_MS,
  describeClaudeError,
  errorLogDetails,
  streamReply,
  warmCache,
  type ReplyResult,
} from '@/server/claude';
import {
  withAnswerMeta,
  withContractFallback,
  type ContractStats,
  type ReplyItem,
} from '@/server/answer-meta';
import { getClaudeEnv, getGeminiEnv, getGroqEnv, getOpenAIEnv } from '@/server/env';
import { streamGeminiReply, warmGemini } from '@/server/gemini';
import { streamGroqReply } from '@/server/groq';
import { streamOpenAIReply, warmOpenAI } from '@/server/openai';
import {
  FIRST_TOKEN_MS,
  ProviderError,
  withFirstTokenFallback,
  type FallbackReason,
} from '@/server/providerStream';
import { buildKiteChatPrompt, KITE_CHAT_MAX_TOKENS } from '@/server/kite-chat';
import { companySettings, type BlockSettings } from '@/server/aiInstructions';
import { ANSWER_MAX_TOKENS, buildPrompt } from '@/server/prompt';
import { HELLO_MAX_TOKENS, HELLO_MESSAGES, HELLO_SYSTEM } from '@/server/prompts/hello';
import { SSE_HEADERS, toEventStream } from '@/server/sse';
import {
  allowedModel,
  getDeepModelEnabled,
  getGroqEnabled,
  getProviderEnabled,
} from '@/server/modelAccess';
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
  /** The global prompt the answers of this call use (ADR-0089), so the warm-up writes their cache. */
  company: BlockSettings;
  /**
   * ADR-0099: the Gemini or OpenAI model the session uses, warmed together with Claude Haiku (its fallback,
   * which the warm-up warms as before). Absent or null: Claude only.
   */
  thirdParty?: ThirdParty | null;
  /** ADR-0099: the call's id, OpenAI's prompt_cache_key. */
  cacheKey?: string | undefined;
  /** ADR-0099 measurement only: OpenAI priority processing (admins, /dev/latency). */
  serviceTier?: 'priority' | undefined;
  /** ADR-0099: the request's id, for the provider warm-up's log line. */
  requestId: string;
}

/** ADR-0095 and ADR-0099: the third-party model a request is sent to, with its key (never logged). */
interface ThirdParty {
  /** Who serves it. */
  provider: Exclude<AnswerProvider, 'claude'>;
  /** The provider's API key. */
  apiKey: string;
  /** The model id, for example 'gemini-3.5-flash-lite'. */
  model: string;
}

/**
 * ADR-0095 and ADR-0099: whether a request goes to a third-party model, and which. Groq answers text questions
 * only ('answer' and 'chat' without an image); Gemini and OpenAI answer those, screenshots (any request with
 * an image) and warm-ups. Everything else (the hello test, Ask AI) stays on Claude.
 *
 * @param chosen The model the request may use (after the switches).
 * @param mode   The request's mode.
 * @param image  True when the request carries a screenshot.
 * @returns The provider, key and model id, or null for Claude.
 * Called from: respond()
 */
function thirdPartyFor(
  chosen: AnswerModel,
  mode: AnswerRequest['mode'],
  image: boolean,
): ThirdParty | null {
  const provider = providerOf(chosen);
  if (provider === 'groq') {
    if ((mode !== 'answer' && mode !== 'chat') || image) return null;
    const env = getGroqEnv();
    return env ? { provider, apiKey: env.apiKey, model: env.model } : null;
  }
  if (provider === 'gemini' || provider === 'openai') {
    if (mode !== 'answer' && mode !== 'chat' && mode !== 'screenshot' && mode !== 'warm') {
      return null;
    }
    const env = provider === 'gemini' ? getGeminiEnv() : getOpenAIEnv();
    if (!env) return null;
    const smarter = chosen === 'gemini-flash' || chosen === 'gpt-terra';
    return { provider, apiKey: env.apiKey, model: smarter ? env.modelSmart : env.modelFast };
  }
  return null;
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
  const prompt = buildPrompt(request, options.company.globalPrompt);
  const claude = warmCache({
    model: options.model,
    tier: options.tier,
    system: prompt.system,
    messages: prompt.messages,
    signal: options.signal,
  });
  const third = options.thirdParty;
  if (!third || third.provider === 'groq') {
    const result = await claude;
    options.onResponse();
    return result;
  }
  // ADR-0099: the session's Gemini or GPT model is warmed at the same time as Claude Haiku (its fallback). One
  // token is asked for; its usage shows the cache.
  const input = {
    apiKey: third.apiKey,
    model: third.model,
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: 1,
    signal: options.signal,
    cacheKey: options.cacheKey,
    serviceTier: options.serviceTier,
  };
  const [claudeResult, thirdResult] = await Promise.allSettled([
    claude,
    third.provider === 'gemini' ? warmGemini(input) : warmOpenAI(input),
  ]);
  options.onResponse();
  // Ids, status and token counts only.
  console.info('answer: provider warm', {
    requestId: options.requestId,
    provider: third.provider,
    model: third.model,
    ok: thirdResult.status === 'fulfilled',
    ...(thirdResult.status === 'fulfilled'
      ? { usage: thirdResult.value.usage }
      : {
          status:
            thirdResult.reason instanceof ProviderError ? thirdResult.reason.status : undefined,
        }),
    claudeOk: claudeResult.status === 'fulfilled',
  });
  // The session's model's usage when it warmed; otherwise Claude's (or Claude's error).
  if (thirdResult.status === 'fulfilled') return thirdResult.value;
  if (claudeResult.status === 'fulfilled') return claudeResult.value;
  throw claudeResult.reason;
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
    session.user.role === 'admin'
      ? parsed.data
      : // ADR-0099: OpenAI priority processing is a measurement for admins too (/dev/latency).
        { ...parsed.data, styleVersion: undefined, serviceTier: undefined };

  const { mode } = data;
  // ADR-0089: the admin's global prompt (after the locked contract). Live answers (and their warm-ups)
  // use the version the call pinned when it started (ADR-0083), so its rules block, and so its prompt
  // cache, never change mid-call; Ask AI uses the version in force. Read from memory after the first
  // request (versions never change). The hello test sends no global prompt.
  const companyBlock = mode === 'kite' ? 'ask' : 'live';
  const companyRead: Promise<BlockSettings> =
    mode === 'hello'
      ? Promise.resolve({ globalPrompt: '', isDefault: true })
      : companySettings(
          companyBlock,
          companyBlock === 'live' ? data.instructionsVersion : undefined,
        );

  // Ask Kite has no call to keep up with, so it defaults to the smart model (ADR-0030). ADR-0095: Ask AI keeps
  // its Claude model, so a Groq request there is answered as Ask AI's default. ADR-0099: the same for the
  // Gemini and GPT models.
  const wanted: AnswerModel =
    mode === 'kite'
      ? data.model && providerOf(data.model) === 'claude'
        ? data.model
        : 'smart'
      : (data.model ?? 'fast');
  const wantedProvider = providerOf(wanted);
  // A session's deeper model, and Groq (ADR-0095), can be turned off by an admin (spec §6): its calls keep
  // working on the fast one. ADR-0099: Gemini and OpenAI too, and they are on only for the accounts in the
  // rollout, with the provider's key set. Ask AI's page has no per-session model. Reads a setting only for
  // such a request.
  const chosen: AnswerModel =
    mode === 'kite'
      ? wanted
      : allowedModel(wanted, {
          smart: wanted === 'smart' ? await getDeepModelEnabled() : true,
          groq: wantedProvider === 'groq' ? await getGroqEnabled() : false,
          gemini:
            wantedProvider === 'gemini'
              ? await getProviderEnabled('gemini', session.user.id)
              : false,
          openai:
            wantedProvider === 'openai'
              ? await getProviderEnabled('openai', session.user.id)
              : false,
        });
  // ADR-0095: Groq answers text questions only; screenshots and anything with an image, warm-ups and the hello
  // test use Claude (Haiku for a Groq session, which is also what a Groq answer falls back to, so the warm-up
  // writes the cache the fallback and the screenshots read). ADR-0099: Gemini and OpenAI answer screenshots
  // too, and a warm-up warms them with Claude Haiku. The user is shown nothing about it.
  const thirdParty = thirdPartyFor(chosen, mode, Boolean(data.image));
  const tier: ModelTier = chosen === 'smart' ? 'smart' : 'fast';
  // ADR-0095: why a third-party answer moved to Claude Haiku (null while it has not).
  let fallback: FallbackReason | null = null;
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
  // ADR-0095: a Groq answer is also counted as a Groq request (Admin → Usage). ADR-0099: Gemini and OpenAI the
  // same, each in its own column.
  const counting = COUNTED_MODES.has(mode)
    ? countRequest(session.user.id, undefined, { provider: thirdParty?.provider })
    : null;
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
    // ADR-0099 measurement only: OpenAI priority processing asked for (admins, /dev/latency).
    serviceTier: data.serviceTier ?? 'default',
    // How long the daily-limit check took (ADR-0036); null for modes that do not count (set below).
    msLimit: null as number | null,
    // ADR-0089: the global prompt's size, and whether it is the default (never its text or version id).
    globalPromptChars: 0,
    defaultPrompt: true,
  };
  // ADR-0089: what the contract fallback saw (flags and counts only), logged with the request.
  const contract: ContractStats = { missingMeta: false, missingQuestion: false, strippedTags: 0 };
  const company = await companyRead;
  context.globalPromptChars = company.globalPrompt.length;
  context.defaultPrompt = company.isDefault;
  let source: AsyncGenerator<ReplyItem, ReplyResult, undefined>;
  if (mode === 'warm') {
    source = warmReply(data, {
      model,
      tier,
      signal,
      onResponse: markOpen,
      company,
      thirdParty,
      cacheKey: data.callId,
      serviceTier: data.serviceTier,
      requestId,
    });
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
    const prompt =
      mode === 'kite'
        ? buildKiteChatPrompt(data, company.globalPrompt)
        : buildPrompt(data, company.globalPrompt);
    const maxTokens = mode === 'kite' ? KITE_CHAT_MAX_TOKENS : ANSWER_MAX_TOKENS;
    // The answer from Claude (the session's tier; Haiku for a Groq session).
    const claudeReply = () =>
      streamReply({
        model,
        tier,
        system: prompt.system,
        messages: prompt.messages,
        maxTokens,
        signal,
        onStreamOpen: markOpen,
      });
    // ADR-0095: Groq gets the same prompt (locked contract, global prompt, preferences, end reminder). When it
    // fails or sends no first token within 4 s, the same answer is asked of Claude Haiku, and that is recorded.
    // ADR-0099: Gemini and OpenAI the same (with the screenshot when there is one).
    const third = thirdParty;
    const reply = third
      ? withFirstTokenFallback(
          (stop) => {
            const input = {
              apiKey: third.apiKey,
              model: third.model,
              system: prompt.system,
              messages: prompt.messages,
              maxTokens,
              signal: AbortSignal.any([signal, stop]),
              onStreamOpen: markOpen,
            };
            if (third.provider === 'gemini') return streamGeminiReply(input);
            if (third.provider === 'openai') {
              return streamOpenAIReply({
                ...input,
                cacheKey: data.callId,
                serviceTier: data.serviceTier,
              });
            }
            return streamGroqReply(input);
          },
          () => {
            // The timings then describe Claude's stream, the one that answered.
            streamOpenAt = null;
            return claudeReply();
          },
          {
            firstTokenMs: FIRST_TOKEN_MS,
            signal,
            onFallback: (reason, error) => {
              fallback = reason;
              // Ids, the reason and the provider's HTTP status only.
              console.warn(`answer: ${third.provider} fallback to haiku`, {
                requestId,
                userId: session.user.id,
                mode,
                provider: third.provider,
                model: third.model,
                reason,
                status: error instanceof ProviderError ? error.status : undefined,
                error: error instanceof Error ? error.name : undefined,
              });
            },
          },
        )
      : claudeReply();
    // The hidden first line becomes its own event, so the first delta is the first real word.
    // ADR-0089: a reply that breaks the contract still shows cleanly: the default type when the hidden
    // first line is missing, stray tags taken out; the counts go in this request's log line. ADR-0095: the
    // same for a Groq reply.
    source = withContractFallback(
      withAnswerMeta(reply),
      {
        type: 'other',
        target: mode === 'kite' || data.target === 'kite' ? 'kite' : 'call',
        source: 'general',
      },
      contract,
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
      // ADR-0095: the model that really answered (Groq, or Claude after a fallback or for an image). ADR-0099:
      // the Gemini or GPT model the same way (a warm-up reports the session's model it warmed).
      const answeredBy: AnswerModel = thirdParty && fallback === null ? chosen : tier;
      console.info('answer: done', {
        requestId,
        userId: session.user.id,
        mode,
        model: thirdParty && fallback === null ? thirdParty.model : model,
        answerModel: answeredBy,
        ...(fallback ? { fallback } : {}),
        ...context,
        ...(mode === 'warm' || mode === 'hello' ? {} : { contract }),
        stopReason: result.stopReason,
        ms,
        usage: result.usage,
      });
      if (result.stopReason === 'refusal') {
        return { type: 'error', code: 'refused', message: 'Claude declined to answer this.' };
      }
      // ADR-0094: the tier used (after the admin's switch), so the browser records what really answered.
      // ADR-0095: 'groq' when Groq answered, with the fallback's reason when Claude Haiku did instead.
      return {
        type: 'done',
        usage: result.usage,
        ms,
        model: answeredBy,
        ...(fallback ? { fallback } : {}),
      };
    },
    onError: (error): AnswerEvent => {
      // ADR-0095: an error after Groq's first words (no fallback then: they were already shown).
      // ADR-0099: the same for Gemini and OpenAI.
      const described =
        error instanceof ProviderError
          ? { code: 'upstream_error' as const, message: 'The answer model returned an error.' }
          : describeClaudeError(error);
      console.error('answer: failed', {
        requestId,
        userId: session.user.id,
        mode,
        model: thirdParty && fallback === null ? thirdParty.model : model,
        ...(thirdParty ? { answerModel: fallback === null ? chosen : 'fast' } : {}),
        ...(fallback ? { fallback } : {}),
        ...context,
        ...(mode === 'warm' || mode === 'hello' ? {} : { contract }),
        code: described.code,
        ...(error instanceof ProviderError ? { status: error.status } : errorLogDetails(error)),
        msAuth: elapsed(startedAt, authDoneAt),
        msToStreamOpen: streamOpenAt === null ? null : elapsed(startedAt, streamOpenAt),
        msElapsed: elapsed(startedAt, performance.now()),
      });
      return { type: 'error', ...described };
    },
  });

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
