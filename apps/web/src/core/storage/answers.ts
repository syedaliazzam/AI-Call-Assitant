/**
 * File: apps/web/src/core/storage/answers.ts
 * Purpose: Save, list, rate and annotate a session's answers on this device.
 * Used by: src/features/live/LivePage.tsx (saves each finished answer; rating and note from the
 *          answer panel); the session review page and the learning loop (Day 5)
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (answers: rating, note), §8.1;
 *               day-04-answers.md Stage 7
 *
 * Answers are saved whether or not the session saves its transcript (types.ts StoredAnswer);
 * deleting the session deletes them (sessions.ts). Question, answer and note text is never
 * logged.
 */
import { getDb } from './db';
import type { AnswerRating, StoredAnswer } from './types';

/** Longest note kept, in characters (a note is a sentence or two). */
export const MAX_NOTE_CHARS = 2_000;

/**
 * Saves an answer (or replaces the one with the same id).
 *
 * @param answer The answer, with its rating and note (null and '' when new).
 * Called from: LivePage.tsx (when an answer finishes); tests
 */
export async function saveAnswer(answer: StoredAnswer): Promise<void> {
  await getDb().answers.put(answer);
}

/**
 * Lists a session's answers in the order they were asked.
 *
 * @param sessionId The session id.
 * @returns The answers, oldest first ([] when none).
 * Called from: LivePage.tsx (ratings shown again after a reload); the review page (Day 5);
 *              tests
 */
export async function listAnswers(sessionId: string): Promise<StoredAnswer[]> {
  return getDb().answers.where('sessionId').equals(sessionId).sortBy('createdAt');
}

/**
 * Sets an answer's rating.
 *
 * @param id     The answer's id.
 * @param rating 'up', 'down', or null to remove the rating.
 * @throws Error('ANSWER_NOT_FOUND') when no answer has this id (for example not saved yet).
 * Called from: LivePage.tsx (👍 / 👎 in the answer panel); tests
 */
export async function rateAnswer(id: string, rating: AnswerRating): Promise<void> {
  const changed = await getDb().answers.update(id, { rating });
  if (changed === 0 && !(await getDb().answers.get(id))) throw new Error('ANSWER_NOT_FOUND');
}

/**
 * Reports an answer as wrong: marks it, with the note saying why (ADR-0029). Stays on this
 * device.
 *
 * @param id   The answer's id.
 * @param note What was wrong; trimmed and cut to MAX_NOTE_CHARS ('' keeps any earlier note).
 * @throws Error('ANSWER_NOT_FOUND') when no answer has this id.
 * Called from: useLiveAnswers.ts (Report); tests
 */
export async function reportAnswer(id: string, note: string): Promise<void> {
  const clean = note.trim().slice(0, MAX_NOTE_CHARS);
  const changed = await getDb().answers.update(id, {
    reported: true,
    ...(clean ? { note: clean } : {}),
  });
  if (changed === 0 && !(await getDb().answers.get(id))) throw new Error('ANSWER_NOT_FOUND');
}

/**
 * Sets an answer's note ("What was wrong / better answer").
 *
 * @param id   The answer's id.
 * @param note The note; trimmed and cut to MAX_NOTE_CHARS ('' removes it).
 * @throws Error('ANSWER_NOT_FOUND') when no answer has this id.
 * Called from: LivePage.tsx (the note box in the answer panel); tests
 */
export async function setAnswerNote(id: string, note: string): Promise<void> {
  const clean = note.trim().slice(0, MAX_NOTE_CHARS);
  const changed = await getDb().answers.update(id, { note: clean });
  if (changed === 0 && !(await getDb().answers.get(id))) throw new Error('ANSWER_NOT_FOUND');
}

/**
 * How many answers each session has. Reads only the sessionId index, so answer text is never loaded.
 *
 * @returns Session id → number of answers (a session with none is absent).
 * Called from: the sessions page (Dashboard.tsx); tests
 */
export async function countAnswersBySession(): Promise<Map<string, number>> {
  const keys = await getDb().answers.orderBy('sessionId').keys();
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(String(key), (counts.get(String(key)) ?? 0) + 1);
  return counts;
}
