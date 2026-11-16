/**
 * File: packages/shared/src/aiInstructions.ts
 * Purpose: Shared names, limits and request shapes for Admin → AI settings (ADR-0083, redesigned in
 *          ADR-0089): the three tabs (live answers, AI notes, Ask AI), each with ONE admin-edited global
 *          prompt sent after the app's locked contract; the per-call version pin; the "Try it" and
 *          "Quality check" requests and replies; the lint hint for text that tries to set layout or
 *          personal preferences; and the input-budget check shown next to the live answers prompt.
 * Used by: apps/web/src/server/aiInstructions.ts, apps/web/src/server/aiTry.ts,
 *          apps/web/src/server/aiQuality.ts, apps/web/src/server/validate.ts,
 *          apps/web/src/core/answer/instructionsPin.ts, apps/web/src/core/admin/aiTry.ts,
 *          apps/web/src/features/admin/ai-settings/*
 * Depends on: ./answer-meta.ts (AnswerMeta), ./api.ts (SessionContext), ./notes.ts (CallNotes)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 *
 * A global prompt is company content: it goes into prompts only, never into a log.
 */
import type { AnswerMeta } from './answer-meta';
import type { SessionContext } from './api';
import type { CallNotes } from './notes';

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
 * Cleans a global prompt the same way everywhere it is tried, checked or saved: Windows line endings
 * become "\n", and spaces and blank lines at the start and end go. So the same text always gives the
 * same prompt bytes (and the same try token).
 *
 * @param text The text as typed.
 * @returns The cleaned text.
 * Called from: apps/web/src/server (aiInstructions.ts, aiTry.ts, aiQuality.ts, promptTryToken.ts),
 *              features/admin/ai-settings (the "tried" check); tests
 */
export function normaliseGlobalPrompt(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/** Body of POST /api/admin/ai-instructions/try (admins only). */
export interface AiTryRequest {
  /** Which tab the draft is for. */
  block: AiInstructionBlock;
  /** The draft global prompt (not saved), at most MAX_GLOBAL_PROMPT_CHARS characters. */
  prompt: string;
  /**
   * 'live' and 'ask': the sample question. 'notes': a short sample call, one line per turn, each
   * starting "Them:" or "You:".
   */
  sample: string;
  /** A session for context (its details, preferences and documents), or absent for none. */
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
  /** The question as the hidden last line cleaned it up, or null when the reply had none. */
  question: string | null;
  /** Proof that this exact draft was tried; Save requires it (server/promptTryToken.ts). */
  promptToken: string;
}

/** Reply of a "Try it" for 'notes': the notes as they would be saved. */
export interface AiTryNotes {
  /** Which kind of reply this is. */
  kind: 'notes';
  /** The notes. */
  notes: CallNotes;
  /** Proof that this exact draft was tried; Save requires it. */
  promptToken: string;
}

/** Reply of POST /api/admin/ai-instructions/try. */
export type AiTryResponse = AiTryAnswer | AiTryNotes;

/** Body of POST /api/admin/ai-instructions/quality (admins only; live answers only). */
export interface QualityCheckRequest {
  /** The draft global prompt for live answers. */
  prompt: string;
}

/** What a quality-check scenario tests: a failed honesty or format case is a warning on its own. */
export type QualityKind = 'honesty' | 'format' | 'quality';

/** One scenario's result. */
export interface QualityScenarioResult {
  /** The scenario's id (for example 'no-cv-behavioural'). */
  id: string;
  /** What it checks, in a few words. */
  title: string;
  /** What kind of case it is. */
  kind: QualityKind;
  /** Its score, 0 to 10. */
  score: number;
  /** False when a must-pass rule failed (an invented fact, a missing hidden line, the wrong format). */
  passed: boolean;
  /** One short sentence on what cost points ('' when nothing did). Never logged. */
  reason: string;
}

/** Reply of POST /api/admin/ai-instructions/quality. */
export interface QualityCheckResponse {
  /** The draft's mean score, 0 to 10. */
  score: number;
  /** The mean score of the prompt in force (checked once and remembered), or null when unknown. */
  liveScore: number | null;
  /** Per scenario, in a fixed order. */
  scenarios: QualityScenarioResult[];
  /** A warning to show (a drop of QUALITY_DROP_WARN or more, or a failed honesty or format case), or null. */
  warning: string | null;
  /** About what the check cost, in dollars (shown next to the result). */
  costDollars: number;
  /** Proof that this exact draft was checked; Save accepts it like a try token. */
  promptToken: string;
}

/** A drop in the mean score at or above this warns (ADR-0089). */
export const QUALITY_DROP_WARN = 0.3;

/**
 * The warning for a quality check, or null when there is none to show.
 *
 * @param score     The draft's mean score.
 * @param liveScore The score of the prompt in force, or null when unknown.
 * @param scenarios The results.
 * @returns The words to show, or null.
 * Called from: apps/web/src/server/aiQuality.ts; tests
 */
export function qualityWarning(
  score: number,
  liveScore: number | null,
  scenarios: readonly Pick<QualityScenarioResult, 'kind' | 'passed' | 'title'>[],
): string | null {
  const parts: string[] = [];
  if (liveScore !== null && liveScore - score >= QUALITY_DROP_WARN - 1e-9) {
    parts.push(
      `The score dropped by ${(liveScore - score).toFixed(1)} compared with the live version.`,
    );
  }
  const failed = scenarios.filter(
    (result) => !result.passed && (result.kind === 'honesty' || result.kind === 'format'),
  );
  if (failed.length > 0) {
    parts.push(`Failed: ${failed.map((result) => result.title).join(', ')}.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
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
