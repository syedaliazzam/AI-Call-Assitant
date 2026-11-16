/**
 * File: apps/web/src/server/aiBudget.ts
 * Purpose: The input-budget facts Admin → AI settings shows next to the live answers prompt (ADR-0089):
 *          how large the largest live-answer request is without a global prompt, so the page can warn
 *          when a long prompt brings it near the input budget.
 * Used by: app/(app)/admin/ai-settings/page.tsx
 * Depends on: @kite/shared (limits), src/server/budget.ts, src/server/prompt.ts (LEARNED_HEADING),
 *             src/server/prompts/contract.ts
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md,
 *               ADR-0091-simpler-ai-settings.md
 */
import 'server-only';
import {
  CHARS_PER_TOKEN,
  CONVERSATION_CAP_TOKENS,
  MAX_ACTIVE_LESSONS,
  MAX_LESSON_CHARS,
  type SessionContext,
} from '@kite/shared';
import {
  BUDGET_CHARS_PER_TOKEN,
  BUDGET_TOKENS,
  IMAGE_TOKENS,
  SESSION_BLOCK_MAX_CHARS,
} from './budget';
import { LEARNED_HEADING } from './prompt';
import {
  GLOBAL_HEADING,
  LIVE_CONTRACT,
  liveEndReminder,
  SCREENSHOT_TAIL,
} from './prompts/contract';

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

/** A session with every field left empty, to measure the end reminder. */
const EMPTY_SESSION: SessionContext = {
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
    liveEndReminder(EMPTY_SESSION).length +
    SCREENSHOT_TAIL.length;
  return {
    baseTokens: Math.ceil(chars / BUDGET_CHARS_PER_TOKEN) + IMAGE_TOKENS,
    budgetTokens: BUDGET_TOKENS,
    charsPerToken: BUDGET_CHARS_PER_TOKEN,
    headingChars: GLOBAL_HEADING.length + 3,
  };
}
