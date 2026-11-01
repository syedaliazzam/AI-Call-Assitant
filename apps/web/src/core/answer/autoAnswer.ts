/**
 * File: apps/web/src/core/answer/autoAnswer.ts
 * Purpose: Auto-answer (beta, off by default; Day 6 Stage 4f): decides when Kite should answer
 *          by itself, without the user pressing Answer. It fires when "Them" has finished a
 *          question: their latest line is final and reads like a question (ends with "?", or
 *          starts with a question word or a helping verb), and nobody has spoken for at least
 *          AUTO_PAUSE_MS since. At most one auto-answer per AUTO_MIN_GAP_MS, never while an
 *          answer is streaming, and the same words never trigger twice (a "Them" line that
 *          grows after an auto-answer keeps its id, so it is matched by its end time).
 * Used by: src/features/live/useAutoAnswer.ts
 * Depends on: src/core/transcript/question.ts (isQuestionLike), src/core/transcript/transcript.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger); day-06 Stage 4
 *
 * Pure functions only (the caller passes the time), so every rule is unit-tested. Transcript
 * text is never logged.
 */
import { isQuestionLike } from '../transcript/question';
import type { Utterance } from '../transcript/transcript';

/** Silence after the question before Kite answers, ms (the question has ended). */
export const AUTO_PAUSE_MS = 1_200;

/** Shortest time between two auto-answers, ms. */
export const AUTO_MIN_GAP_MS = 15_000;

/**
 * Words that start a question (the detector's own, stricter list: only at the start of the
 * line, so "I know what you mean" is not a question).
 */
const STARTS_QUESTION =
  /^(what|whats|what's|why|how|when|where|who|whom|whose|which|can|could|would|will|should|shall|do|does|did|is|are|was|were|have|has|had|may|might|tell me|walk me through|explain|describe)\b/i;

/**
 * Whether a finished "Them" line is a question Kite should answer by itself: it ends with "?"
 * or starts with a question word or helping verb, and it has at least three words (so "What?"
 * or "Sorry?" alone is not answered).
 *
 * @param text The line's text.
 * @returns True for a question.
 * Called from: autoAnswerDue(); tests
 */
export function isAutoQuestion(text: string): boolean {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  return trimmed.endsWith('?') || (STARTS_QUESTION.test(trimmed) && isQuestionLike(trimmed));
}

/** What autoAnswerDue() needs to know about the call. */
export interface AutoAnswerState {
  /** Whether the user turned auto-answer on (Settings). */
  enabled: boolean;
  /** Whether an answer is streaming now. */
  streaming: boolean;
  /** The visible transcript lines, in order (finals and partials). */
  lines: readonly Utterance[];
  /** When the last auto-answer fired, in the lines' time base (ms), or null. */
  lastAutoAt: number | null;
  /**
   * End time (ms) of the line the last auto-answer was for, or null. Lines that follow each
   * other merge into one line with the same id, so the end time tells a grown line apart.
   */
  lastAutoLineEnd: number | null;
}

/**
 * Whether an auto-answer is due now, and for which line.
 *
 * @param state See AutoAnswerState.
 * @param now   The current time, in the lines' time base (ms).
 * @returns The question line to answer (its id and end time), or null when none is due.
 * Called from: useAutoAnswer.ts (on a timer); tests
 */
export function autoAnswerDue(
  state: AutoAnswerState,
  now: number,
): { id: string; tEnd: number } | null {
  if (!state.enabled || state.streaming || state.lines.length === 0) return null;
  if (state.lastAutoAt !== null && now - state.lastAutoAt < AUTO_MIN_GAP_MS) return null;
  const last = state.lines.at(-1)!;
  // The newest line must be a finished "Them" question: if anyone is still speaking (a grey
  // line) or the user spoke after it, the moment has passed.
  if (last.speaker !== 'them' || !last.final) return null;
  if (state.lastAutoLineEnd !== null && last.tEnd <= state.lastAutoLineEnd) return null;
  if (now - last.tEnd < AUTO_PAUSE_MS) return null;
  return isAutoQuestion(last.text) ? { id: last.id, tEnd: last.tEnd } : null;
}
