/**
 * File: apps/web/src/core/answer/unavailable.ts
 * Purpose: The text Kite shows when an answer or the call notes fail. When Claude cannot answer
 *          for anyone right now (the team's usage limit is reached, or Claude is overloaded:
 *          code 'claude_unavailable'), the live view, the compact view and the notes status show
 *          that plainly, and say the transcript keeps working, instead of a generic failure. The
 *          same goes for the user's own daily limit (code 'daily_limit', v1.0.2, ADR-0036): the
 *          server's friendly message is shown as it is.
 * Used by: src/features/live/useLiveAnswers.ts, LiveAnswers.tsx (compact view state),
 *          AnswerPanel.tsx; src/core/notes/generate.ts; src/features/live/LivePage.tsx (notes);
 *          src/features/ask-kite/AskKitePage.tsx; src/core/prepare/client.ts; src/core/review/ask.ts
 * Depends on: @kite/shared (AnswerErrorCode, CLAUDE_UNAVAILABLE_MESSAGES), answerClient.ts (type)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (error codes)
 */
import { CLAUDE_UNAVAILABLE_MESSAGES, type AnswerErrorCode } from '@kite/shared';
import type { AnswerFailure } from './answerClient';

/**
 * Why Claude is unavailable: a key of CLAUDE_UNAVAILABLE_MESSAGES (for everyone), or 'dailyLimit'
 * (this user has used today's requests; ADR-0036).
 */
export type UnavailableReason = keyof typeof CLAUDE_UNAVAILABLE_MESSAGES | 'dailyLimit';

/**
 * A failure the user can act on, shown in its own box (Day 6 Stage 4e): 'signed-out' (the
 * sign-in expired; sign in again without leaving the call) or 'offline' (no connection).
 */
export type AnswerProblem = 'signed-out' | 'offline';

/** What the user sees for a signed-out answer. */
export const SIGNED_OUT_TEXT =
  'Your sign-in has expired. Sign in again here: this call, its transcript and its answers stay as they are. Then press Answer again.';

/** What the user sees when Kite cannot reach the internet. */
export const OFFLINE_TEXT =
  "Paramount AI can't reach the internet. The transcript keeps going on this computer; answers come back when the connection does.";

/** Server messages that mean the request never got a full reply (core/answer/answerClient.ts). */
const CONNECTION_MESSAGES = new Set(['Network error', 'The connection closed before the end']);

/** What to show for a failed answer. */
export interface FailureText {
  /** The text, ready to show. */
  text: string;
  /** True when Claude is unavailable (for everyone, or for this user until tomorrow: the daily
   *  limit), shown as a notice, not as this answer's failure. */
  unavailable: boolean;
  /** A failure the user can act on (its own box), or undefined for any other failure. */
  problem?: AnswerProblem;
}

/**
 * Finds why Claude is unavailable from a server error: the code 'claude_unavailable' with one of
 * the known messages (the server sends exactly those), or the code 'daily_limit'.
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
  if (code === 'daily_limit') return 'dailyLimit';
  if (code !== 'claude_unavailable') return null;
  const reasons = Object.keys(
    CLAUDE_UNAVAILABLE_MESSAGES,
  ) as (keyof typeof CLAUDE_UNAVAILABLE_MESSAGES)[];
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
  // The daily limit's message names the limit (dailyLimitMessage()), so it is shown as sent.
  if (reason === 'dailyLimit') {
    return { text: failure.message || DAILY_LIMIT_FALLBACK_TEXT, unavailable: true };
  }
  if (reason) return { text: CLAUDE_UNAVAILABLE_MESSAGES[reason], unavailable: true };
  // The server's 401: the session cookie has expired or the account was signed out.
  if (failure.code === 'unauthorized') {
    return { text: SIGNED_OUT_TEXT, unavailable: false, problem: 'signed-out' };
  }
  if (failure.code === 'internal' && CONNECTION_MESSAGES.has(failure.message)) {
    return { text: OFFLINE_TEXT, unavailable: false, problem: 'offline' };
  }
  // A rejected request or a bare HTTP status: the server's text names validation paths
  // ("session.keyTerms.0: Too big"), which mean nothing to the user (v1.0.1).
  if (failure.code === 'bad_request' || /^Request failed \(HTTP \d+\)$/.test(failure.message)) {
    return { text: REQUEST_PROBLEM_TEXT, unavailable: false };
  }
  return { text: `The answer failed. ${failure.message}`.trim(), unavailable: false };
}

/** Shown for the daily limit if the server's message is missing (it always sends one). */
export const DAILY_LIMIT_FALLBACK_TEXT =
  "You've reached today's limit of answers. It resets at midnight UTC; an admin can raise it.";

/** Shown when Kite could not send the question as it is (never the server's internal reason). */
export const REQUEST_PROBLEM_TEXT =
  'Paramount AI could not send this question. Try again; if it keeps happening, check the session details and documents.';

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
  if (reason === 'dailyLimit') {
    return `The call notes could not be written: you've reached today's limit of answers (it resets at midnight UTC).${later}`;
  }
  if (reason === 'overloaded') {
    return `The call notes could not be written: Claude is overloaded.${later}`;
  }
  return `The call notes could not be written.${later}`;
}
