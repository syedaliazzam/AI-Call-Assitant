/**
 * File: apps/web/src/core/lessons/decide.ts
 * Purpose: The user's actions on lessons (Day 5 Stage 7): approve (with edited text and a
 *          scope) or reject a proposed lesson, edit or remove a decided one, clear them all.
 *          Nothing is learned without approval. A decision on a proposal that matches an
 *          earlier one (core/lessons/match.ts) changes that decision instead of adding another.
 * Used by: src/features/review (proposed lessons), src/features/settings (What Kite has learned)
 * Depends on: @kite/shared (cleanLessonText), src/core/lessons/match.ts,
 *             src/core/storage/lessons.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.6 (learning loop)
 *
 * Lesson text is never logged.
 */
import { cleanLessonText, type ProposedLesson } from '@kite/shared';
import {
  deleteAllLessons,
  deleteLesson,
  listLessonsForSession,
  saveLesson,
  updateLesson,
} from '../storage/lessons';
import type { LessonScope, StoredLesson } from '../storage/types';
import { findDecision, normaliseLesson } from './match';

/** A decision on a proposed lesson. */
export interface LessonDecisionInput {
  /** The session whose notes proposed it. */
  sessionId: string;
  /** The proposal, as the notes have it. */
  proposal: ProposedLesson;
  /** Approve or reject. */
  status: 'approved' | 'rejected';
  /** The text to keep (the proposal, possibly edited); cleaned before saving. */
  text: string;
  /** Which sessions it applies to. */
  scope: LessonScope;
}

/**
 * Approves or rejects a proposed lesson. When the user already decided on the same (or a
 * reworded) proposal from this session, that decision is changed, never duplicated. An
 * approval keeps its first approval time, so its place in the rules block does not move.
 *
 * @param input See LessonDecisionInput.
 * @param now   Clock (Unix ms); tests pass their own.
 * @returns The stored decision.
 * @throws Error('EMPTY_LESSON') when the cleaned text is empty.
 * Called from: the review page (Approve / Reject); tests
 */
export async function decideLesson(
  input: LessonDecisionInput,
  now = Date.now(),
): Promise<StoredLesson> {
  const text = cleanLessonText(input.text);
  if (!text) throw new Error('EMPTY_LESSON');
  const earlier = findDecision(
    input.proposal.text,
    input.sessionId,
    await listLessonsForSession(input.sessionId),
  );
  const approved = input.status === 'approved';
  const lesson: StoredLesson = earlier
    ? {
        ...earlier,
        text,
        scope: input.scope,
        status: input.status,
        approvedAt: approved ? (earlier.approvedAt ?? now) : null,
      }
    : {
        id: crypto.randomUUID(),
        text,
        scope: input.scope,
        status: input.status,
        sourceSessionId: input.sessionId,
        sourceKey: normaliseLesson(input.proposal.text),
        evidence: input.proposal.evidence,
        decidedAt: now,
        approvedAt: approved ? now : null,
      };
  await saveLesson(lesson);
  return lesson;
}

/**
 * Edits a decided lesson's text and scope (Settings, or the review page).
 *
 * @param id    The lesson.
 * @param text  The new text; cleaned before saving.
 * @param scope The new scope.
 * @returns Resolves when saved.
 * @throws Error('EMPTY_LESSON') when the cleaned text is empty.
 * Called from: Settings (What Kite has learned); tests
 */
export async function editLesson(id: string, text: string, scope: LessonScope): Promise<void> {
  const cleaned = cleanLessonText(text);
  if (!cleaned) throw new Error('EMPTY_LESSON');
  await updateLesson(id, { text: cleaned, scope });
}

/**
 * Removes a decision: an approved lesson stops being sent; the proposal can be decided again.
 *
 * @param id The lesson.
 * @returns Resolves when removed.
 * Called from: Settings (Delete), the review page (Undo); tests
 */
export function removeLesson(id: string): Promise<void> {
  return deleteLesson(id);
}

/**
 * Removes every decision ("Clear all lessons").
 *
 * @returns How many were removed.
 * Called from: Settings; tests
 */
export function clearLessons(): Promise<number> {
  return deleteAllLessons();
}
