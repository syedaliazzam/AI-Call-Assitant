/**
 * File: apps/web/src/core/drive/waitWords.ts
 * Purpose: The words for a recorded call whose Google Drive upload has not finished (ADR-0106). The file
 *          is only on the computer that recorded the call, and only that computer's desktop app can upload
 *          it, so the words say so ("Waiting for the desktop app to finish the upload") instead of a
 *          generic "Uploading…". When that app has not worked on the upload for UPLOAD_STALL_MS, they say
 *          what to do: "Upload paused: open the desktop app on the computer used for this call".
 * Used by: src/core/meetings/library.ts (recordingStatus), src/features/review/CallsList.tsx (callDriveText)
 * Depends on: src/core/storage/types.ts (types only)
 * Architecture: docs/decisions/ADR-0106-background-upload-on-exit.md; ADR-0077 (call records)
 */
import type { StoredCall } from '../storage/types';

/** How long the uploading app may be silent before the upload counts as paused, ms (24 hours). */
export const UPLOAD_STALL_MS = 24 * 60 * 60_000;

/** The upload is on its way: the desktop app that recorded the call has the file. */
export const WAITING_FOR_DESKTOP = 'Waiting for the desktop app to finish the upload';

/** Nothing has moved for a day: the person has to open the app on that computer. */
export const UPLOAD_PAUSED_OPEN_APP =
  'Upload paused: open the desktop app on the computer used for this call';

/**
 * Whether a call's upload is still on its way (queued, uploading, paused for a call, or about to be queued
 * once its notes are written). A wait for the person (Drive not connected) or an error is not.
 *
 * @param drive The call's Drive state.
 * @returns True while it is on its way.
 * Called from: pendingUpload(); core/meetings/library.ts
 */
export function uploadOnItsWay(drive: Pick<StoredCall['drive'], 'state' | 'reason'>): boolean {
  return (
    drive.state === 'queued' ||
    drive.state === 'uploading' ||
    drive.state === 'paused' ||
    (drive.state === 'waiting' && !drive.reason)
  );
}

/**
 * Where a recorded call's unfinished upload stands, for the dashboard and Meetings.
 *
 * @param record The call record (its Drive state, when the uploading app last worked on it, and when the
 *               record last changed, for records written before movedAt existed).
 * @param now    The clock (Unix ms).
 * @returns 'waiting' (on its way), 'stalled' (nothing for UPLOAD_STALL_MS), or null when it is not on its
 *          way (saved, off, waiting for the person, an error).
 * Called from: core/meetings/library.ts recordingStatus(), features/review/CallsList.tsx; tests
 */
export function pendingUpload(
  record: Pick<StoredCall, 'drive' | 'updatedAt'>,
  now: number,
): 'waiting' | 'stalled' | null {
  if (!uploadOnItsWay(record.drive)) return null;
  const movedAt = record.drive.movedAt ?? record.updatedAt;
  return now - movedAt >= UPLOAD_STALL_MS ? 'stalled' : 'waiting';
}
