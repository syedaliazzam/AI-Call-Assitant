/**
 * File: apps/web/src/core/answer/similar.ts
 * Purpose: Finds an earlier answer in this call to a question like the current one, by comparing
 *          the questions' meaningful words, so the request can ask Claude to reuse its facts and
 *          wording. No model call: this runs in the browser before the request is sent.
 * Used by: src/core/answer/context.ts
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */

/** Words that say nothing about what a question is about. */
const STOP_WORDS = new Set(
  (
    'a about again all also am an and any are as at be been but by can could did do does for from ' +
    'get give go had has have how i if in is it its just let me mind more my of on one or our ' +
    'please remind say so sorry tell than that the their them then there these they this to us ' +
    'was we were what when where which who why will with would you your'
  ).split(' '),
);

/** How much two questions' words must overlap to count as the same question (0 to 1). */
export const SIMILAR_THRESHOLD = 0.6;

/**
 * A question's meaningful words, lower case, with a plural or verb "s" removed, so "costs" and
 * "cost" count as one word.
 *
 * @param question The question.
 * @returns Its distinct words.
 * Called from: findSimilarAnswer(), questionOverlap()
 */
export function questionWords(question: string): Set<string> {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    words
      .filter((word) => !STOP_WORDS.has(word))
      .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)),
  );
}

/**
 * How much two sets of words overlap: shared words over all the words of either (Jaccard).
 *
 * @param a One set.
 * @param b The other.
 * @returns 0 to 1; 0 when either is empty.
 * Called from: findSimilarAnswer(); tests
 */
export function questionOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared);
}

/**
 * Finds the best earlier answer to a similar question: the closest one, the latest among equals, so
 * a correction made later in the call is what gets reused.
 *
 * @param question The current question.
 * @param answers  This call's finished answers, oldest first.
 * @returns The answer, or null when none is close enough.
 * Called from: context.ts (buildAnswerRequest); tests
 */
export function findSimilarAnswer<T extends { question: string; text: string }>(
  question: string,
  answers: readonly T[],
): T | null {
  const words = questionWords(question);
  let best: T | null = null;
  let bestScore = SIMILAR_THRESHOLD;
  for (const answer of answers) {
    if (answer.text.trim() === '') continue;
    const score = questionOverlap(words, questionWords(answer.question));
    if (score >= bestScore) {
      best = answer;
      bestScore = score;
    }
  }
  return best;
}
