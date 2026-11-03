/**
 * File: apps/web/src/core/answer/answerType.ts
 * Purpose: Keeps the answer card's type label steady (v1.0.1). The model names the question type
 *          in its hidden first line, and a real call showed it drift: the same question was
 *          labelled "Small talk" and then "Behavioural", and the technical question "What happens
 *          when the sources don't cover the question" was labelled "Behavioural". Two plain rules,
 *          no model call: a question already answered in this call keeps its first label, and a
 *          clearly technical question ("how does…", "what happens when…") labelled behavioural or
 *          small talk is shown as a technical concept unless it asks for a past experience.
 * Used by: src/features/live/useLiveAnswers.ts (onMeta)
 * Depends on: src/core/answer/similar.ts (questionWords, questionOverlap, SIMILAR_THRESHOLD)
 * Architecture: ADR-0030 (adaptive answers and their type tags)
 */
import type { AnswerType } from '@kite/shared';
import { questionOverlap, questionWords, SIMILAR_THRESHOLD } from './similar';

/** An earlier answer of this call, as far as its label goes. */
export interface LabelledQuestion {
  /** The question it answered. */
  question: string;
  /** The type it was shown with. */
  type: AnswerType;
}

/** A question about how something works or behaves: a technical concept. */
const TECHNICAL =
  /^\s*(how (does|do|would|will|is|are|can)\b|what (happens|would happen) (when|if)\b|why (does|do|is|are)\b|what is the difference\b|what's the difference\b|explain\b|walk me through how\b)/i;

/** A question about the user's own past: behavioural, whatever words follow. */
const PAST_EXPERIENCE =
  /\b(tell me about a time|describe a (time|situation)|give me an example of (a time|when)|have you ever|a time when you|when you had to)\b/i;

/**
 * The type to show for an answer's question.
 *
 * @param question The question answered.
 * @param type     The type the model gave.
 * @param earlier  This call's earlier answers with their shown types, oldest first.
 * @returns The earlier label for the same or a similar question; else 'concept' for a clearly
 *          technical question the model called behavioural or small talk; else the model's type.
 * Called from: useLiveAnswers.ts (onMeta); tests
 */
export function settleAnswerType(
  question: string,
  type: AnswerType,
  earlier: readonly LabelledQuestion[],
): AnswerType {
  const words = questionWords(question);
  if (words.size > 0) {
    // The same question asked again keeps its first label (the first is the one the user saw).
    const match = earlier.find(
      (item) => questionOverlap(words, questionWords(item.question)) >= SIMILAR_THRESHOLD,
    );
    if (match) return match.type;
  }
  if (
    (type === 'behavioural' || type === 'smalltalk') &&
    TECHNICAL.test(question) &&
    !PAST_EXPERIENCE.test(question)
  ) {
    return 'concept';
  }
  return type;
}
