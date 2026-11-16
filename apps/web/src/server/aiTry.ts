/**
 * File: apps/web/src/server/aiTry.ts
 * Purpose: Admin → AI settings, server side (ADR-0083, ADR-0089): "Try it" runs one real request with a
 *          DRAFT of a tab's global prompt (not saved), the same way a call, the notes or Ask AI would,
 *          and returns the reply with a token proving this exact draft was tried (Save requires it).
 *          Also the input-budget facts the page shows next to the live answers prompt.
 * Used by: app/api/admin/ai-instructions/try/route.ts (handleTry), app/(app)/admin/ai-settings/page.tsx
 *          (budgetFacts), src/server/aiQuality.ts (collectReply, BLANK_SESSION)
 * Depends on: src/server/prompt.ts, src/server/notes.ts, src/server/kite-chat.ts, src/server/claude.ts,
 *             src/server/answer-meta.ts, src/server/budget.ts, src/server/prompts/contract.ts,
 *             src/server/validate.ts (parseAiTryRequest), @kite/shared
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 *
 * A try counts as one normal request against the daily limit (ADR-0036). Logs carry the tab, sizes,
 * timings and token counts only: never the draft, the sample, the session, the reply or any id.
 */
import 'server-only';
import {
  CHARS_PER_TOKEN,
  CONVERSATION_CAP_TOKENS,
  dailyLimitMessage,
  MAX_ACTIVE_LESSONS,
  MAX_LESSON_CHARS,
  normaliseGlobalPrompt,
  type AiInstructionBlock,
  type AiTryRequest,
  type AiTryResponse,
  type AnswerErrorCode,
  type AnswerMeta,
  type AnswerRequest,
  type AnswerUsage,
  type CallLine,
  type ModelTier,
  type SessionContext,
} from '@kite/shared';
import { withAnswerMeta, type ReplyItem } from './answer-meta';
import {
  BUDGET_CHARS_PER_TOKEN,
  BUDGET_TOKENS,
  IMAGE_TOKENS,
  SESSION_BLOCK_MAX_CHARS,
} from './budget';
import { describeClaudeError, errorLogDetails, streamReply, type ReplyResult } from './claude';
import { buildKiteChatPrompt, KITE_CHAT_MAX_TOKENS } from './kite-chat';
import { generateCallNotes } from './notes';
import { ANSWER_MAX_TOKENS, buildPrompt, LEARNED_HEADING, smartSessionBlock } from './prompt';
import {
  GLOBAL_HEADING,
  LIVE_CONTRACT,
  liveEndReminder,
  SCREENSHOT_TAIL,
} from './prompts/contract';
import { parseAiTryRequest } from './validate';

/** The numbers the page needs for the live answers input-budget check (answerBudgetUse()). */
export interface BudgetFacts {
  /** The largest live-answer request without a global prompt, tokens. */
  baseTokens: number;
  /** The budget a request must fit in, tokens. */
  budgetTokens: number;
  /** Characters a token, as the server counts. */
  charsPerToken: number;
  /** The characters the global prompt's heading adds (with the blank line before it). */
  headingChars: number;
}

/** The session used when the admin tries a draft without picking one: every field left empty. */
export const BLANK_SESSION: SessionContext = {
  type: '',
  company: '',
  role: '',
  description: '',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [],
};

/**
 * The live answers budget facts. The largest request is counted the way server/budget.ts counts
 * (BUDGET_CHARS_PER_TOKEN characters a token): the contract, the session block at its ceiling with the
 * most lessons, the conversation at its cap, the end reminder, the screenshot text and a screenshot.
 * The budget's own step (dropping the oldest parts) still keeps any request within the limit.
 *
 * @returns See BudgetFacts.
 * Called from: app/(app)/admin/ai-settings/page.tsx; tests
 */
export function budgetFacts(): BudgetFacts {
  const lessonsChars = LEARNED_HEADING.length + MAX_ACTIVE_LESSONS * (MAX_LESSON_CHARS + 3);
  const chars =
    LIVE_CONTRACT.length +
    lessonsChars +
    SESSION_BLOCK_MAX_CHARS +
    CONVERSATION_CAP_TOKENS * CHARS_PER_TOKEN +
    liveEndReminder(BLANK_SESSION).length +
    SCREENSHOT_TAIL.length;
  return {
    baseTokens: Math.ceil(chars / BUDGET_CHARS_PER_TOKEN) + IMAGE_TOKENS,
    budgetTokens: BUDGET_TOKENS,
    charsPerToken: BUDGET_CHARS_PER_TOKEN,
    headingChars: GLOBAL_HEADING.length + 3,
  };
}

