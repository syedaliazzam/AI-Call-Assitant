/**
 * File: apps/web/src/core/drive/localWork.ts
 * Purpose: The Google Drive work this computer still has to do by itself (desktop 1.7.2, ADR-0106), as a
 *          DriveQueueReport the desktop shell keeps: when the user exits with work left, the shell closes
 *          its windows and runs on (with its tray icon) until it is done. Counted: call uploads that move
 *          by themselves (queued, uploading, paused for a call, or an error that is retried by itself),
 *          the older per-session uploads likewise, and this device's calls that ended recently and whose
 *          upload is not queued yet (their notes are still being written). Not counted: work that waits
 *          for the person (Drive not connected, a file that failed too often, a non-retryable error).
 *          The report holds counts and bytes only: no ids, names or content.
 * Used by: src/features/drive/DriveUploader.tsx (desktop only); tests
 * Depends on: dexie (liveQuery), @kite/shared (DriveQueueReport, LocalRecording),
 *             src/core/storage/{db,types}.ts, src/core/drive/{callUploader,queue}.ts, src/core/live/deviceId.ts
 * Architecture: docs/decisions/ADR-0106-background-upload-on-exit.md; ADR-0072, ADR-0077
 */
import type { DriveQueueReport, LocalRecording } from '@kite/shared';
import { liveQuery } from 'dexie';
import { thisDeviceId } from '../live/deviceId';
import { getDb } from '../storage/db';
import type { DriveCallJob, DriveFileJob, DriveSessionJob, StoredCall } from '../storage/types';
import { MAX_FILE_FAILURES } from './callUploader';
import { rememberedSaves } from './queue';

/**
 * How recent a call must be for its not-yet-queued upload to count, ms. An old call stuck before its
 * upload was queued is left to the after-call runner at a normal start; it never keeps the app running.
 */
export const RECENT_CALL_MS = 2 * 24 * 60 * 60_000;

/** What localDriveWork() reads. */
export interface LocalWorkInput {
  /** This profile's call records (only this device's are looked at). */
  calls: readonly StoredCall[];
  /** The per-call uploads (ADR-0077). */
  callJobs: readonly DriveCallJob[];
  /** The older per-session uploads (ADR-0072). */
  sessionJobs: readonly DriveSessionJob[];
  /** This computer's recordings (the shell's index). */
  recordings: readonly LocalRecording[];
  /** This device's id (core/live/deviceId.ts). */
  deviceId: string;
  /** Whether the account saves to Drive, as this device last saw it (a call not queued yet uploads then). */
  saves: boolean;
  /** The clock, Unix ms. */
  now: number;
}

/**
 * Whether an upload job moves without the person: queued, uploading, paused for a call, or an error that
 * is retried by itself. A job waiting for the person (Drive not connected, no folder) does not.
 *
 * @param job The job's state, reason and retry flag.
 * @returns True when it moves by itself.
 * Called from: localDriveWork(); tests
 */
export function movesByItself(
  job: Pick<DriveCallJob, 'state' | 'autoRetry'> | Pick<DriveSessionJob, 'state' | 'autoRetry'>,
): boolean {
  return (
    job.state === 'queued' ||
    job.state === 'uploading' ||
    job.state === 'paused' ||
    (job.state === 'error' && job.autoRetry === true)
  );
}

/**
 * Whether a recording file of a job is still to go (not done, and not given up on).
 *
 * @param file The file.
 * @returns True when it is still to go.
 */
function fileLeft(file: DriveFileJob): boolean {
  return Boolean(file.recordingId) && !file.done && (file.failures ?? 0) < MAX_FILE_FAILURES;
}

/**
 * Whether a call record of this device still has its notes or its upload to come (the after-call
 * runner queues the upload once the notes are settled).
 *
 * @param call The call record.
 * @returns True while its upload is still to be queued.
 */
function uploadStillToCome(call: StoredCall): boolean {
  if (call.drive.state === 'waiting' && !call.drive.reason) return true;
  return call.drive.state !== 'off' && (call.phase !== 'ended' || call.notesState === 'writing');
}

