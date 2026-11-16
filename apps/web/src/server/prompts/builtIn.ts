/**
 * File: apps/web/src/server/prompts/builtIn.ts
 * Purpose: Each block's built-in full system prompt, part by part (ADR-0086): what a block with no custom
 *          prompt sends, and what "Reset to default" goes back to. Also its fingerprint (a hash of the
 *          exact bytes), and the day each block's built-in prompt last changed (ADR-0087), which the
 *          AI settings notice shows when a custom prompt was written against an older built-in prompt.
 * Used by: src/server/aiTry.ts (lockedRulesFor), src/server/aiInstructions.ts (base of a saved prompt,
 *          the built-in change notice)
 * Depends on: node:crypto, @kite/shared (promptKey), src/server/prompt.ts, notes.ts, ask.ts, kite-chat.ts
 * Architecture: docs/decisions/ADR-0086-full-system-prompt-editing.md,
 *               docs/decisions/ADR-0087-built-in-rules-change-notice.md
 *
 * When a built-in prompt changes, tests/unit/server/builtInPrompts.test.ts fails until BUILT_IN_REVISIONS
 * gets the new hash and the day of the change: that date is what admins with a custom prompt are told.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { promptKey, type AiInstructionBlock, type CustomPrompt } from '@kite/shared';
import { ASK_RULES } from '../ask';
import { KITE_CHAT_RULES } from '../kite-chat';
import { NOTES_RULES } from '../notes';
import { CALL_REMINDER, CORE_RULES, SCREENSHOT_RULES } from '../prompt';

/** Each block's built-in prompt, part by part (the keys of PROMPT_PARTS). */
export const BUILT_IN_PROMPTS: Readonly<Record<AiInstructionBlock, CustomPrompt>> = {
  live: { core: CORE_RULES, reminder: CALL_REMINDER, screenshot: SCREENSHOT_RULES },
  notes: { rules: NOTES_RULES },
  ask: { chat: KITE_CHAT_RULES, review: ASK_RULES },
};

/** One revision of a block's built-in prompt. */
export interface BuiltInRevision {
  /** The day it took effect (YYYY-MM-DD, the release day). */
  date: string;
  /** builtInHash() of its text. */
  sha256: string;
}

/**
 * The current revision of each block's built-in prompt. Update the date and the hash together whenever
 * a built-in prompt changes (tests/unit/server/builtInPrompts.test.ts prints the new hash).
 */
export const BUILT_IN_REVISIONS: Readonly<Record<AiInstructionBlock, BuiltInRevision>> = {
  // 2026-11-16 (ADR-0086): "You are Paramount AI"; the transcript comes from Deepgram, on-device fallback.
  live: {
    date: '2026-11-16',
    sha256: '437551a24c9776d51e0ffb1d07db7fc58cd3e674bb94fc2506ee968a6084d609',
  },
  // 2026-11-16 (ADR-0086): "You are Paramount AI".
  notes: {
    date: '2026-11-16',
    sha256: 'db577bcb6d7307efd5dbc39d6bd4bc924fb5d42651bd70192b9d70cfecb2be93',
  },
  // 2026-11-16 (ADR-0086): "You are Paramount AI" in the session-review rules.
  ask: {
    date: '2026-11-16',
    sha256: '2ccbe8b10504e257fade29fd7813035cb2a48574aae5cb346e45102e32c404ec',
  },
};

/**
 * The fingerprint of a block's prompt: SHA-256 of its cleaned parts (promptKey()), so the same bytes
 * always give the same hash.
 *
 * @param block  The block.
 * @param prompt The prompt (the built-in one by default).
 * @returns 64 hex characters.
 * Called from: src/server/aiInstructions.ts; tests
 */
export function builtInHash(
  block: AiInstructionBlock,
  prompt: CustomPrompt = BUILT_IN_PROMPTS[block],
): string {
  return createHash('sha256').update(promptKey(block, prompt)).digest('hex');
}
