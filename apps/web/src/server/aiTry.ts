/**
 * File: apps/web/src/server/aiTry.ts
 * Purpose: Admin → AI settings, server side (ADR-0083): "Try it" runs one real request with a DRAFT of
 *          a block's company instructions (not saved), and (ADR-0086) optionally a draft of its full
 *          system prompt, the same way a call, the notes or Ask AI would, and returns the reply (with a
 *          token proving the prompt was tried); and the read-only facts the page shows: each block's
 *          built-in prompt, the heading the company text goes under, and the input-budget numbers for
 *          the live block.
 * Used by: app/api/admin/ai-instructions/try/route.ts (handleTry), app/(app)/admin/ai-settings/page.tsx
 *          (lockedRulesFor, budgetFacts)
 * Depends on: src/server/prompt.ts, src/server/notes.ts, src/server/kite-chat.ts, src/server/claude.ts,
 *             src/server/answer-meta.ts, src/server/budget.ts, src/server/prompts/company.ts,
 *             src/server/prompts/builtIn.ts (BUILT_IN_PROMPTS),
 *             src/server/validate.ts (parseAiTryRequest), src/server/usage.ts (the daily limit),
 *             @kite/shared (checkCustomPrompt)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md, ADR-0086-full-system-prompt-editing.md
 *
 * A try counts as one normal request against the daily limit (ADR-0036). Logs carry the block, sizes,
 * timings and token counts only: never the draft, the sample, the session, the reply or any id.
 */