/**
 * The work left.
 *
 * @param input See LocalWorkInput.
 * @returns The report (counts and bytes only).
 * Called from: watchLocalDriveWork(); tests
 */
export function localDriveWork(input: LocalWorkInput): DriveQueueReport {
  // By file key ('rec:<id>:main'): the same recording may be in a call job and an older session job.
  const files = new Map<string, { sent: number; bytes: number }>();
  const calls = new Set<string>();
  /**
   * Adds this computer's finished recordings of a call that the job has not listed yet.
   * @param callId The call (recordings carry it as meetingId).
   */
  const addRecordingsOf = (callId: string) => {
    for (const recording of input.recordings) {
      if (recording.meetingId !== callId || recording.status === 'missing') continue;
      const key = `rec:${recording.id}:main`;
      if (!files.has(key)) files.set(key, { sent: 0, bytes: recording.bytes });
    }
  };

  const queued = new Set<string>();
  for (const job of input.callJobs) {
    queued.add(job.callId);
    if (!movesByItself(job)) continue;
    calls.add(`call:${job.callId}`);
    for (const file of job.files) {
      if (fileLeft(file)) files.set(file.key, { sent: file.sent, bytes: file.bytes });
    }
    // Files are listed at the job's first turn; until then its recordings come from the index. A file
    // already done keeps its key in the job, so it is not added again here.
    const listed = new Set(job.files.map((file) => file.key));
    for (const recording of input.recordings) {
      const key = `rec:${recording.id}:main`;
      if (
        recording.meetingId === job.callId &&
        !listed.has(key) &&
        recording.status !== 'missing'
      ) {
        files.set(key, { sent: 0, bytes: recording.bytes });
      }
    }
  }
  for (const job of input.sessionJobs) {
    if (!movesByItself(job)) continue;
    calls.add(`session:${job.sessionId}`);
    for (const file of job.files) {
      if (fileLeft(file)) files.set(file.key, { sent: file.sent, bytes: file.bytes });
    }
  }
  if (input.saves) {
    for (const call of input.calls) {
      if (call.deviceId !== input.deviceId || queued.has(call.id)) continue;
      if (input.now - call.startedAt > RECENT_CALL_MS || !uploadStillToCome(call)) continue;
      calls.add(`call:${call.id}`);
      addRecordingsOf(call.id);
    }
  }

  let sent = 0;
  let total = 0;
  for (const file of files.values()) {
    total += Math.max(0, file.bytes);
    sent += Math.min(Math.max(0, file.sent), Math.max(0, file.bytes));
  }
  return { calls: calls.size, recordings: files.size, sent, total };
}

/**
 * Keeps the report up to date: Dexie reports every change to the calls and uploads (made in any window of
 * this profile), and each one is reported, also when the counts stay the same: a call that just ended
 * and has nothing to upload must still tell the shell so (it waits for a report after the call's end).
 *
 * @param recordings This computer's recordings (the shell's index).
 * @param onReport   Called with each new report.
 * @returns A function that stops watching.
 * Called from: features/drive/DriveUploader.tsx
 */
export function watchLocalDriveWork(
  recordings: () => Promise<LocalRecording[]>,
  onReport: (report: DriveQueueReport) => void,
): () => void {
  let stopped = false;
  const subscription = liveQuery(async () => {
    const db = getDb();
    const [calls, callJobs, sessionJobs] = await Promise.all([
      db.calls.toArray(),
      db.driveCallJobs.toArray(),
      db.driveUploads.toArray(),
    ]);
    return { calls, callJobs, sessionJobs };
  }).subscribe({
    next: (tables) => {
      // The shell's index is read outside the live query (it is not in this database).
      void recordings()
        .catch(() => [] as LocalRecording[])
        .then((list) => {
          if (stopped) return;
          const report = localDriveWork({
            ...tables,
            recordings: list,
            deviceId: thisDeviceId(),
            saves: rememberedSaves(),
            now: Date.now(),
          });
          onReport(report);
        });
    },
    error: () => undefined,
  });
  return () => {
    stopped = true;
    subscription.unsubscribe();
  };
}
