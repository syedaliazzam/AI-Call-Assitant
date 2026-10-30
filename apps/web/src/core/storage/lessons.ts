/**
 * File: apps/web/src/core/storage/lessons.ts
 * Purpose: Reads and writes lesson decisions (approved or rejected) in IndexedDB (Day 5
 *          Stage 7). Proposed lessons stay in the notes; only decisions are stored here, so
 *          regenerating notes never touches them.
 * Used by: src/core/lessons (decide.ts, active.ts), src/features/settings (via core/lessons),
 *          src/core/storage/sessions.ts (deleteSession)
 * Depends on: src/core/storage/db.ts, types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (`lessons`), §7.6
 *
 * Lesson text is the user's own content: stored on this device, never logged.
 */
import { getDb } from './db';
import type { LessonScope, StoredLesson } from './types';

/**
 * Saves a decision (a new one, or a changed one with the same id).
 *
 * @param lesson The decision.
 * @returns Resolves when saved.
 * Called from: core/lessons/decide.ts; tests
 */
export async function saveLesson(lesson: StoredLesson): Promise<void> {
  await getDb().lessons.put(lesson);
}

/**
 * Every decision, oldest first.
 *
 * @returns The decisions.
 * Called from: core/lessons/active.ts, Settings; tests
 */
export async function listLessons(): Promise<StoredLesson[]> {
  return (await getDb().lessons.toArray()).sort((a, b) => a.decidedAt - b.decidedAt);
}

/**
 * The decisions on lessons one session's notes proposed.
 *
 * @param sessionId The session.
 * @returns Its decisions, oldest first.
 * Called from: the review page (via core/lessons); tests
 */
export async function listLessonsForSession(sessionId: string): Promise<StoredLesson[]> {
  const rows = await getDb().lessons.where('sourceSessionId').equals(sessionId).toArray();
  return rows.sort((a, b) => a.decidedAt - b.decidedAt);
}

/** What updateLesson() may change. */
export interface LessonChanges {
  /** New text (already cleaned with cleanLessonText()). */
  text?: string;
  /** New scope. */
  scope?: LessonScope;
}

/**
 * Changes a lesson's text or scope. Its approval time stays, so it keeps its place.
 *
 * @param id      The lesson id.
 * @param changes The new text and/or scope.
 * @returns Resolves when saved (nothing happens for an unknown id).
 * Called from: core/lessons/decide.ts (editLesson); tests
 */
export async function updateLesson(id: string, changes: LessonChanges): Promise<void> {
  await getDb().lessons.update(id, changes);
}

/**
 * Deletes one decision (an approved lesson is no longer sent; a rejected proposal can be
 * offered again).
 *
 * @param id The lesson id.
 * @returns Resolves when deleted.
 * Called from: core/lessons/decide.ts (removeLesson); tests
 */
export async function deleteLesson(id: string): Promise<void> {
  await getDb().lessons.delete(id);
}

/**
 * Deletes every decision ("Clear all lessons" in Settings).
 *
 * @returns How many were deleted.
 * Called from: Settings (via core/lessons/decide.ts clearLessons); tests
 */
export async function deleteAllLessons(): Promise<number> {
  const db = getDb();
  const count = await db.lessons.count();
  await db.lessons.clear();
  return count;
}
