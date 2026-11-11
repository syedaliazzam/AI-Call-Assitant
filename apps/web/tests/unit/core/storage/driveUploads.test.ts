/**
 * Tests for apps/web/src/core/storage/driveUploads.ts (ADR-0072), on an in-memory IndexedDB: queuing a
 * call makes a job, the same call twice is kept once, a second call goes back to the queue keeping the
 * saved files and folder; the next job is the oldest active one; Retry queues waiting and failed jobs;
 * the store is never synced (it is not in SYNCED_STORES). All values are invented.
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
} from '@/core/storage/driveUploads';
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