/** Seconds between the lines of a sample call (the notes need times; the sample has none). */
const SAMPLE_LINE_SECONDS = 20;

/**
 * Reads a sample call typed for the notes: one turn per line, "Them: …" or "You: …" (any case). A
 * line with no speaker continues the previous turn's speaker ("Them" for the first).
 *
 * @param sample The text.
 * @returns The lines, with invented times 20 s apart.
 * Called from: runTry(); tests
 */
export function parseSampleCall(sample: string): CallLine[] {
  const lines: CallLine[] = [];
  let speaker: CallLine['speaker'] = 'them';
  for (const raw of sample.split(/\r?\n/)) {
    const match = /^\s*(them|you)\s*:\s*(.*)$/i.exec(raw);
    const text = (match ? match[2]! : raw).trim();
    if (match) speaker = match[1]!.toLowerCase() === 'you' ? 'you' : 'them';
    if (text === '') continue;
    lines.push({ speaker, text, at: lines.length * SAMPLE_LINE_SECONDS });
  }
  return lines;
}

/** The models a try uses. */
export interface TryModels {
  /** The fast model (live answers). */
  fast: string;
  /** The smart model (notes, Ask AI). */
  smart: string;
}

/** A try's reply (without the token) and its token usage. */
export interface TryResult {
  /** What the page shows (the handler adds the token). */
  response: AiTryResponse;
  /** Token counts (logged). */
  usage: AnswerUsage;
  /** The model used (logged). */
  model: string;
}

/** A whole reply, read to its end. */
export interface CollectedReply {
  /** The answer text, hidden lines removed. */
  text: string;
  /** What the hidden first line said, or null when the reply had none. */
  meta: AnswerMeta | null;
  /** The question from the hidden last line, or null when the reply had none. */
  question: string | null;
  /** Token counts. */
  usage: AnswerUsage;
}

/**
 * Streams a reply to its end and returns the answer text and what the hidden lines said.
 *
 * @param source The reply, wrapped by withAnswerMeta().
 * @returns The text (hidden lines removed), the meta, the question and the usage.
 * Called from: runTry(); src/server/aiQuality.ts
 */
export async function collectReply(
  source: AsyncGenerator<ReplyItem, ReplyResult>,
): Promise<CollectedReply> {
  let text = '';
  let meta: AnswerMeta | null = null;
  let question: string | null = null;
  for (;;) {
    const next = await source.next();
    if (next.done) return { text: text.trim(), meta, question, usage: next.value.usage };
    const item = next.value;
    if (typeof item === 'string') text += item;
    else if ('meta' in item) meta = item.meta;
    else question = item.question;
  }
}

/**
 * Runs one try with the draft: a live answer to the sample question (the fast model, the call's
 * prompt), the notes of the sample call (the smart model), or an Ask AI reply (the smart model, the
 * Ask AI page's prompt, with the session attached when one was picked).
 *
 * @param request A validated try request.
 * @param models  The model names.
 * @param signal  Stops the request (time limit or the admin left).
 * @returns The reply (its token is added by handleTry()), usage and model.
 * @throws What the Claude calls throw (the handler turns it into a status).
 * Called from: handleTry(); tests
 */
export async function runTry(
  request: AiTryRequest,
  models: TryModels,
  signal?: AbortSignal,
): Promise<TryResult> {
  const draft = normaliseGlobalPrompt(request.prompt);
  const session = request.session ?? BLANK_SESSION;
  if (request.block === 'notes') {
    const { notes, usage } = await generateCallNotes(
      { session, lines: parseSampleCall(request.sample), answers: [] },
      models.smart,
      draft,
    );
    return { response: { kind: 'notes', notes, promptToken: '' }, usage, model: models.smart };
  }
  const live = request.block === 'live';
  const prompt = live
    ? buildPrompt({ mode: 'answer', session, question: request.sample.trim() }, draft)
    : buildKiteChatPrompt(
        {
          mode: 'kite',
          question: request.sample.trim(),
          ...(request.session
            ? { attachments: [{ name: 'Session', text: smartSessionBlock(request.session) }] }
            : {}),
        } satisfies AnswerRequest,
        draft,
      );
  const tier: ModelTier = live ? 'fast' : 'smart';
  const model = live ? models.fast : models.smart;
  const reply = await collectReply(
    withAnswerMeta(
      streamReply({
        model,
        tier,
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: live ? ANSWER_MAX_TOKENS : KITE_CHAT_MAX_TOKENS,
        ...(signal ? { signal } : {}),
      }),
    ),
  );
  return {
    response: {
      kind: 'answer',
      text: reply.text,
      meta: reply.meta,
      question: reply.question,
      promptToken: '',
    },
    usage: reply.usage,
    model,
  };
}

