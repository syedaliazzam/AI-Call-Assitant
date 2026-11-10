/**
 * File: apps/web/src/core/recording/reconcile.ts
 * Purpose: Brings the account's recording records up to date with the files on this computer (desktop
 *          1.5.0, ADR-0068). A recording the app finalised after a crash or a quit ('recovered'), or one
 *          whose length and size were not yet in its record, gets them now. Only records made on this
 *          computer are touched, and a record the account no longer has (its session was deleted) is
 *          never made again.
 * Used by: src/features/meetings/MeetingsPage.tsx, src/features/home/Launcher.tsx (desktop app)
 * Depends on: src/platform (RecordingHost), src/core/storage/recordings.ts, @kite/shared
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 */
import type { LocalRecording } from '@kite/shared';
import type { RecordingHost } from '@/platform';
import { listRecordings, updateRecording } from '@/core/storage/recordings';
import type { StoredRecording } from '@/core/storage/types';

/**
 * The changes one record needs to match the file on this computer.
 * @param record The account's record.
 * @param local  The shell's entry.
 * @returns The fields to change, or null when they already match (or the file is still being written).
 * Called from: reconcileRecordings(); tests
 */
export function recordingChanges(
  record: StoredRecording,
  local: LocalRecording,
): Partial<StoredRecording> | null {
  // Being written, or gone from the folder: the record keeps what it says.
  if (local.status === 'recording' || local.status === 'missing') return null;
  const changes: Partial<StoredRecording> = {};
  if (record.status !== local.status) changes.status = local.status;
  if (local.durationMs > 0 && record.durationMs !== local.durationMs) {
    changes.durationMs = local.durationMs;
  }
  if (local.bytes > 0 && record.bytes !== local.bytes) changes.bytes = local.bytes;
  if (record.fileName !== local.fileName) changes.fileName = local.fileName;
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Updates this computer's recording records from the shell's index.
 * @param host The recording host.
 * @returns How many records changed.
 * Called from: MeetingsPage.tsx, Launcher.tsx; tests
 */
export async function reconcileRecordings(host: RecordingHost): Promise<number> {
  const [device, local, records] = await Promise.all([
    host.device(),
    host.list(),
    listRecordings(),
  ]);
  const byId = new Map(local.map((entry) => [entry.id, entry]));
  let changed = 0;
  for (const record of records) {
    if (record.deviceId !== device.id) continue;
    const entry = byId.get(record.id);
    if (!entry) continue;
    const changes = recordingChanges(record, entry);
    if (changes && (await updateRecording(record.id, changes))) changed += 1;
  }
  return changed;
}