import 'server-only';
import {
  CHARS_PER_TOKEN,
  checkCustomPrompt,
  CONVERSATION_CAP_TOKENS,
  dailyLimitMessage,
  describePromptProblems,
  MAX_ACTIVE_LESSONS,
  MAX_LESSON_CHARS,
  normalisePrompt,
  PROMPT_PART_TITLES,
  PROMPT_PARTS,
  type CustomPrompt,
  type PromptPartKey,
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
import { withAnswerMeta } from './answer-meta';
import {
  BUDGET_CHARS_PER_TOKEN,
  BUDGET_TOKENS,
  IMAGE_TOKENS,
  SESSION_BLOCK_MAX_CHARS,
} from './budget';
import { describeClaudeError, errorLogDetails, streamReply, type ReplyResult } from './claude';
import { buildKiteChatPrompt, KITE_CHAT_MAX_TOKENS } from './kite-chat';
import { generateCallNotes } from './notes';
import {
  ANSWER_MAX_TOKENS,
  buildPrompt,
  CALL_REMINDER,
  CORE_RULES,
  LESSONS_HEADING,
  SCREENSHOT_RULES,
  smartSessionBlock,
} from './prompt';
import { BUILT_IN_PROMPTS } from './prompts/builtIn';
import { COMPANY_HEADINGS, normaliseInstructions } from './prompts/company';
import { parseAiTryRequest } from './validate';

/** One part of a block's built-in prompt, as the page shows it. */
export interface LockedPart {
  /** Which part (ADR-0086: the key a custom prompt uses for it). */
  key: PromptPartKey;
  /** What this part is, for example "Rules for every live answer". */
  title: string;
  /** The exact text sent to Claude. */
  text: string;
}

/**
 * The built-in prompt of a block: the text that comes first in its requests (the answer format the
 * app reads, honesty, privacy and safety rules). Simple mode shows it read-only; advanced mode starts
 * editing from it (ADR-0086).
 *
 * @param block The block.
 * @returns Its parts, in prompt order.
 * Called from: app/(app)/admin/ai-settings/page.tsx; tests
 */
export function lockedRulesFor(block: AiInstructionBlock): LockedPart[] {
  return PROMPT_PARTS[block].map((key) => ({
    key,
    title: PROMPT_PART_TITLES[key],
    text: BUILT_IN_PROMPTS[block][key] ?? '',
  }));
}

/** The numbers the page needs to show the live block's input-budget check (answerBudgetUse()). */
export interface BudgetFacts {
  /** The largest live-answer request without company instructions, tokens. */
  baseTokens: number;
  /** The budget a request must fit in, tokens. */
  budgetTokens: number;
  /** Characters a token, as the server counts. */
  charsPerToken: number;
  /** The characters the live block's heading adds when the block is not empty. */
  overheadChars: number;
  /** ADR-0086: the built-in live prompt's length (all three parts), to count a custom one against. */
  builtInPromptChars: number;
}

/**
 * The live block's budget facts. The largest request is counted the way server/budget.ts counts
 * (BUDGET_CHARS_PER_TOKEN characters a token): the locked rules with the most lessons, the session
 * block at its ceiling, the conversation at its cap, the reminder, the screenshot rules and a
 * screenshot. The lines that may still change and the question come on top, and the budget's own
 * step (dropping the oldest parts) still keeps any request within the limit.
 *
 * @returns See BudgetFacts.
 * Called from: app/(app)/admin/ai-settings/page.tsx; tests
 */
export function budgetFacts(): BudgetFacts {
  const lessonsChars = LESSONS_HEADING.length + MAX_ACTIVE_LESSONS * (MAX_LESSON_CHARS + 3);
  const chars =
    CORE_RULES.length +
    lessonsChars +
    SESSION_BLOCK_MAX_CHARS +
    CONVERSATION_CAP_TOKENS * CHARS_PER_TOKEN +
    CALL_REMINDER.length +
    SCREENSHOT_RULES.length;
  return {
    baseTokens: Math.ceil(chars / BUDGET_CHARS_PER_TOKEN) + IMAGE_TOKENS,
    budgetTokens: BUDGET_TOKENS,
    charsPerToken: BUDGET_CHARS_PER_TOKEN,
    // The heading, a new line after it, and the blank line before it.
    overheadChars: COMPANY_HEADINGS.live.length + 3,
    builtInPromptChars: CORE_RULES.length + CALL_REMINDER.length + SCREENSHOT_RULES.length,
  };
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

/** A try's reply and its token usage. */
export interface TryResult {
  /** What the page shows. */
  response: AiTryResponse;
  /** Token counts (logged). */
  usage: AnswerUsage;
  /** The model used (logged). */
  model: string;
}

/**
 * Streams a reply to its end and returns the answer text and the hidden first line.
 *
 * @param source The reply, wrapped by withAnswerMeta().
 * @returns The text (hidden lines removed), the meta, and the usage.
 * Called from: runTry()
 */
async function collect(
  source: AsyncGenerator<string | { meta: AnswerMeta } | { question: string }, ReplyResult>,
): Promise<{ text: string; meta: AnswerMeta | null; usage: AnswerUsage }> {
  let text = '';
  let meta: AnswerMeta | null = null;
  for (;;) {
    const next = await source.next();
    if (next.done) return { text: text.trim(), meta, usage: next.value.usage };
    const item = next.value;
    if (typeof item === 'string') text += item;
    else if ('meta' in item) meta = item.meta;
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
 * @returns The reply, usage and model.
 * @throws What the Claude calls throw (the handler turns it into a status).
 * Called from: handleTry(); tests
 */
export async function runTry(
  request: AiTryRequest,
  models: TryModels,
  signal?: AbortSignal,
): Promise<TryResult> {
  const draft = normaliseInstructions(request.draft);
  // ADR-0086: the draft full prompt (handleTry() has checked it), or null for the built-in prompt.
  const custom = request.prompt ? normalisePrompt(request.block, request.prompt) : null;
  const session = request.session ?? BLANK_SESSION;
  if (request.block === 'notes') {
    const { notes, usage } = await generateCallNotes(
      { session, lines: parseSampleCall(request.sample), answers: [] },
      models.smart,
      draft,
      custom?.rules,
    );
    return { response: { kind: 'notes', notes }, usage, model: models.smart };
  }
  if (request.block === 'live') {
    const answer: AnswerRequest = { mode: 'answer', session, question: request.sample.trim() };
    const prompt = buildPrompt(answer, draft, custom);
    const tier: ModelTier = 'fast';
    const reply = await collect(
      withAnswerMeta(
        streamReply({
          model: models.fast,
          tier,
          system: prompt.system,
          messages: prompt.messages,
          maxTokens: ANSWER_MAX_TOKENS,
          ...(signal ? { signal } : {}),
        }),
      ),
    );
    return {
      response: { kind: 'answer', text: reply.text, meta: reply.meta },
      usage: reply.usage,
      model: models.fast,
    };
  }
  const chat: AnswerRequest = {
    mode: 'kite',
    question: request.sample.trim(),
    ...(request.session
      ? { attachments: [{ name: 'Session', text: smartSessionBlock(request.session) }] }
      : {}),
  };
  const prompt = buildKiteChatPrompt(chat, draft, custom?.chat);
  const reply = await collect(
    withAnswerMeta(
      streamReply({
        model: models.smart,
        tier: 'smart',
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: KITE_CHAT_MAX_TOKENS,
        ...(signal ? { signal } : {}),
      }),
    ),
  );
  return {
    response: { kind: 'answer', text: reply.text, meta: reply.meta },
    usage: reply.usage,
    model: models.smart,
  };
}

/** The signed-in account, as the try handler needs it. */
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
  /** ADR-0086: the token proving a prompt was tried (server/promptTryToken.ts promptTryToken()). */
  tokenFor: (block: AiInstructionBlock, prompt: CustomPrompt) => string;
}

/**
 * Builds a JSON error.
 *
 * @param status  HTTP status.
 * @param code    Machine-readable reason.
 * @param message Short explanation (never request content).
 * @returns The response.
 * Called from: handleTry()
 */
function jsonError(status: number, code: AnswerErrorCode, message: string): Response {
  return Response.json({ code, message }, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * POST /api/admin/ai-instructions/try, after the session read: admins only (403 for anyone else,
 * before the body is read), a valid body, the daily limit, then one Claude request.
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
  if (!user) return jsonError(401, 'unauthorized', 'Sign in required');
  if (user.mustChangePassword) {
    return jsonError(401, 'unauthorized', 'Change your temporary password first');
  }
  if (user.role !== 'admin') return jsonError(403, 'unauthorized', 'Admins only');
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  const parsed = parseAiTryRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);
  // ADR-0086: a draft prompt that misses the output format is refused before any request is spent.
  const draftPrompt = parsed.data.prompt;
  if (draftPrompt) {
    const problems = checkCustomPrompt(parsed.data.block, draftPrompt);
    if (problems.length > 0) {
      return jsonError(400, 'bad_request', describePromptProblems(problems));
    }
  }
  let models: TryModels;
  // Worked out before the request is spent, so missing settings never waste one.
  let promptToken: string | null = null;
  try {
    models = deps.models();
    if (draftPrompt) promptToken = deps.tokenFor(parsed.data.block, draftPrompt);
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }
  const counted = await deps.count(user.id);
  if (!counted.allowed) return jsonError(429, 'daily_limit', dailyLimitMessage(counted.limit));
  // Sizes only, never text.
  const sizes = {
    block: parsed.data.block,
    draftChars: parsed.data.draft.length,
    sampleChars: parsed.data.sample.length,
    session: parsed.data.session ? true : false,
    // ADR-0086: whether a draft prompt was tried, and its size (never its text).
    promptChars: draftPrompt
      ? Object.values(draftPrompt).reduce((total, part) => total + (part ?? '').length, 0)
      : 0,
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
    // ADR-0086: the proof that this exact prompt was tried; saving it requires it.
    const response: AiTryResponse = promptToken
      ? { ...result.response, promptToken }
      : result.response;
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
