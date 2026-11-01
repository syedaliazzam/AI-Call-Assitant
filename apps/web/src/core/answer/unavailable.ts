/**
 * File: apps/web/src/core/answer/unavailable.ts
 * Purpose: The text Kite shows when an answer or the call notes fail. When Claude cannot answer
 *          for anyone right now (the team's usage limit is reached, or Claude is overloaded:
 *          code 'claude_unavailable'), the live view, the compact view and the notes status show
 *          that plainly, and say the transcript keeps working, instead of a generic failure.
 * Used by: src/features/live/useLiveAnswers.ts, LiveAnswers.tsx (compact view state),
 *          AnswerPanel.tsx; src/core/notes/generate.ts; src/features/live/LivePage.tsx (notes)
 * Depends on: @kite/shared (AnswerErrorCode, CLAUDE_UNAVAILABLE_MESSAGES), answerClient.ts (type)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (error codes)
 */
import { CLAUDE_UNAVAILABLE_MESSAGES, type AnswerErrorCode } from '@kite/shared';
import type { AnswerFailure } from './answerClient';

/** Why Claude is unavailable: a key of CLAUDE_UNAVAILABLE_MESSAGES. */
export type UnavailableReason = keyof typeof CLAUDE_UNAVAILABLE_MESSAGES;

/** What to show for a failed answer. */
export interface FailureText {
  /** The text, ready to show. */
  text: string;
  /** True when Claude is unavailable for everyone (shown as a notice, not as this answer's failure). */
  unavailable: boolean;
}

/**
 * Finds why Claude is unavailable from a server error: only the code 'claude_unavailable' with
 * one of the known messages counts (the server sends exactly those).
 *
 * @param code    The error code.
 * @param message The server's message.
 * @returns The reason, or null for any other failure.
 * Called from: answerFailureText(); generateNotes() in core/notes/generate.ts
 */
export function unavailableReason(
  code: AnswerErrorCode | string | undefined,
  message: string | undefined,
): UnavailableReason | null {
  if (code !== 'claude_unavailable') return null;
  const reasons = Object.keys(CLAUDE_UNAVAILABLE_MESSAGES) as UnavailableReason[];
  // An unknown message with this code (a newer server) still means unavailable: the usage limit
  // is the likelier reason.
  return reasons.find((reason) => CLAUDE_UNAVAILABLE_MESSAGES[reason] === message) ?? 'usageLimit';
}

/**
 * The text for a failed answer: the unavailable message as it is, or "The answer failed." with
 * the server's short reason.
 *
 * @param failure The failure's code and message.
 * @returns The text and whether Claude is unavailable.
 * Called from: useLiveAnswers.ts (onError)
 */
export function answerFailureText(failure: AnswerFailure): FailureText {
  const reason = unavailableReason(failure.code, failure.message);
  if (reason) return { text: CLAUDE_UNAVAILABLE_MESSAGES[reason], unavailable: true };
  return { text: `The answer failed. ${failure.message}`.trim(), unavailable: false };
}

/**
 * The notes status line after a failure. The call has ended, so it says what is kept instead of
 * "still being recorded".
 *
 * @param reason         Why Claude was unavailable, or null for any other failure.
 * @param saveTranscript Whether the session saves its transcript (then notes can be written
 *                       again later from the session review).
 * @returns The text to show.
 * Called from: LivePage.tsx (after End)
 */
export function notesFailureText(
  reason: UnavailableReason | null,
  saveTranscript: boolean,
): string {
  const later = saveTranscript
    ? ' Your transcript and answers are saved on this computer, so you can write the notes later from the session review.'
    : '';
  if (reason === 'usageLimit') {
    return `The call notes could not be written: the team's Claude usage limit has been reached.${later}`;
  }
  if (reason === 'overloaded') {
    return `The call notes could not be written: Claude is overloaded.${later}`;
  }
  return `The call notes could not be written.${later}`;
}
