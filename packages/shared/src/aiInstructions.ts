/**
 * File: packages/shared/src/aiInstructions.ts
 * Purpose: Shared names, limits and request shapes for Admin → AI settings (ADR-0083, redesigned in
 *          ADR-0089): the three tabs (live answers, AI notes, Ask AI), each with ONE admin-edited global
 *          prompt sent after the app's locked contract; the per-call version pin; the lint hint for text
 *          that tries to set layout or personal preferences (a hint only: it never blocks Save,
 *          ADR-0091); and the input-budget check shown next to the live answers prompt.
 * Used by: apps/web/src/server/aiInstructions.ts, apps/web/src/server/aiBudget.ts,
 *          apps/web/src/server/validate.ts, apps/web/src/core/answer/instructionsPin.ts,
 *          apps/web/src/features/admin/ai-settings/*
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0089-global-prompts-with-locked-contract.md,
 *               docs/decisions/ADR-0091-simpler-ai-settings.md
 *
 * A global prompt is company content: it goes into prompts only, never into a log.
 */

/**
 * The tabs, one per kind of Claude request:
 * - 'live': live answers during a call (the fast model; also its private answers and screenshots);
 * - 'notes': the AI notes written after a call (the smart model);
 * - 'ask': Ask AI (the Ask AI page, and Ask AI in a session's review).
 */
export const AI_INSTRUCTION_BLOCKS = ['live', 'notes', 'ask'] as const;

/** One of the tabs (see AI_INSTRUCTION_BLOCKS). */
export type AiInstructionBlock = (typeof AI_INSTRUCTION_BLOCKS)[number];

/** Most characters one global prompt may hold (the page's counter, the server and a database CHECK). */
export const MAX_GLOBAL_PROMPT_CHARS = 30_000;

/** Most characters of a version's note (the page, the server and a database CHECK). */
export const MAX_VERSION_NOTE_CHARS = 200;

/**
 * The pin value meaning "this call started with no saved version for this block" (the default prompt).
 * A real pin is a version id (a UUID); a request with no pin at all uses the block's version in force.
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
  /** The live-answers version id, or AI_INSTRUCTIONS_NONE for the default prompt. */
  live: string;
  /** The AI-notes version id, or AI_INSTRUCTIONS_NONE for the default prompt. */
  notes: string;
}

/**
 * Cleans a global prompt the same way everywhere it is compared or saved: Windows line endings become
 * "\n", and spaces and blank lines at the start and end go. So the same text always gives the same
 * prompt bytes.
 *
 * @param text The text as typed.
 * @returns The cleaned text.
 * Called from: apps/web/src/server/aiInstructions.ts (saving), features/admin/ai-settings (unsaved
 *              changes); tests
 */
export function normaliseGlobalPrompt(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * Words in an admin's text that usually mean it is trying to set the answer's layout (which the app
 * contract owns) or a user's personal preferences (which the user sets per session). Matched as whole
 * words or phrases, any case.
 */
export const PROMPT_LINT_TERMS = [
  'headline',
  'bullet',
  'hidden',
  '[[',
  'format',
  'length',
  'tone',
  'paragraph',
  'first line',
  'last line',
  'always reply',
  'answer every',
] as const;

/** The hint shown next to a line that uses one of PROMPT_LINT_TERMS. */
export const PROMPT_LINT_MESSAGE =
  'Structure and personal preferences are set elsewhere — describe what to say, not how answers are laid out.';

/** One lint hint. */
export interface PromptLintHint {
  /** The line, from 1. */
  line: number;
  /** The terms it uses (lower case, in PROMPT_LINT_TERMS order). */
  terms: string[];
}

/**
 * Finds lines of a draft that try to set layout or personal preferences. Lines that are exactly a line
 * of the tab's default prompt are left out: the default already words them for the app, so only what
 * the admin wrote or changed gets a hint.
 *
 * @param text      The draft.
 * @param baseline  The tab's default prompt (its lines are not flagged).
 * @returns The hints, in line order.
 * Called from: features/admin/ai-settings (the editor's yellow hints); tests
 */
export function lintGlobalPrompt(text: string, baseline = ''): PromptLintHint[] {
  const known = new Set(
    baseline
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const hints: PromptLintHint[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || known.has(line)) return;
    const lower = line.toLowerCase();
    const terms = PROMPT_LINT_TERMS.filter((term) =>
      term === '[['
        ? lower.includes('[[')
        : new RegExp(`(?:^|[^a-z])${term.replace(/ /g, '\\s+')}s?(?:[^a-z]|$)`).test(lower),
    );
    if (terms.length > 0) hints.push({ line: index + 1, terms: [...terms] });
  });
  return hints;
}

/** The share of the input budget above which the page warns (0.9 = 90 %). */
export const AI_BUDGET_WARN_SHARE = 0.9;

/** What answerBudgetUse() works out. */
export interface AnswerBudgetUse {
  /** The largest live-answer request, counted conservatively, with this global prompt. */
  largestTokens: number;
  /** The budget a request must fit in, tokens. */
  budgetTokens: number;
  /** largestTokens / budgetTokens. */
  share: number;
  /** True when the largest request is at or above AI_BUDGET_WARN_SHARE of the budget. */
  near: boolean;
}

/**
 * Works out how close a live answers global prompt brings the largest answer request to the input
 * budget. The server counts every prompt at `charsPerToken` characters a token (server/budget.ts).
 *
 * @param input.baseTokens    The largest request without a global prompt (the contract, the session
 *                            block at its ceiling, the conversation at its cap, a screenshot).
 * @param input.budgetTokens  The budget (server/budget.ts BUDGET_TOKENS).
 * @param input.charsPerToken Characters a token (server/budget.ts BUDGET_CHARS_PER_TOKEN).
 * @param input.chars         The global prompt's length in characters, with its heading.
 * @returns See AnswerBudgetUse.
 * Called from: features/admin/ai-settings/PromptWorkspace.tsx; tests
 */
export function answerBudgetUse(input: {
  baseTokens: number;
  budgetTokens: number;
  charsPerToken: number;
  chars: number;
}): AnswerBudgetUse {
  const largestTokens = input.baseTokens + Math.ceil(input.chars / input.charsPerToken);
  const share = input.budgetTokens > 0 ? largestTokens / input.budgetTokens : 1;
  return {
    largestTokens,
    budgetTokens: input.budgetTokens,
    share,
    near: share >= AI_BUDGET_WARN_SHARE,
  };
}
