/**
 * File: apps/web/src/core/answer/repeatGuard.ts
 * Purpose: Makes Answer idempotent (v1.0.1). An answer can be started from several places at
 *          once: the desktop app's global shortcut and the page's own key handler (merged only
 *          within 150 ms, in one window), the overlay's keys and buttons (sent over the live
 *          channel), and auto-answer. A real call got the same question answered twice ~2 s apart.
 *          This guard ignores a repeat trigger while an answer is still streaming, or for the same
 *          question within REPEAT_WINDOW_MS of the last one.
 * Used by: src/features/live/useLiveAnswers.ts (ask)
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session)
 */

/** How long the same question is not answered again, in milliseconds. */
export const REPEAT_WINDOW_MS = 3_000;

/** One trigger to check. */
export interface AnswerTrigger {
  /** The question the answer would be for ('' when none was found yet). */
  question: string;
  /** True while an answer is still streaming. */
  streaming: boolean;
  /** When the trigger happened (ms, any clock that only goes forward). */
  now: number;
}

/** A guard for one call's answers. */
export interface RepeatGuard {
  /**
   * Decides whether a trigger should start an answer, and remembers it when it does.
   *
   * @param trigger The question, whether one is streaming, and the time.
   * @returns True to answer; false to ignore it as a repeat.
   */
  accept: (trigger: AnswerTrigger) => boolean;
}

/**
 * Normalises a question for comparison: case, spacing and end punctuation do not make it new.
 *
 * @param question The question.
 * @returns Its comparison key.
 */
function keyOf(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Creates a guard for one call.
 *
 * @param windowMs How long the same question is not answered again (default REPEAT_WINDOW_MS).
 * @returns The guard.
 * Called from: useLiveAnswers.ts; tests
 */
export function createRepeatGuard(windowMs: number = REPEAT_WINDOW_MS): RepeatGuard {
  let last: { key: string; at: number } | null = null;
  return {
    accept({ question, streaming, now }) {
      // One answer at a time: a second trigger while one streams is the same press seen again.
      if (streaming) return false;
      const key = keyOf(question);
      if (last && last.key === key && now - last.at < windowMs) return false;
      last = { key, at: now };
      return true;
    },
  };
}
