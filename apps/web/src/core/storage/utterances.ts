/**
 * File: apps/web/src/core/storage/utterances.ts
 * Purpose: Save and list a session's final transcript lines on this device.
 * Used by: the live screen (Day 3 Stage 4), the session review page (Day 5)
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (if "save transcript" is off,
 *               lines stay in memory only), §8.1; day-03-sessions.md Stage 1
 *
 * This module does not check the session's saveTranscript setting: the live screen calls
 * saveUtterance() only when it is on, and never for echo lines. Transcript text is never logged.
 */
import { getDb } from './db';
import type { StoredUtterance } from './types';

/**
 * Saves a final transcript line, or replaces it when a line with the same id exists (a line
 * that was merged with the next one is saved again under its id).
 *
 * Only call this when the session's saveTranscript is on, and never for echo lines.
 *
 * @param utterance The line, with an id unique across all sessions.
 * Called from: the live screen when a final line arrives (Day 3 Stage 4); tests
 */
export async function saveUtterance(utterance: StoredUtterance): Promise<void> {
  await getDb().utterances.put(utterance);
}

/**
 * Lists a session's saved transcript lines in the order they were spoken.
 *
 * @param sessionId The session id.
 * @returns The lines, by start time ([] when none were saved).
 * Called from: the live screen (saved lines of an earlier call, Day 3 Stage 4), the review
 *              page (Day 5); tests
 */
export async function listUtterances(sessionId: string): Promise<StoredUtterance[]> {
  return getDb().utterances.where('sessionId').equals(sessionId).sortBy('tStart');
}
