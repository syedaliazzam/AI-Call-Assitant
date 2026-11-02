/**
 * File: apps/web/src/core/prepare/mockSession.ts
 * Purpose: Saves a finished mock interview as a Mock session on this device, so it appears on the
 *          dashboard and opens in the session window like any call: the questions as "Them", the
 *          answers as "You", each answer's feedback as one of Kite's answers, and the summary as
 *          its AI notes. The session it was prepared from is left as it was.
 * Used by: src/features/prepare/MockInterview.tsx
 * Depends on: src/core/storage (sessions, documents, answers, utterances, notes), @kite/shared
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0029
 *
 * All of it is the user's content, kept on this device and never logged.
 */
import type { MockItem, MockSummaryResponse } from '@kite/shared';
import { saveAnswer } from '../storage/answers';
import { saveNotes } from '../storage/notes';
import { duplicateSession, updateSession } from '../storage/sessions';
import { saveUtterance } from '../storage/utterances';

/** Seconds between each question, answer and feedback in the saved timeline. */
const STEP_MS = 1_000;

/**
 * Saves a mock interview.
 *
 * @param sourceId  The session it was prepared from.
 * @param items     The answered questions, in order.
 * @param summary   The summary, or null when it could not be written.
 * @param startedAt When the interview started (Unix ms).
 * @param now       The time now (Unix ms; tests pass a fixed time).
 * @returns The new session's id.
 * @throws Error('SESSION_NOT_FOUND') when the source session no longer exists.
 * Called from: MockInterview.tsx; tests
 */
export async function saveMockInterview(
  sourceId: string,
  items: readonly MockItem[],
  summary: MockSummaryResponse | null,
  startedAt: number,
  now = Date.now(),
): Promise<string> {
  const copy = await duplicateSession(sourceId, now);
  await updateSession(copy.id, {
    type: 'mock',
    status: 'ended',
    lastActiveAt: now,
    // The transcript is what a mock interview is for, whatever the source session's setting.
    saveTranscript: true,
  });
  let at = startedAt;
  for (const [index, item] of items.entries()) {
    await saveUtterance({
      id: `${copy.id}:mock:${index}:q`,
      sessionId: copy.id,
      speaker: 'them',
      text: item.question,
      tStart: at,
      tEnd: at,
    });
    at += STEP_MS;
    await saveUtterance({
      id: `${copy.id}:mock:${index}:a`,
      sessionId: copy.id,
      speaker: 'you',
      text: item.answer,
      tStart: at,
      tEnd: at,
    });
    at += STEP_MS;
    await saveAnswer({
      id: crypto.randomUUID(),
      sessionId: copy.id,
      mode: 'chat',
      question: item.question,
      text: item.feedback,
      model: 'fast',
      msFirstToken: null,
      msTotal: 0,
      createdAt: at,
      rating: null,
      note: '',
    });
    at += STEP_MS;
  }
  if (summary) {
    await saveNotes({
      sessionId: copy.id,
      notes: {
        summary: summary.summary,
        questions: items.map((item, index) => ({
          question: item.question,
          at: index * 3,
          answered: 'yes',
          rating: null,
        })),
        nextSteps: summary.nextSteps.map((step) => ({ step, owner: 'You' })),
        unclear: [],
        lessons: [],
      },
      callStartedAt: startedAt,
      createdAt: now,
    });
  }
  return copy.id;
}
