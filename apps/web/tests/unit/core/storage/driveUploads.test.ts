/**
 * Tests for apps/web/src/core/storage/driveUploads.ts (ADR-0072), on an in-memory IndexedDB: queuing a
 * call makes a job, the same call twice is kept once, a second call goes back to the queue keeping the
 * saved files and folder; the next job is the oldest active one; Retry queues waiting and failed jobs;
 * the store is never synced (it is not in SYNCED_STORES). ADR-0073: each call has its own report flags;
 * calls already emailed under their session's single email are closed. All values are invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteDriveJob,
  getDriveJob,
  markDriveNoticeShown,
  nextDriveJob,
  putDriveJob,
  queueDriveCall,
  requeueDriveJobs,
  withCallFlags,
} from '@/core/storage/driveUploads';
import type { DriveSessionJob } from '@/core/storage/types';
import { SYNCED_STORES } from '@/core/sync/mapping';
import { resetDb } from './helpers';

beforeEach(resetDb);

describe('queueDriveCall', () => {
  it('makes a job, keeps a repeated call once, and requeues a finished job for a new call', async () => {
    const first = await queueDriveCall('s1', { startedAt: 1_000, endedAt: 2_000 }, 3_000);
    expect(first).toMatchObject({
      state: 'queued',
      calls: [{ startedAt: 1_000 }],
      notified: false,
    });
    await queueDriveCall('s1', { startedAt: 1_000, endedAt: 2_000 }, 3_100);
    expect((await getDriveJob('s1'))!.calls).toHaveLength(1);

    await putDriveJob({
      ...(await getDriveJob('s1'))!,
      state: 'done',
      folderId: 'F',
      notified: true,
      noticeShown: true,
      files: [
        {
          key: 'k',
          folder: 'Transcripts',
          name: 'n',
          bytes: 1,
          sent: 1,
          done: true,
          driveFileId: 'D',
        },
      ],
    });
    const again = await queueDriveCall('s1', { startedAt: 5_000, endedAt: 6_000 }, 7_000);
    expect(again).toMatchObject({
      state: 'queued',
      folderId: 'F',
      notified: true,
      noticeShown: false,
    });
    expect(again.calls.map((call) => call.startedAt)).toEqual([1_000, 5_000]);
    expect(again.files[0]!.driveFileId).toBe('D');
  });
});

describe('the queue', () => {
  it('picks the oldest active job, requeues waiting and failed ones, and forgets deleted ones', async () => {
    await queueDriveCall('late', { startedAt: 1, endedAt: 2 }, 9_000);
    await queueDriveCall('early', { startedAt: 1, endedAt: 2 }, 1_000);
    expect((await nextDriveJob())!.sessionId).toBe('early');
    await putDriveJob({ ...(await getDriveJob('early'))!, state: 'waiting', reason: 'reconnect' });
    await putDriveJob({ ...(await getDriveJob('late'))!, state: 'error', reason: 'refused' });
    expect(await nextDriveJob()).toBeNull();
    expect(await requeueDriveJobs()).toBe(2);
    expect((await getDriveJob('early'))!).toMatchObject({ state: 'queued', reason: undefined });
    await markDriveNoticeShown('early');
    expect((await getDriveJob('early'))!.noticeShown).toBe(true);
    await deleteDriveJob('early');
    expect(await getDriveJob('early')).toBeNull();
  });

  it('keeps a call queued while the uploader worked on an older copy of the job', async () => {
    const old = await queueDriveCall('s1', { startedAt: 1_000, endedAt: 2_000 }, 3_000);
    // The live page queues the next call...
    await queueDriveCall('s1', { startedAt: 5_000, endedAt: 6_000 }, 7_000);
    // ...then the uploader saves its older copy as finished.
    await putDriveJob({ ...old, state: 'done', folderId: 'F', noticeShown: true });
    const saved = (await getDriveJob('s1'))!;
    expect(saved.calls.map((call) => call.startedAt)).toEqual([1_000, 5_000]);
    expect(saved).toMatchObject({ state: 'queued', folderId: 'F', noticeShown: false });
  });

  it('is never synced to the account', () => {
    expect(SYNCED_STORES as readonly string[]).not.toContain('driveUploads');
  });
});

describe('each call’s own flags (ADR-0073)', () => {
  /**
   * A job as 1.6.0 and 1.6.1 kept it: calls without their own flags.
   * @param changes What differs.
   * @returns The job.
   */
  const legacy = (changes: Partial<DriveSessionJob>): DriveSessionJob => ({
    sessionId: 's1',
    calls: [
      { startedAt: 1_000, endedAt: 2_000 },
      { startedAt: 5_000, endedAt: 6_000 },
    ],
    files: [],
    state: 'done',
    notified: true,
    reportedFiles: 4,
    noticeShown: true,
    queuedAt: 2_000,
    updatedAt: 6_000,
    ...changes,
  });

  it('closes the calls of a job already emailed for its session, so they never email again', () => {
    expect(withCallFlags(legacy({})).calls).toEqual([
      { startedAt: 1_000, endedAt: 2_000, reportedFiles: 0, notified: true, closed: true },
      { startedAt: 5_000, endedAt: 6_000, reportedFiles: 0, notified: true, closed: true },
    ]);
  });

  it('leaves the calls of a job not yet reported to be reported, each on its own', () => {
    for (const job of [legacy({ notified: false }), legacy({ reportedFiles: 0 })]) {
      expect(withCallFlags(job).calls.every((call) => !call.closed && !call.notified)).toBe(true);
    }
  });

  it('changes nothing when every call has its flags', () => {
    const job = legacy({
      calls: [{ startedAt: 1_000, endedAt: 2_000, reportedFiles: 3, notified: true }],
    });
    expect(withCallFlags(job)).toBe(job);
  });

  it('queues a new call (a session started again) unreported, and settles the calls before it', async () => {
    await queueDriveCall('s1', { startedAt: 1_000, endedAt: 2_000 }, 3_000);
    const job = (await getDriveJob('s1'))!;
    expect(job.calls[0]).toMatchObject({ reportedFiles: 0, notified: false });
    // As 1.6.1 left it after its email: done, notified, the call without flags.
    await putDriveJob({
      ...job,
      state: 'done',
      notified: true,
      reportedFiles: 3,
      calls: [{ startedAt: 1_000, endedAt: 2_000 }],
    });
    const again = await queueDriveCall('s1', { startedAt: 5_000, endedAt: 6_000 }, 7_000);
    expect(again.state).toBe('queued');
    expect(again.calls).toEqual([
      { startedAt: 1_000, endedAt: 2_000, reportedFiles: 0, notified: true, closed: true },
      { startedAt: 5_000, endedAt: 6_000, reportedFiles: 0, notified: false },
    ]);
  });
});
