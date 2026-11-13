/**
 * File: apps/web/src/core/storage/driveUploads.ts
 * Purpose: Each session's Google Drive upload on this device (ADR-0072; the `driveUploads` store,
 *          version 11, never synced): queue a call when it ends, read and change a job, pick the next
 *          one to work on, Retry, and watch them for the progress shown on session cards and Meetings.
 *          ADR-0073: each call keeps its own report flags (withCallFlags), for its own email.
 *          ADR-0077: new calls get their own job (driveCallJobs.ts); these older per-session jobs only
 *          finish their unfinished files. The cards and notices read one summary per session of both.
 * Used by: src/core/drive/uploader.ts, src/core/drive/queue.ts, src/features/drive/*
 * Depends on: dexie (liveQuery), src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: ADR-0072, ADR-0073; architecture §7.4
 */
import { liveQuery } from 'dexie';
import { getDb } from './db';
import { listCallJobs, markCallNoticesShown } from './driveCallJobs';
import type { DriveCall, DriveCallJob, DriveSessionJob } from './types';

/** The states a job is worked on in (an 'uploading' one was cut off by a closed window or a crash). */
const ACTIVE_STATES: readonly DriveSessionJob['state'][] = ['queued', 'uploading', 'paused'];

/**
 * ADR-0073 (each call has its own email): gives every call of a job its own report flags. A call queued
 * before the change has none: when its job was already reported under the session's single email
 * (notified, with files the server heard of) it is closed, never reported again, so it can never send a
 * second email; otherwise (a job still uploading, or one from before the combined email, which is
 * reported once more for "Send email") it starts unreported, as a new call does.
 *
 * @param job The job.
 * @returns The job with every call's flags (the same object when nothing changed).
 * Called from: queueDriveCall(); src/core/drive/uploader.ts (runDriveQueue, reportDue); tests
 */
export function withCallFlags(job: DriveSessionJob): DriveSessionJob {
  if (job.calls.every((call) => call.notified !== undefined)) return job;
  const reportedBefore = job.notified && (job.reportedFiles ?? 0) > 0;
  return {
    ...job,
    calls: job.calls.map((call) => {
      if (call.notified !== undefined) return call;
      return reportedBefore
        ? { ...call, reportedFiles: 0, notified: true, closed: true }
        : { ...call, reportedFiles: 0, notified: false };
    }),
  };
}

/**
 * Adds a finished call to its session's upload (making the job when it is the first), and queues it.
 * The same call twice is kept once. A finished job goes back to the queue for the new call's files;
 * its folders and saved files stay, so nothing is uploaded twice.
 *
 * @param sessionId The session.
 * @param call      The call's start and end.
 * @param now       The clock.
 * @returns The job.
 * Called from: tests (ADR-0077: calls are no longer added to these jobs; they get their own,
 *              driveCallJobs.ts)
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
      // ADR-0073: a new call (also a session started again after it ended) gets its own email, so it
      // starts unreported; the calls already there are settled first, so none of them is mistaken for
      // a new one.
      calls: calls.some((known) => known.startedAt === call.startedAt)
        ? calls
        : [
            ...(existing ? withCallFlags(existing).calls : []),
            { ...call, reportedFiles: 0, notified: false },
          ].sort((a, b) => a.startedAt - b.startedAt),
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
 * Marks a session's finished uploads' notice as shown on this device: its older per-session job and
 * (ADR-0077) its calls' jobs.
 *
 * @param sessionId The session.
 * @returns When saved.
 * Called from: features/drive/DriveNotices.tsx; tests
 */
export async function markDriveNoticeShown(sessionId: string): Promise<void> {
  await getDb().driveUploads.update(sessionId, { noticeShown: true });
  await markCallNoticesShown(sessionId);
}

/** Which state wins when a session's jobs are shown as one line (the first that any job is in). */
const SUMMARY_ORDER: readonly DriveSessionJob['state'][] = [
  'uploading',
  'queued',
  'paused',
  'waiting',
  'error',
  'done',
];

/**
 * ADR-0077: a session's uploads as one job, for the session cards, Meetings and the notices, which show one
 * line per session: its older per-session job (if any) and its calls' jobs. The line says what the busiest
 * job does (uploading before waiting before an error before done); its files are every job's files, its
 * folder the first one known, and its notice is shown until every finished job's notice was.
 *
 * @param legacy The session's older job, or undefined.
 * @param calls  Its calls' jobs.
 * @returns The summary, or undefined when the session has no upload on this device.
 * Called from: listSessionDriveSummaries(); tests
 */
export function summariseSessionJobs(
  legacy: DriveSessionJob | undefined,
  calls: readonly DriveCallJob[],
): DriveSessionJob | undefined {
  if (calls.length === 0) return legacy;
  const all: (DriveSessionJob | DriveCallJob)[] = [...(legacy ? [legacy] : []), ...calls];
  const state = SUMMARY_ORDER.find((one) => all.some((job) => job.state === one)) ?? 'done';
  const decider = all.find((job) => job.state === state);
  return {
    sessionId: calls[0]!.sessionId,
    calls: legacy?.calls ?? [],
    files: all.flatMap((job) => job.files),
    folderId: legacy?.folderId ?? calls.find((job) => job.folderId)?.folderId,
    state,
    ...(decider?.reason ? { reason: decider.reason } : {}),
    notified: all.every((job) => job.notified),
    noticeShown: all.every((job) => job.state !== 'done' || job.noticeShown),
    queuedAt: Math.min(...all.map((job) => job.queuedAt)),
    updatedAt: Math.max(...all.map((job) => job.updatedAt)),
  };
}

/**
 * Every session's uploads on this device, one summary each (summariseSessionJobs), newest change first.
 *
 * @returns The summaries.
 * Called from: watchDriveJobs(); tests
 */
export async function listSessionDriveSummaries(): Promise<DriveSessionJob[]> {
  const [legacy, calls] = await Promise.all([listDriveJobs(), listCallJobs()]);
  const bySession = new Map<string, DriveCallJob[]>();
  for (const job of calls)
    bySession.set(job.sessionId, [...(bySession.get(job.sessionId) ?? []), job]);
  const out: DriveSessionJob[] = [];
  for (const job of legacy) {
    const summary = summariseSessionJobs(job, bySession.get(job.sessionId) ?? []);
    if (summary) out.push(summary);
    bySession.delete(job.sessionId);
  }
  for (const jobs of bySession.values()) {
    const summary = summariseSessionJobs(undefined, jobs);
    if (summary) out.push(summary);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
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
 * in any window of this profile. ADR-0077: one summary per session, its calls' jobs included.
 *
 * @param onJobs  Called with the summaries now and after every change.
 * @param onError Called when they cannot be read.
 * @returns A function that stops watching.
 * Called from: features/drive/useDrive.ts; tests
 */
export function watchDriveJobs(
  onJobs: (jobs: DriveSessionJob[]) => void,
  onError: () => void,
): () => void {
  const subscription = liveQuery(() => listSessionDriveSummaries()).subscribe({
    next: onJobs,
    error: onError,
  });
  return () => subscription.unsubscribe();
}
