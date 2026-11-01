/**
 * File: apps/web/src/core/lessons/active.ts
 * Purpose: Picks the lessons sent with a session's answers (Day 5 Stage 7): approved, for
 *          every session or this session's type, in approval order (oldest first), at most
 *          MAX_ACTIVE_LESSONS (the newest approvals). The order is stable, so the cached rules
 *          block changes only when a lesson is approved, edited or removed.
 * Used by: src/features/live/LiveSession.tsx (loaded once when the session opens)
 * Depends on: @kite/shared (MAX_ACTIVE_LESSONS), src/core/storage/lessons.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (caching), §7.6
 */
import { MAX_ACTIVE_LESSONS } from '@kite/shared';
import { listLessons } from '../storage/lessons';
import type { SessionType, StoredLesson } from '../storage/types';

/**
 * The lesson texts for a session type.
 *
 * @param lessons     Every stored decision.
 * @param sessionType The session's type.
 * @returns The texts, oldest approval first (ties by id), at most MAX_ACTIVE_LESSONS.
 * Called from: loadActiveLessons(); tests
 */
export function activeLessons(
  lessons: readonly StoredLesson[],
  sessionType: SessionType,
): string[] {
  return lessons
    .filter(
      (lesson) =>
        lesson.status === 'approved' &&
        lesson.approvedAt !== null &&
        (lesson.scope === 'all' || lesson.scope === sessionType),
    )
    .sort((a, b) => a.approvedAt! - b.approvedAt! || a.id.localeCompare(b.id))
    .slice(-MAX_ACTIVE_LESSONS)
    .map((lesson) => lesson.text);
}

/**
 * Loads the lesson texts for a session type from this device. Never throws: on a storage
 * failure answers simply go without lessons.
 *
 * @param sessionType The session's type.
 * @returns The texts (see activeLessons()).
 * Called from: LiveSession.tsx (when the session opens)
 */
export async function loadActiveLessons(sessionType: SessionType): Promise<string[]> {
  try {
    return activeLessons(await listLessons(), sessionType);
  } catch {
    return [];
  }
}