/** The signed-in account, as the admin handlers need it. */
export interface TryUser {
  /** The account's id (for the daily limit). */
  id: string;
  /** 'admin' or 'user'. */
  role?: string | null;
  /** True while a temporary password must still be changed. */
  mustChangePassword: boolean;
}

/** What handleTry() needs from outside (tests replace them). */
export interface TryDeps {
  /** The model names; throws when Claude is not configured. */
  models: () => TryModels;
  /** Counts one request against the daily limit (ADR-0036). */
  count: (userId: string) => Promise<{ allowed: boolean; limit: number }>;
  /** Runs the try (runTry()). */
  run: (request: AiTryRequest, models: TryModels, signal: AbortSignal) => Promise<TryResult>;
  /** The token proving a draft was tried (server/promptTryToken.ts promptTryToken()). */
  tokenFor: (block: AiInstructionBlock, prompt: string) => string;
}

/**
 * Builds a JSON error.
 *
 * @param status  HTTP status.
 * @param code    Machine-readable reason.
 * @param message Short explanation (never request content).
 * @returns The response.
 * Called from: handleTry(); src/server/aiQuality.ts
 */
export function jsonError(status: number, code: AnswerErrorCode, message: string): Response {
  return Response.json({ code, message }, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * The first checks of every admin AI settings route: signed in (401), password changed (401), an admin
 * (403). Run before the body is read.
 *
 * @param user The signed-in account, or null.
 * @returns The error response, or null when the caller may go on.
 * Called from: handleTry(); handleQualityCheck() in src/server/aiQuality.ts
 */
export function adminRefusal(user: TryUser | null): Response | null {
  if (!user) return jsonError(401, 'unauthorized', 'Sign in required');
  if (user.mustChangePassword) {
    return jsonError(401, 'unauthorized', 'Change your temporary password first');
  }
  if (user.role !== 'admin') return jsonError(403, 'unauthorized', 'Admins only');
  return null;
}

/**
 * POST /api/admin/ai-instructions/try, after the session read: admins only (401/403 before the body is
 * read), a valid body, the daily limit, then one Claude request.
 *
 * @param user   The signed-in account, or null.
 * @param body   The raw request text.
 * @param deps   See TryDeps.
 * @param signal Stops the Claude request (the admin left, or the route's time limit).
 * @returns 200 with the AiTryResponse; 401, 403, 400, 429, 500, 502, 503 or 504 with { code, message }.
 * Called from: POST in app/api/admin/ai-instructions/try/route.ts; tests
 */
export async function handleTry(
  user: TryUser | null,
  body: string,
  deps: TryDeps,
  signal: AbortSignal,
): Promise<Response> {
  const startedAt = performance.now();
  const refused = adminRefusal(user);
  if (refused || !user) return refused ?? jsonError(401, 'unauthorized', 'Sign in required');
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  const parsed = parseAiTryRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);
  let models: TryModels;
  // Worked out before the request is spent, so missing settings never waste one.
  let promptToken: string;
  try {
    models = deps.models();
    promptToken = deps.tokenFor(parsed.data.block, parsed.data.prompt);
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }
  const counted = await deps.count(user.id);
  if (!counted.allowed) return jsonError(429, 'daily_limit', dailyLimitMessage(counted.limit));
  // Sizes only, never text.
  const sizes = {
    block: parsed.data.block,
    promptChars: parsed.data.prompt.length,
    sampleChars: parsed.data.sample.length,
    session: parsed.data.session ? true : false,
  };
  try {
    const result = await deps.run(parsed.data, models, signal);
    // No account or version ids, and no text (ADR-0083).
    console.info('ai try: done', {
      ...sizes,
      model: result.model,
      usage: result.usage,
      ms: Math.round(performance.now() - startedAt),
    });
    // The proof that this exact draft was tried; saving it requires it.
    const response: AiTryResponse = { ...result.response, promptToken };
    return Response.json(response, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const described = describeClaudeError(error);
    console.error('ai try: failed', {
      ...sizes,
      code: described.code,
      ...errorLogDetails(error),
      ms: Math.round(performance.now() - startedAt),
    });
    const status =
      described.code === 'timeout' ? 504 : described.code === 'claude_unavailable' ? 503 : 502;
    return jsonError(status, described.code, described.message);
  }
}
