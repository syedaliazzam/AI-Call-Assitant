/**
 * File: apps/web/src/core/lessons/match.ts
 * Purpose: Matches a lesson the notes propose with a decision the user already made (Day 5
 *          Stage 7), so regenerating the notes never asks twice or makes a duplicate: the same
 *          session, and either the same normalised text or words that overlap at least 80%
 *          (a reworded proposal). The overlap is the echo filter's idea (core/transcript/echo.ts):
 *          the longest common run of words in order, here divided by the longer text's length.
 * Used by: src/core/lessons/decide.ts, src/features/review (proposed lessons)
 * Depends on: src/core/stt/wer.ts (normalizeWords), src/core/transcript/echo.ts (lcsLength),
 *             src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.6 (learning loop)
 */
import { normalizeWords } from '../stt/wer';
import type { StoredLesson } from '../storage/types';
import { lcsLength } from '../transcript/echo';

/** Word overlap at or above which two lessons count as the same lesson. */
export const LESSON_MATCH_OVERLAP = 0.8;

/**
 * A lesson's text in a comparable form: lower case, numbers spelled out, no punctuation.
 *
 * @param text The lesson.
 * @returns The normalised words joined by single spaces.
 * Called from: decide.ts (sourceKey), findDecision(); tests
 */
export function normaliseLesson(text: string): string {
  return normalizeWords(text).join(' ');
}

/**
 * How much two lessons' words overlap: the longest common run of words in order, divided by
 * the longer one's word count (so a short lesson inside a long one is not a match).
 *
 * @param a One lesson.
 * @param b The other.
 * @returns 0 to 1 (0 when either is empty).
 * Called from: findDecision(); tests
 */
export function lessonOverlap(a: string, b: string): number {
  const wordsA = normalizeWords(a);
  const wordsB = normalizeWords(b);
  const longer = Math.max(wordsA.length, wordsB.length);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  return lcsLength(wordsA, wordsB) / longer;
}

/**
 * Finds the user's decision on a proposed lesson, if they made one.
 *
 * @param proposal  The proposed lesson's text (from the notes).
 * @param sessionId The session whose notes proposed it.
 * @param decisions Stored decisions (any session; others are ignored).
 * @returns The decision with the same normalised source text, else the one whose source or
 *          current text overlaps most (at least LESSON_MATCH_OVERLAP), else null.
 * Called from: decide.ts (decideLesson), the review page; tests
 */
export function findDecision(
  proposal: string,
  sessionId: string,
  decisions: readonly StoredLesson[],
): StoredLesson | null {
  const mine = decisions.filter((decision) => decision.sourceSessionId === sessionId);
  const key = normaliseLesson(proposal);
  const exact = mine.find((decision) => decision.sourceKey === key);
  if (exact) return exact;
  let best: StoredLesson | null = null;
  let bestOverlap = 0;
  for (const decision of mine) {
    const overlap = Math.max(
      lessonOverlap(proposal, decision.sourceKey),
      lessonOverlap(proposal, decision.text),
    );
    if (overlap >= LESSON_MATCH_OVERLAP && overlap > bestOverlap) {
      best = decision;
      bestOverlap = overlap;
    }
  }
  return best;
}
