/**
 * File: apps/web/src/core/answer/history.ts
 * Purpose: One entry per question in a call's answer history (v1.0.4, ADR-0040): answers whose
 *          questions are the same, or near-identical within a minute, count as one entry, shown as
 *          the newest good answer. Display only: every answer stays saved on this device, and the
 *          conversation sent to Claude is unchanged. Failed answers and screenshots are never merged
 *          (a failure must stay visible, and two screenshots show different screens).
 * Used by: src/features/live/useLiveAnswers.ts, src/core/review/conversation.ts
 * Depends on: src/core/answer/similar.ts (meaningful words), src/core/transcript/display.ts (fillers)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (answers); ADR-0040
 *
 * Pure functions only. Question text is compared in memory; it is never logged.
 */
import { CHIP_FILLERS } from '../transcript/display';
import { questionOverlap, questionWords } from './similar';

/** How much of two questions' words must be shared to count as near-identical (0 to 1). */
export const NEAR_OVERLAP = 0.8;

/** How close in time two near-identical questions must be asked, in ms. */
export const NEAR_WINDOW_MS = 60_000;

/**
 * How much of their meaningful words two near-identical questions must also share (0 to 1). "Your
 * experience with Python" and "…with Java" share 5 of 6 words but are different questions.
 */
export const MIN_TOPIC_OVERLAP = 0.5;

/** The parts of an answer that merging reads (a live entry, or a saved answer). */
export interface HistoryAnswer {
  /** The answer's id. */
  id: string;
  /** 'answer', 'chat' or 'screenshot'. */
  mode: string;
  /** The question as picked from the transcript or typed. Never logged. */
  question: string;
  /** The question as Claude cleaned it up, once it has arrived. */
  cleanQuestion?: string | undefined;
  /** The answer's text so far. */
  text: string;
  /** Its state; absent on a saved answer, which is always finished. */
  status?: 'streaming' | 'done' | 'error' | 'cancelled';
}

/** The result of merging. */
export interface MergedHistory<T> {
  /** One answer per question, in the order given (a merged entry sits where its shown answer does). */
  list: T[];
  /** For a merged answer's id, the id of the answer shown instead. */
  winnerOf: ReadonlyMap<string, string>;
}

/**
 * Whether an answer was stopped before any words arrived.
 *
 * @param answer Its status and text.
 * @returns True for a cancelled answer with no text.
 * Called from: mergeAnswers(), useLiveAnswers.ts, AnswerPanel.tsx
 */
export function stoppedEmpty(answer: Pick<HistoryAnswer, 'status' | 'text'>): boolean {
  return answer.status === 'cancelled' && answer.text.trim() === '';
}

/**
 * A question's words for comparing: lower case, without punctuation or hesitation sounds.
 *
 * @param question The question.
 * @returns Its distinct words.
 * Called from: sameQuestion(), nearQuestion()
 */
function plainWords(question: string): Set<string> {
  const words =
    question
      .toLowerCase()
      .replace(/['’]/g, '')
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => !CHIP_FILLERS.has(word)));
}

/**
 * Whether two questions have exactly the same words.
 *
 * @param a One question.
 * @param b The other.
 * @returns True when they are the same, ignoring case, punctuation and hesitation sounds.
 * Called from: mergeAnswers(); tests
 */
export function sameQuestion(a: string, b: string): boolean {
  const left = plainWords(a);
  const right = plainWords(b);
  return left.size > 0 && left.size === right.size && [...left].every((word) => right.has(word));
}

/**
 * Whether two questions are near-identical: at least NEAR_OVERLAP of the longer one's words are
 * shared, and they are about the same thing (MIN_TOPIC_OVERLAP of their meaningful words).
 *
 * @param a One question.
 * @param b The other.
 * @returns True when they count as one question.
 * Called from: mergeAnswers(); tests
 */
export function nearQuestion(a: string, b: string): boolean {
  const left = plainWords(a);
  const right = plainWords(b);
  if (left.size === 0 || right.size === 0) return false;
  const shared = [...left].filter((word) => right.has(word)).length;
  if (shared / Math.max(left.size, right.size) < NEAR_OVERLAP) return false;
  return questionOverlap(questionWords(a), questionWords(b)) >= MIN_TOPIC_OVERLAP;
}

/**
 * Whether two answers are for one question: their cleaned or raw words are the same at any time, or
 * near-identical within NEAR_WINDOW_MS.
 *
 * @param a      One answer.
 * @param aAt    When it was asked (Unix ms).
 * @param b      The other.
 * @param bAt    When it was asked (Unix ms).
 * @returns True when they count as one entry.
 * Called from: mergeAnswers()
 */
function oneQuestion(a: HistoryAnswer, aAt: number, b: HistoryAnswer, bAt: number): boolean {
  const forms = (answer: HistoryAnswer) =>
    [answer.cleanQuestion, answer.question].filter((form): form is string => Boolean(form?.trim()));
  const close = Math.abs(aAt - bAt) <= NEAR_WINDOW_MS;
  return forms(a).some((left) =>
    forms(b).some((right) => sameQuestion(left, right) || (close && nearQuestion(left, right))),
  );
}

/**
 * The answer a merged entry shows: the newest still streaming or finished; failing that, the newest
 * with any words (stopped part way); failing that, the newest.
 *
 * @param members The answers of one entry, oldest first.
 * @returns The answer to show.
 * Called from: mergeAnswers()
 */
function pickWinner<T extends HistoryAnswer>(members: readonly T[]): T {
  return (
    members.findLast(
      (answer) =>
        answer.status === 'streaming' ||
        (answer.status !== 'cancelled' && answer.text.trim() !== ''),
    ) ??
    members.findLast((answer) => answer.text.trim() !== '') ??
    members.at(-1)!
  );
}

/**
 * Merges a call's answers into one entry per question.
 *
 * @param answers The answers, oldest first.
 * @param timeOf  When an answer was asked (Unix ms).
 * @returns The entries in order, and which answer each merged answer became.
 * Called from: useLiveAnswers.ts, conversationItems() in core/review/conversation.ts; tests
 */
export function mergeAnswers<T extends HistoryAnswer>(
  answers: readonly T[],
  timeOf: (answer: T) => number,
): MergedHistory<T> {
  const entries: T[][] = [];
  for (const answer of answers) {
    // A failure stays visible, and two screenshots are of different screens.
    const mergeable = answer.mode !== 'screenshot' && answer.status !== 'error';
    // The newest matching entry: a question asked a third time joins the latest time it was asked.
    const entry = mergeable
      ? entries.findLast((members) =>
          members.some(
            (member) =>
              member.mode !== 'screenshot' &&
              member.status !== 'error' &&
              oneQuestion(answer, timeOf(answer), member, timeOf(member)),
          ),
        )
      : undefined;
    if (entry) entry.push(answer);
    else entries.push([answer]);
  }
  const winnerOf = new Map<string, string>();
  const shown = new Set<string>();
  for (const members of entries) {
    const winner = pickWinner(members);
    shown.add(winner.id);
    for (const member of members) if (member !== winner) winnerOf.set(member.id, winner.id);
  }
  return { list: answers.filter((answer) => shown.has(answer.id)), winnerOf };
}
