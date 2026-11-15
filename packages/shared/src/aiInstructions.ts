/**
 * File: packages/shared/src/aiInstructions.ts
 * Purpose: Shared names, limits and request shapes for the company AI instructions (ADR-0083): the
 *          three editable blocks (live answers, AI notes, Ask AI), the 4,000-character limit, the
 *          per-call version pin, the "Try it" request and reply, and the input-budget check the
 *          Admin → AI settings page shows next to the live-answers block.
 * Used by: apps/web/src/server/aiInstructions.ts, apps/web/src/server/aiTry.ts,
 *          apps/web/src/server/validate.ts, apps/web/src/core/answer/instructionsPin.ts,
 *          apps/web/src/core/admin/aiTry.ts, apps/web/src/features/admin/ai-settings/*
 * Depends on: ./api.ts (SessionContext, AnswerMeta types through answer-meta.ts), ./notes.ts (CallNotes)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 *
 * The instructions' text is company content: it goes into prompts only, never into a log.
 */
import type { AnswerMeta } from './answer-meta';
import type { SessionContext } from './api';
import type { CallNotes } from './notes';

/**
 * The editable blocks, one per kind of Claude request:
 * - 'live': live answers during a call (the fast model; also its private answers and screenshots);
 * - 'notes': the AI notes written after a call (the smart model);
 * - 'ask': Ask AI (the Ask AI page, and Ask AI in a session's review).
 */
export const AI_INSTRUCTION_BLOCKS = ['live', 'notes', 'ask'] as const;

/** One of the editable blocks (see AI_INSTRUCTION_BLOCKS). */
export type AiInstructionBlock = (typeof AI_INSTRUCTION_BLOCKS)[number];

/** Most characters one block may hold (the page's counter and the server's check). */
export const MAX_AI_INSTRUCTIONS_CHARS = 4_000;

/**
 * The pin value meaning "this call started with no company instructions for this block". A real pin
 * is a version id (a UUID); a request with no pin at all uses the block's version in force now.
 */
export const AI_INSTRUCTIONS_NONE = 'none';

/** Matches a valid pin: a version id (UUID) or AI_INSTRUCTIONS_NONE. */
export const AI_INSTRUCTIONS_PIN_PATTERN =
  /^(?:none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * The versions in force when a call started (GET /api/ai-instructions/pin). The call sends them with
 * every request, so an admin's save during the call changes nothing for it: its prompt, and so its
 * prompt cache, stay the same until it ends. Ids only, never text.
 */
export interface InstructionsPin {
  /** The live-answers version id, or AI_INSTRUCTIONS_NONE when the block was empty. */
  live: string;
  /** The AI-notes version id, or AI_INSTRUCTIONS_NONE when the block was empty. */
  notes: string;
}

/** Body of POST /api/admin/ai-instructions/try (admins only). */
export interface AiTryRequest {
  /** Which block the draft is for. */
  block: AiInstructionBlock;
  /** The draft text (not saved), at most MAX_AI_INSTRUCTIONS_CHARS characters; '' tries "no instructions". */
  draft: string;
  /**
   * 'live' and 'ask': the sample question. 'notes': a short sample call, one line per turn, each
   * starting "Them:" or "You:".
   */
  sample: string;
  /** A session for context (its details and documents), or absent for none. */
  session?: SessionContext;
}

/** Reply of a "Try it" for 'live' or 'ask': the answer as the user would see it. */
export interface AiTryAnswer {
  /** Which kind of reply this is. */
  kind: 'answer';
  /** The answer text, without the hidden lines. */
  text: string;
  /** What the hidden first line said (question type, who it is for, source), or null. */
  meta: AnswerMeta | null;
}

/** Reply of a "Try it" for 'notes': the notes as they would be saved. */
export interface AiTryNotes {
  /** Which kind of reply this is. */
  kind: 'notes';
  /** The notes. */
  notes: CallNotes;
}

/** Reply of POST /api/admin/ai-instructions/try. */
export type AiTryResponse = AiTryAnswer | AiTryNotes;

/** The share of the input budget above which the page warns (0.9 = 90 %). */
export const AI_BUDGET_WARN_SHARE = 0.9;

/** What answerBudgetUse() works out. */
export interface AnswerBudgetUse {
  /** About how many input tokens the block adds to every live-answer request. */
  blockTokens: number;
  /** The largest live-answer request, counted conservatively, with this block. */
  largestTokens: number;
  /** The budget a request must fit in, tokens. */
  budgetTokens: number;
  /** largestTokens / budgetTokens. */
  share: number;
  /** True when the largest request is at or above AI_BUDGET_WARN_SHARE of the budget. */
  near: boolean;
}

/**
 * Works out how close a live-answers block brings the largest answer request to the input budget.
 * The server counts every prompt at `charsPerToken` characters a token (server/budget.ts), so this
 * uses the same rule.
 *
 * @param input.baseTokens    The largest request without a company block (server/aiInstructions.ts
 *                            answerBudgetBase(): rules, the session block at its ceiling, the
 *                            conversation at its cap, a screenshot).
 * @param input.budgetTokens  The budget (server/budget.ts BUDGET_TOKENS).
 * @param input.charsPerToken Characters a token (server/budget.ts BUDGET_CHARS_PER_TOKEN).
 * @param input.overheadChars The fixed heading the block adds when it is not empty.
 * @param input.chars         The block's length in characters (0 adds nothing).
 * @returns See AnswerBudgetUse.
 * Called from: features/admin/ai-settings/InstructionsEditor.tsx; tests
 */
export function answerBudgetUse(input: {
  baseTokens: number;
  budgetTokens: number;
  charsPerToken: number;
  overheadChars: number;
  chars: number;
}): AnswerBudgetUse {
  const blockTokens =
    input.chars > 0 ? Math.ceil((input.chars + input.overheadChars) / input.charsPerToken) : 0;
  const largestTokens = input.baseTokens + blockTokens;
  const share = input.budgetTokens > 0 ? largestTokens / input.budgetTokens : 1;
  return {
    blockTokens,
    largestTokens,
    budgetTokens: input.budgetTokens,
    share,
    near: share >= AI_BUDGET_WARN_SHARE,
  };
}
