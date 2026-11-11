/**
 * File: apps/web/src/core/storage/driveUploads.ts
 * Purpose: Each session's Google Drive upload on this device (ADR-0072; the `driveUploads` store,
 *          version 11, never synced): queue a call when it ends, read and change a job, pick the next
 *          one to work on, Retry, and watch them for the progress shown on session cards and Meetings.
 * Used by: src/core/drive/uploader.ts, src/core/drive/queue.ts, src/features/drive/*
 * Depends on: dexie (liveQuery), src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: ADR-0072; architecture §7.4
 */
import { liveQuery } from 'dexie';
import { getDb } from './db';
import type { DriveCall, DriveSessionJob } from './types';

/** The states a job is worked on in (an 'uploading' one was cut off by a closed window or a crash). */
const ACTIVE_STATES: readonly DriveSessionJob['state'][] = ['queued', 'uploading', 'paused'];

/**
 * Adds a finished call to its session's upload (making the job when it is the first), and queues it.
 * The same call twice is kept once. A finished job goes back to the queue for the new call's files;
 * its folders and saved files stay, so nothing is uploaded twice.
 *
 * @param sessionId The session.
 * @param call      The call's start and end.
 * @param now       The clock.
 * @returns The job.
 * Called from: src/core/drive/queue.ts (the live page's End); tests
 */
export async function queueDriveCall(
  sessionId: string,
  call: DriveCall,
  now: number = Date.now(),
): Promise<DriveSessionJob> {
  const db = getDb();
  return db.transaction('rw', db.driveUploads, async () => {
    const existing = await db.driveUploads.get(sessionId);
    const calls = existing?.calls ?? [];
    const job: DriveSessionJob = {
      sessionId,
      files: [],
      notified: false,
      reportedFiles: 0,
      queuedAt: now,
      ...existing,
      calls: calls.some((known) => known.startedAt === call.startedAt)
        ? calls
        : [...calls, call].sort((a, b) => a.startedAt - b.startedAt),
      state: 'queued',
      reason: undefined,
      noticeShown: false,
      updatedAt: now,
    };
    await db.driveUploads.put(job);
    return job;
  });
}

/**
 * One session's upload.
 *
 * @param sessionId The session.
 * @returns The job, or null.
 * Called from: uploader.ts; tests
 */
export async function getDriveJob(sessionId: string): Promise<DriveSessionJob | null> {
  return (await getDb().driveUploads.get(sessionId)) ?? null;
}

/**
 * Every upload on this device, newest change first.
 *
 * @returns The jobs.
 * Called from: watchDriveJobs(); uploader.ts; tests
 */
export async function listDriveJobs(): Promise<DriveSessionJob[]> {
  return (await getDb().driveUploads.toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Saves a job whole (the uploader's progress). A call queued meanwhile (the live page's End can queue
 * one while the uploader works on an older copy of the job) is kept: its call is merged in, and a job the
 * uploader thought finished goes back to the queue for it. A job deleted meanwhile is not brought back.
 *
 * @param job The job.
 * @returns When saved.
 * Called from: uploader.ts; tests
 */
export async function putDriveJob(job: DriveSessionJob): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.driveUploads, async () => {
    const current = await db.driveUploads.get(job.sessionId);
    const added = (current?.calls ?? []).filter(
      (call) => !job.calls.some((known) => known.startedAt === call.startedAt),
    );
    if (added.length === 0) {
      await db.driveUploads.put(job);
      return;
    }
    await db.driveUploads.put({
      ...job,
      calls: [...job.calls, ...added].sort((a, b) => a.startedAt - b.startedAt),
      state: job.state === 'done' || job.state === 'uploading' ? 'queued' : job.state,
      noticeShown: false,
    });
  });
}

/**
 * The next job to work on: the oldest queued (or cut-off) one.
 *
 * @returns The job, or null when none waits.
 * Called from: uploader.ts (runDriveQueue); tests
 */
export async function nextDriveJob(): Promise<DriveSessionJob | null> {
  const jobs = await getDb()
    .driveUploads.where('state')
    .anyOf([...ACTIVE_STATES])
    .toArray();
  return jobs.sort((a, b) => a.queuedAt - b.queuedAt)[0] ?? null;
}

/**
 * Queues every job that waits for the person or stopped with an error (Retry, or a reconnect).
 *
 * @param sessionId Only this session's job; omit for all waiting and failed jobs.
 * @param now       The clock.
 * @returns How many were queued.
 * Called from: features/drive (Retry), uploader.ts (after a reconnect); tests
 */
export async function requeueDriveJobs(
  sessionId?: string,
  now: number = Date.now(),
): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.driveUploads, async () => {
    const jobs = sessionId
      ? [await db.driveUploads.get(sessionId)].filter((job) => !!job)
      : await db.driveUploads.where('state').anyOf(['waiting', 'error']).toArray();
    let count = 0;
    for (const job of jobs) {
      if (job.state !== 'waiting' && job.state !== 'error') continue;
      await db.driveUploads.put({ ...job, state: 'queued', reason: undefined, updatedAt: now });
      count += 1;
    }
    return count;
  });
}

/**
 * Marks a finished job's notice as shown on this device.
 *
 * @param sessionId The session.
 * @returns When saved.
 * Called from: features/drive/DriveNotices.tsx; tests
 */
export async function markDriveNoticeShown(sessionId: string): Promise<void> {
  await getDb().driveUploads.update(sessionId, { noticeShown: true });
}

/**
 * Forgets a session's upload (the session was deleted; Drive keeps what was saved).
 *
 * @param sessionId The session.
 * @returns When done.
 * Called from: uploader.ts; tests
 */
export async function deleteDriveJob(sessionId: string): Promise<void> {
  await getDb().driveUploads.delete(sessionId);
}

/**
 * Keeps the list of uploads up to date (session cards, Meetings, notices): Dexie reports a change made
 * in any window of this profile.
 *
 * @param onJobs  Called with the jobs now and after every change.
 * @param onError Called when they cannot be read.
 * @returns A function that stops watching.
 * Called from: features/drive/useDriveJobs.ts; tests
 */
export function watchDriveJobs(
  onJobs: (jobs: DriveSessionJob[]) => void,
  onError: () => void,
): () => void {
  const subscription = liveQuery(() => listDriveJobs()).subscribe({ next: onJobs, error: onError });
  return () => subscription.unsubscribe();
}
