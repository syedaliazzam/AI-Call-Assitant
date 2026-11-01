/**
 * File: packages/shared/src/lessons.ts
 * Purpose: Limits and the one text clean-up for learned lessons (Day 5 Stage 7), shared by the
 *          browser (the review page and Settings show a lesson exactly as it will be sent) and
 *          the server (which cleans it again before putting it in the rules block).
 * Used by: apps/web/src/core/lessons, apps/web/src/features/review, apps/web/src/features/settings,
 *          apps/web/src/server/validate.ts, apps/web/src/server/prompt.ts
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.6 (learning loop)
 */

/** Most characters in one lesson. */
export const MAX_LESSON_CHARS = 200;

/** Most approved lessons sent with a request (the newest by approval time). */
export const MAX_ACTIVE_LESSONS = 20;

/**
 * Cleans a lesson's text: every run of whitespace (newlines included) becomes one space, then
 * the text is trimmed and cut to MAX_LESSON_CHARS. A lesson is therefore always one line, so
 * it stays one bullet under its heading and cannot start a section of its own.
 *
 * @param text The text as typed or proposed.
 * @returns The text exactly as it is stored and sent.
 * Called from: the review page and Settings (before saving); core/lessons/decide.ts;
 *              server/prompt.ts (rulesBlock)
 */
export function cleanLessonText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_LESSON_CHARS).trim();
}
