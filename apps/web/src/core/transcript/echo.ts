/**
 * File: apps/web/src/core/transcript/echo.ts
 * Purpose: Recognises "echo": the other side's voice coming out of the laptop's speakers, picked
 *          up by the microphone and transcribed a second time as "You". An echo line repeats, in
 *          the same order, what "Them" said a moment earlier. Such lines are hidden from the
 *          transcript (transcript.ts), because Day 4 takes the question from the "Them" lines
 *          since the user last spoke, and a fake "You" line would cut that question short.
 * Used by: src/core/transcript/transcript.ts
 * Depends on: src/core/stt/wer.ts (normalizeWords: lower case, no punctuation)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 2–3; ADR-0020 (speaker leak)
 *
 * The rule (Day 2, from the developer's speaker test):
 * - only a "You" line of at least ECHO_MIN_WORDS words is judged. Short replies ("yes",
 *   "exactly", "sounds good") are never hidden: they are real turn-taking, and too short to tell
 *   an echo from agreement;
 * - it is compared with what "Them" said from 10 s before the line started to 3 s after it ended
 *   (the echo arrives together with, or just after, the original; v1.1.0: 3 s, was 2 s);
 * - score = longest common word sequence (in order) ÷ number of words in the "You" line. Order
 *   matters: a real reply that reuses words of the question ("the professional plan costs…" after
 *   "what does the professional plan cost") shares a few words, not a long run in the same order;
 * - echo when score ≥ ECHO_MIN_SCORE (0.6). The developer's two examples score 0.83 and 0.91;
 *   speech-to-text changes some words of an echo ("IT" → "YOU'D"), so 1.0 is never required.
 * - v1.1.0 (ADR-0044): a "You" line of exactly three words is an echo only when "Them" said the same
 *   three words in the same order within 3 s of it. Four or more words still use the rule above.
 * Only "You" lines are ever judged; "Them" lines are never hidden.
 */
import { normalizeWords } from '../stt/wer';

/** Fewest words in a "You" line before it can be judged an echo. */
export const ECHO_MIN_WORDS = 4;

/** Share of the "You" words that must appear in order in what "Them" said. */
export const ECHO_MIN_SCORE = 0.6;

/** How far before a "You" line's start "Them" speech is compared, in ms. */
export const ECHO_WINDOW_BEFORE_MS = 10_000;

/** How far after a "You" line's end "Them" speech is compared, in ms. */
export const ECHO_WINDOW_AFTER_MS = 3_000;

/** A "You" line this short is judged only by an exact match, very close in time (v1.1.0). */
export const ECHO_SHORT_WORDS = 3;

/** How close in time, either way, an exact match of a short line must be, in ms (v1.1.0). */
export const ECHO_SHORT_WINDOW_MS = 3_000;

/**
 * Length of the longest common subsequence of two word lists (words in the same order, gaps
 * allowed).
 *
 * @param a First list.
 * @param b Second list.
 * @returns The number of words in the longest common subsequence.
 * Called from: echoScore(); tests
 */
export function lcsLength(a: readonly string[], b: readonly string[]): number {
  // One row of the classic dynamic-programming table at a time (memory O(len(b))).
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * How much of a "You" line repeats, in order, what "Them" said.
 *
 * @param youText  The "You" line.
 * @param themText What "Them" said around that time (joined in time order).
 * @returns 0…1 (0 for an empty "You" line).
 * Called from: isEcho(); tests
 */
export function echoScore(youText: string, themText: string): number {
  const you = normalizeWords(youText);
  if (you.length === 0) return 0;
  return lcsLength(you, normalizeWords(themText)) / you.length;
}

/**
 * Decides whether a "You" line is an echo of "Them".
 *
 * @param youText  The "You" line.
 * @param themText What "Them" said around that time (joined in time order).
 * @param nearText What "Them" said within ECHO_SHORT_WINDOW_MS of it (for a three-word line).
 * @returns True for an echo: long enough with score ≥ ECHO_MIN_SCORE, or three words said exactly.
 * Called from: transcript.ts (addPartial, addFinal); tests
 */
export function isEcho(youText: string, themText: string, nearText = ''): boolean {
  const words = normalizeWords(youText).length;
  if (words === ECHO_SHORT_WORDS) return echoScore(youText, nearText) === 1;
  if (words < ECHO_MIN_WORDS) return false;
  return echoScore(youText, themText) >= ECHO_MIN_SCORE;
}
