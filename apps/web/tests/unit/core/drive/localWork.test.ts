/**
 * Tests for apps/web/src/core/drive/localWork.ts (desktop 1.7.2, ADR-0106): the Drive work this computer
 * still has to do by itself, as the report the desktop shell keeps:
 * - a queued, uploading or paused call upload counts, with its recording files' bytes; an error retried by
 *   itself counts; one waiting for the person, a non-retryable error or a done job does not;
 * - a file that failed too often, or is done, is not counted;
 * - a job whose files are not listed yet counts this computer's recordings of its call;
 * - this device's recent call whose upload is still to be queued (notes being written) counts, with its
 *   recordings, only when the account saves to Drive; another device's, an old one, or one 'off' does not;
 * - the same recording in a call job and an older session job is counted once;
 * - watchLocalDriveWork() reports after every change, also one that leaves the counts the same.
 * Invented ids, sizes and times only.
 */
import 'fake-indexeddb/auto';
import type { DriveQueueReport, LocalRecording } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_FAILURES } from '@/core/drive/callUploader';
import {
  RECENT_CALL_MS,
  localDriveWork,
  movesByItself,
  watchLocalDriveWork,
  type LocalWorkInput,
} from '@/core/drive/localWork';
import { getDb } from '@/core/storage/db';
import type { DriveCallJob, DriveFileJob, DriveSessionJob, StoredCall } from '@/core/storage/types';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

const NOW = new Date(2026, 10, 19, 10, 0).getTime();
const DEVICE = 'device-here';
const CALL_ID = '33333333-3333-4333-8333-333333333333';
const REC_ID = '22222222-2222-4222-8222-222222222222';

/**
 * A recording file of a job.
 * @param changes Fields to change.
 * @returns The file.
 */
function recFile(changes: Partial<DriveFileJob> = {}): DriveFileJob {
  return {
    key: `rec:${REC_ID}:main`,
    folder: 'Recordings',
    name: 'Part 1.mkv',
    recordingId: REC_ID,
    track: 'main',
    bytes: 1_000,
    sent: 250,
    done: false,
    ...changes,
  };
}

/**
 * A call upload.
 * @param changes Fields to change.
 * @returns The job.
 */
function callJob(changes: Partial<DriveCallJob> = {}): DriveCallJob {
  return {
    callId: CALL_ID,
    sessionId: 's',
    startedAt: NOW - 3_600_000,
    endedAt: NOW - 1_800_000,
    recordingMatch: 'meeting',
    origin: 'call',
    files: [recFile()],
    state: 'uploading',
    callFilesReported: true,
    reportedFiles: 0,
    notified: false,
    noticeShown: false,
    queuedAt: NOW - 1_800_000,
    updatedAt: NOW,
    ...changes,
  };
}

/**
 * A call record.
 * @param changes Fields to change.
 * @returns The record.
 */
function call(changes: Partial<StoredCall> = {}): StoredCall {
  return {
    id: CALL_ID,
    sessionId: 's',
    startedAt: NOW - 600_000,
    endedAt: NOW - 60_000,
    durationMs: 540_000,
    phase: 'ended',
    deviceId: DEVICE,
    saveTranscript: true,
    recording: 'screen',
    notesState: 'writing',
    drive: { state: 'waiting' },
    updatedAt: NOW,
    ...changes,
  };
}

/** This computer's recording of the call. */
const RECORDING: LocalRecording = {
  id: REC_ID,
  sessionId: 's',
  meetingId: CALL_ID,
  part: 1,
  kind: 'screen',
  startedAt: NOW - 590_000,
  durationMs: 500_000,
  bytes: 4_000,
  fileName: 'x.mkv',
  hasStereo: false,
  status: 'complete',
};

/**
 * The input with nothing in it but what is given.
 * @param changes Fields to change.
 * @returns The input.
 */
function input(changes: Partial<LocalWorkInput> = {}): LocalWorkInput {
  return {
    calls: [],
    callJobs: [],
    sessionJobs: [],
    recordings: [],
    deviceId: DEVICE,
    saves: true,
    now: NOW,
    ...changes,
  };
}

const NOTHING: DriveQueueReport = { calls: 0, recordings: 0, sent: 0, total: 0 };

describe('movesByItself', () => {
  it('is true for queued, uploading, paused and an error retried by itself', () => {
    expect(movesByItself({ state: 'queued' })).toBe(true);
    expect(movesByItself({ state: 'uploading' })).toBe(true);
    expect(movesByItself({ state: 'paused' })).toBe(true);
    expect(movesByItself({ state: 'error', autoRetry: true })).toBe(true);
    expect(movesByItself({ state: 'error' })).toBe(false);
    expect(movesByItself({ state: 'waiting' })).toBe(false);
    expect(movesByItself({ state: 'done' })).toBe(false);
  });
});

