/**
 * File: apps/web/src/core/review/ask.ts
 * Purpose: Ask AI about a finished call (POST /api/ask): sends the session, its CV and the summary
 *          of its other documents (ADR-0067), the
 *          saved transcript, the answers, the AI notes and the conversation so far, and returns a
 *          short reply. The call's part is the same on every question, so the prompt cache
 *          serves it after the first. Never throws: a failure comes back as a message.
 * Used by: src/features/review/AskSection.tsx
 * Depends on: @kite/shared (types, limits), src/core/notes/regenerate.ts (regenerateInput),
 *             src/core/notes/generate.ts (notesRequest), src/core/answer/unavailable.ts,
 *             src/core/documents/summary.ts (ensureDocumentsSummary),
 *             src/core/review/load.ts (ReviewData), the browser's fetch
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/ask); ADR-0029
 *
 * Questions and replies are the user's content and are never logged here.
 */
import {
  MAX_ASK_HISTORY,
  MAX_ASK_NOTES_CHARS,
  type AnswerErrorCode,
  type AskRequest,
  type AskResponse,
  type AskTurn,
  type CallNotes,
} from '@kite/shared';
import { unavailableReason } from '../answer/unavailable';
import { ensureDocumentsSummary, type SummaryDeps } from '../documents/summary';
import { notesRequest } from '../notes/generate';
import { regenerateInput } from '../notes/regenerate';
import type { ReviewData } from './load';

/** What asking gave. */
export type AskResult =
  | {
      /** It worked. */
      ok: true;
      /** Kite's reply. */
      text: string;
    }
  | {
      /** It did not. */
      ok: false;
      /** What to tell the user. */
      message: string;
    };

/**
 * The AI notes as text for the request.
 *
 * @param notes The notes, or null.
 * @returns The text, within the limit ('' when there are none).
 * Called from: askRequest(); tests
 */
export function notesText(notes: CallNotes | null): string {
  if (!notes) return '';
  return [
    ...notes.summary.map((line) => `Summary: ${line}`),
    ...notes.questions.map((item) => `Question asked: ${item.question}`),
    ...notes.nextSteps.map((item) => `Next step (${item.owner}): ${item.step}`),
  ]
    .join('\n')
    .slice(0, MAX_ASK_NOTES_CHARS);
}

/**
 * Builds the request, within the limits.
 *
 * @param review   The session's review data.
 * @param question The user's question.
 * @param history  The conversation so far, oldest first.
 * @param summary  The documents summary (ADR-0067; '' or null: none).
 * @returns The request.
 * Called from: askAboutCall(); tests
 */
export function askRequest(
  review: ReviewData,
  question: string,
  history: readonly AskTurn[],
  summary: string | null = null,
): AskRequest {
  return {
    ...notesRequest(regenerateInput(review), summary),
    notes: notesText(review.notes?.notes ?? null),
    question,
    history: history.slice(-MAX_ASK_HISTORY),
  };
}

/**
 * Asks about the call.
 *
 * @param review    The session's review data.
 * @param question  The user's question.
 * @param history   The conversation so far, oldest first.
 * @param fetchImpl fetch (tests replace it).
 * @param summaryDeps How the documents summary is written and kept (tests replace them).
 * @returns The reply, or a message for the user.
 * Called from: AskSection.tsx; tests
 */
export async function askAboutCall(
  review: ReviewData,
  question: string,
  history: readonly AskTurn[],
  fetchImpl: typeof fetch = fetch,
  summaryDeps: SummaryDeps = {},
): Promise<AskResult> {
  try {
    // Written once per session and kept; usually already there from the call or its notes.
    const summary = await ensureDocumentsSummary(review.session, review.documents, summaryDeps);
    const response = await fetchImpl('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(askRequest(review, question, history, summary)),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as {
        /** Why it failed. */
        code?: AnswerErrorCode;
        /** The server's words. */
        message?: string;
      } | null;
      if (failure?.code === 'unauthorized') {
        return { ok: false, message: 'You have been signed out. Sign in again, then ask.' };
      }
      if (failure?.code && unavailableReason(failure.code, failure.message ?? '')) {
        return { ok: false, message: failure.message ?? 'Claude is unavailable right now.' };
      }
      return { ok: false, message: 'Paramount AI could not answer just now. Try again.' };
    }
    const { text } = (await response.json()) as AskResponse;
    return { ok: true, text };
  } catch {
    return {
      ok: false,
      message: 'Paramount AI could not answer: check your connection and try again.',
    };
  }
}
