/**
 * File: apps/web/src/core/storage/driveCallJobs.ts
 * Purpose: Each call's Google Drive upload on this device (ADR-0077; the `driveCallJobs` store, version
 *          12, never synced): queue a call once its notes are settled (or from "Upload N earlier calls"),
 *          read and change a job, pick the next one to work on, Retry, and forget it.
 * Used by: src/core/drive/{callUploader,runner,queue,earlierCalls}.ts, src/core/live/afterCall.ts,
 *          src/core/storage/driveUploads.ts (the per-session summary the cards show)
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: ADR-0077
 */
import { getDb } from './db';
import type { DriveCallJob } from './types';

/** The states a job is worked on in (an 'uploading' one was cut off by a closed window or a crash). */
const ACTIVE_STATES: readonly DriveCallJob['state'][] = ['queued', 'uploading', 'paused'];

/** What queueCallJob() needs to know about the call. */
export interface CallJobInput {
  /** The call. */
  callId: string;
  /** Its session. */
  sessionId: string;
  /** When it started (Unix ms). */
  startedAt: number;
  /** When it ended (Unix ms). */
  endedAt: number;
  /** How its recordings are found (DriveCallJob.recordingMatch). */
  recordingMatch: DriveCallJob['recordingMatch'];
  /** Why it is queued (DriveCallJob.origin). */
  origin: DriveCallJob['origin'];
}

/**
 * Queues one call's upload. A call already queued keeps its job (and its saved files), so queueing twice
 * never uploads twice; a finished or failed one is queued again (for a recording finalised later).
 *
 * @param input The call.
 * @param now   The clock.
 * @returns The job.
 * Called from: core/live/afterCall.ts, core/drive/earlierCalls.ts; tests
 */
export async function queueCallJob(
  input: CallJobInput,
  now: number = Date.now(),
): Promise<DriveCallJob> {
  const db = getDb();
  return db.transaction('rw', db.driveCallJobs, async () => {
    const existing = await db.driveCallJobs.get(input.callId);
    const job: DriveCallJob = existing
      ? {
          ...existing,
          endedAt: Math.max(existing.endedAt, input.endedAt),
          state: existing.state === 'uploading' ? existing.state : 'queued',
          reason: undefined,
          autoRetry: undefined,
          updatedAt: now,
        }
      : {
          ...input,
          files: [],
          state: 'queued',
          callFilesReported: false,
          reportedFiles: 0,
          notified: false,
          noticeShown: false,
          queuedAt: now,
          updatedAt: now,
        };
    await db.driveCallJobs.put(job);
    return job;
  });
}

/**
 * One call's upload.
 *
 * @param callId The call.
 * @returns The job, or null.
 * Called from: core/drive/*; tests
 */
export async function getCallJob(callId: string): Promise<DriveCallJob | null> {
  return (await getDb().driveCallJobs.get(callId)) ?? null;
}

/**
 * Every call upload on this device, newest change first.
 *
 * @returns The jobs.
 * Called from: core/drive/runner.ts, core/drive/earlierCalls.ts, driveUploads.ts; tests
 */
export async function listCallJobs(): Promise<DriveCallJob[]> {
  return (await getDb().driveCallJobs.toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Saves a job whole (the uploader's progress). A job deleted meanwhile (its session was deleted) is not
 * brought back.
 *
 * @param job The job.
 * @returns When saved.
 * Called from: core/drive/callUploader.ts (through the runner); tests
 */
export async function putCallJob(job: DriveCallJob): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.driveCallJobs, async () => {
    if (!(await db.driveCallJobs.get(job.callId))) return;
    await db.driveCallJobs.put(job);
  });
}

/**
 * The next call upload to work on: the oldest queued (or cut-off) one.
 *
 * @returns The job, or null when none waits.
 * Called from: core/drive/runner.ts; tests
 */
export async function nextCallJob(): Promise<DriveCallJob | null> {
  const jobs = await getDb()
    .driveCallJobs.where('state')
    .anyOf([...ACTIVE_STATES])
    .toArray();
  return jobs.sort((a, b) => a.queuedAt - b.queuedAt)[0] ?? null;
}

/**
 * Queues again the call uploads that wait for the person or stopped with an error (Retry, a reconnect).
 * Each file that failed gets its tries back.
 *
 * @param sessionId Only this session's jobs; omit for all.
 * @param now       The clock.
 * @returns How many were queued.
 * Called from: core/drive/queue.ts (retryDriveUpload), driveUploads.ts; tests
 */
export async function requeueCallJobs(
  sessionId?: string,
  now: number = Date.now(),
): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.driveCallJobs, async () => {
    const jobs = sessionId
      ? await db.driveCallJobs.where('sessionId').equals(sessionId).toArray()
      : await db.driveCallJobs.where('state').anyOf(['waiting', 'error']).toArray();
    let count = 0;
    for (const job of jobs) {
      if (job.state !== 'waiting' && job.state !== 'error') continue;
      await db.driveCallJobs.put({
        ...job,
        files: job.files.map((file) => ({ ...file, failures: undefined, error: undefined })),
        state: 'queued',
        reason: undefined,
        autoRetry: undefined,
        updatedAt: now,
      });
      count += 1;
    }
    return count;
  });
}

/**
 * Marks a session's finished call uploads' notice as shown on this device.
 *
 * @param sessionId The session.
 * @returns When saved.
 * Called from: driveUploads.ts (markDriveNoticeShown); tests
 */
export async function markCallNoticesShown(sessionId: string): Promise<void> {
  await getDb().driveCallJobs.where('sessionId').equals(sessionId).modify({ noticeShown: true });
}

/**
 * Forgets one call's upload (its session was deleted; Drive keeps what was saved).
 *
 * @param callId The call.
 * @returns When done.
 * Called from: core/drive/runner.ts; tests
 */
export async function deleteCallJob(callId: string): Promise<void> {
  await getDb().driveCallJobs.delete(callId);
}
