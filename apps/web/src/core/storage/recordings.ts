/**
 * File: apps/web/src/core/storage/recordings.ts
 * Purpose: The account's recording records (desktop 1.5.0, ADR-0068): one small record per recording
 *          part (when, how long, how big, the file's name, which computer). They sync with the account
 *          like the other call data and go with their session; the video and sound never do.
 * Used by: src/features/live/useCallRecording.ts (writes while recording), src/core/recording/reconcile.ts,
 *          src/features/meetings/* (lists, deletes)
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; architecture §7.4
 */
import { liveQuery } from 'dexie';
import { getDb } from './db';
import type { StoredRecording } from './types';

/**
 * Saves a recording record (adds it, or replaces it whole).
 * @param recording The record.
 * @returns When saved.
 * Called from: features/live/useCallRecording.ts, core/recording/reconcile.ts; tests
 */
export async function saveRecording(recording: StoredRecording): Promise<void> {
  await getDb().recordings.put(recording);
}

/**
 * Changes some fields of a recording record (nothing happens when it is gone, for example deleted on
 * another device).
 * @param id      The record's id.
 * @param changes The fields to change; updatedAt is set here.
 * @returns True when the record was there.
 * Called from: features/live/useCallRecording.ts, core/recording/reconcile.ts; tests
 */
export async function updateRecording(
  id: string,
  changes: Partial<Omit<StoredRecording, 'id' | 'updatedAt'>>,
): Promise<boolean> {
  const count = await getDb().recordings.update(id, { ...changes, updatedAt: Date.now() });
  return count > 0;
}

/**
 * One recording record.
 * @param id The record's id.
 * @returns The record, or null.
 * Called from: features/meetings/RecordingPlayer.tsx; tests
 */
export async function getRecording(id: string): Promise<StoredRecording | null> {
  return (await getDb().recordings.get(id)) ?? null;
}

/**
 * Every recording record, newest first.
 * @returns The records.
 * Called from: features/meetings/MeetingsPage.tsx, core/recording/reconcile.ts; tests
 */
export async function listRecordings(): Promise<StoredRecording[]> {
  return getDb().recordings.orderBy('startedAt').reverse().toArray();
}

/**
 * The records of one meeting, first part first.
 * @param meetingId The meeting.
 * @returns The records.
 * Called from: features/meetings/RecordingPlayer.tsx; tests
 */
export async function listMeetingParts(meetingId: string): Promise<StoredRecording[]> {
  const parts = await getDb().recordings.where('meetingId').equals(meetingId).toArray();
  return parts.sort((a, b) => a.part - b.part);
}

/**
 * Removes a recording record (the desktop app moves the files to the Recycle Bin first).
 * @param id The record's id.
 * @returns When removed.
 * Called from: features/meetings/RecordingPlayer.tsx; tests
 */
export async function deleteRecording(id: string): Promise<void> {
  await getDb().recordings.delete(id);
}

/**
 * Keeps the list of recording records up to date (the Meetings page): Dexie reports a change made in any
 * window of this profile, and the sync engine's pulls land here too.
 * @param onRecordings Called with the records, newest first, now and after every change.
 * @param onError      Called when they cannot be read.
 * @returns A function that stops watching.
 * Called from: features/meetings/MeetingsPage.tsx; tests
 */
export function watchRecordings(
  onRecordings: (recordings: StoredRecording[]) => void,
  onError: () => void,
): () => void {
  const subscription = liveQuery(() => listRecordings()).subscribe({
    next: onRecordings,
    error: onError,
  });
  return () => subscription.unsubscribe();
}
