/**
 * File: apps/web/scripts/lib/answer-line.ts
 * Purpose: The check on the answer line's length in the paid evaluation (v1.1.0, item 16): at most 12
 *          words, not counting a label. Measures what the model wrote, so the prompt's work is what gets
 *          measured, and also what the card then shows after its own cut at a clause.
 * Used by: scripts/eval-answers.ts; tests/unit/scripts/answer-line.test.ts
 * Depends on: src/core/answer/format.ts (answerLineWords), @kite/shared (AnswerMeta)
 * Architecture: docs/testing/answer-eval.md; ADR-0043
 */
import type { AnswerMeta } from '@kite/shared';
import { answerLineWords, splitAnswer } from '../../src/core/answer/format';

/**
 * The answer line's length, for an answer that has one. A private answer, and the "bullets" and
 * "paragraph" formats, have no answer line; a garbled reply has no answer at all.
 *
 * @param text   The answer, without its hidden lines.
 * @param format The session's answer format.
 * @param meta   What the hidden line said, when it had one.
 * @returns The field to record, or null when the check does not apply.
 * Called from: extraChecks() in scripts/eval-answers.ts; tests
 */
export function callAnswerLine(
  text: string,
  format: string,
  meta: Pick<AnswerMeta, 'target'> | null,
): { answerLineWords: number; shownLineWords: number } | null {
  if (format !== 'headline+bullets' || meta?.target === 'kite') return null;
  const first = text.split('\n').find((line) => line.trim() !== '');
  if (first === undefined) return null;
  return {
    answerLineWords: answerLineWords(first),
    shownLineWords: answerLineWords(splitAnswer(text).headline),
  };
}
