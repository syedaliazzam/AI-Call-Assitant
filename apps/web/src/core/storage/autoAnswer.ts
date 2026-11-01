/**
 * File: apps/web/src/core/storage/autoAnswer.ts
 * Purpose: Remembers whether auto-answer (beta, Day 6 Stage 4f) is on, on this device. Off by
 *          default. Kept in localStorage: it is a per-device preference, not session data.
 * Used by: src/features/settings/AutoAnswerSetting.tsx, src/features/live/useAutoAnswer.ts
 * Depends on: nothing (localStorage)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger); day-06 Stage 4
 */

/** The localStorage key. */
export const AUTO_ANSWER_KEY = 'kite.autoAnswer';

/**
 * Whether auto-answer is on.
 *
 * @returns True only when the user turned it on; false when storage is unavailable.
 * Called from: AutoAnswerSetting.tsx, useAutoAnswer.ts
 */
export function getAutoAnswer(): boolean {
  try {
    return localStorage.getItem(AUTO_ANSWER_KEY) === 'on';
  } catch {
    // Storage blocked (private window, policy): stay off.
    return false;
  }
}

/**
 * Turns auto-answer on or off.
 *
 * @param on True to turn it on.
 * @returns Nothing.
 * Called from: AutoAnswerSetting.tsx
 */
export function setAutoAnswer(on: boolean): void {
  try {
    if (on) localStorage.setItem(AUTO_ANSWER_KEY, 'on');
    else localStorage.removeItem(AUTO_ANSWER_KEY);
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
}