describe('localDriveWork', () => {
  it('reports nothing when nothing is left', () => {
    expect(localDriveWork(input())).toEqual(NOTHING);
  });

  it('counts a call upload that moves by itself, with its recording bytes', () => {
    expect(localDriveWork(input({ callJobs: [callJob()] }))).toEqual({
      calls: 1,
      recordings: 1,
      sent: 250,
      total: 1_000,
    });
    expect(
      localDriveWork(input({ callJobs: [callJob({ state: 'error', autoRetry: true })] })).calls,
    ).toBe(1);
  });

  it('leaves out work that waits for the person, and finished or given-up files', () => {
    for (const job of [
      callJob({ state: 'waiting', reason: 'reconnect' }),
      callJob({ state: 'error', reason: 'refused' }),
      callJob({ state: 'done' }),
    ]) {
      expect(localDriveWork(input({ callJobs: [job] }))).toEqual(NOTHING);
    }
    const given = localDriveWork(
      input({
        callJobs: [
          callJob({
            files: [recFile({ failures: MAX_FILE_FAILURES }), recFile({ key: 'b', done: true })],
          }),
        ],
      }),
    );
    expect(given).toEqual({ calls: 1, recordings: 0, sent: 0, total: 0 });
  });

  it("counts this computer's recordings of a job whose files are not listed yet", () => {
    expect(
      localDriveWork(
        input({ callJobs: [callJob({ state: 'queued', files: [] })], recordings: [RECORDING] }),
      ),
    ).toEqual({ calls: 1, recordings: 1, sent: 0, total: 4_000 });
    // Once listed (and done), it is not added again from the index.
    expect(
      localDriveWork(
        input({
          callJobs: [callJob({ files: [recFile({ done: true })] })],
          recordings: [RECORDING],
        }),
      ).recordings,
    ).toBe(0);
  });

  it("counts this device's recent call whose upload is still to come, when the account saves to Drive", () => {
    const pending = input({ calls: [call()], recordings: [RECORDING] });
    expect(localDriveWork(pending)).toEqual({ calls: 1, recordings: 1, sent: 0, total: 4_000 });
    // Not saving to Drive: its recording stays on the computer, nothing to wait for.
    expect(localDriveWork({ ...pending, saves: false })).toEqual(NOTHING);
    // Another device's call, an old one, one marked 'off', or one already queued (its job decides).
    expect(localDriveWork({ ...pending, calls: [call({ deviceId: 'other' })] })).toEqual(NOTHING);
    expect(
      localDriveWork({ ...pending, calls: [call({ startedAt: NOW - RECENT_CALL_MS - 1 })] }),
    ).toEqual(NOTHING);
    expect(
      localDriveWork({
        ...pending,
        calls: [call({ notesState: 'saved', drive: { state: 'off' } })],
      }),
    ).toEqual(NOTHING);
    expect(localDriveWork({ ...pending, callJobs: [callJob({ state: 'done' })] })).toEqual(NOTHING);
  });

  it('counts a recording in a call job and an older session job once', () => {
    const session: DriveSessionJob = {
      sessionId: 's',
      calls: [],
      files: [recFile({ sent: 250 })],
      state: 'queued',
      notified: false,
      noticeShown: false,
      queuedAt: NOW,
      updatedAt: NOW,
    };
    expect(localDriveWork(input({ callJobs: [callJob()], sessionJobs: [session] }))).toEqual({
      calls: 2,
      recordings: 1,
      sent: 250,
      total: 1_000,
    });
  });
});

describe('watchLocalDriveWork', () => {
  it('reports after every change, also one that leaves the counts the same', async () => {
    const reports: DriveQueueReport[] = [];
    const stop = watchLocalDriveWork(
      async () => [],
      (report) => reports.push(report),
    );
    // Dexie's live query answers asynchronously: wait for each report rather than a fixed time.
    const wait = (check: () => void) => vi.waitFor(check, { timeout: 5_000, interval: 10 });
    await wait(() => expect(reports).toEqual([NOTHING]));
    await getDb().driveCallJobs.put(callJob());
    await wait(() =>
      expect(reports.at(-1)).toEqual({ calls: 1, recordings: 1, sent: 250, total: 1_000 }),
    );
    const count = reports.length;
    // A change that leaves the counts the same (a call that ended with nothing to upload) is still
    // reported: the shell waits for a report made after the call's end.
    await getDb().calls.put(call({ deviceId: 'other' }));
    await wait(() => expect(reports.length).toBeGreaterThan(count));
    expect(reports.at(-1)).toEqual({ calls: 1, recordings: 1, sent: 250, total: 1_000 });
    await getDb().driveCallJobs.put(callJob({ state: 'done' }));
    await wait(() => expect(reports.at(-1)).toEqual(NOTHING));
    stop();
  });
});
