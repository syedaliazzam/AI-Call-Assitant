/**
 * Tests for the ADR-0077 call stores: apps/web/src/core/storage/calls.ts, callNotes.ts, driveCallJobs.ts,
 * the per-session Drive summary in driveUploads.ts, the session delete in sessions.ts and the sync mapping:
 * - a call record is saved, changed (never brought back once deleted), listed per session and per device;
 * - each call's notes are kept apart;
 * - a call job is queued once (queued again keeps its saved files), picked oldest first, retried with its
 *   failed files' tries reset;
 * - the session cards' one line per session: the busiest job wins; the notice waits for every finished job;
 * - deleting a session takes its calls, their notes and their Drive jobs;
 * - calls and their notes sync as 'call' and 'callNotes', as children of their session.
 * All values are invented.
 */
import 'fake-indexeddb/auto';
import { SESSION_CHILD_KINDS, SYNC_KINDS } from '@kite/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCallNotes, listCallNotes, saveCallNotes } from '@/core/storage/callNotes';
import { getCall, listCalls, listDeviceCalls, saveCall, updateCall } from '@/core/storage/calls';
import { getDb } from '@/core/storage/db';
import {
  getCallJob,
  listCallJobs,
  nextCallJob,
  putCallJob,
  queueCallJob,
  requeueCallJobs,
} from '@/core/storage/driveCallJobs';
import { summariseSessionJobs } from '@/core/storage/driveUploads';
import { createSession, deleteSession } from '@/core/storage/sessions';
import type { DriveCallJob, DriveSessionJob, StoredCall } from '@/core/storage/types';
import { STORE_KIND, sessionIdOf } from '@/core/sync/mapping';
import { resetDb, sessionInput } from './helpers';

beforeEach(resetDb);

/**
 * A call record.
 * @param id        Its id.
 * @param sessionId Its session.
 * @param extra     Other fields.
 * @returns The record.
 */
function call(id: string, sessionId: string, extra: Partial<StoredCall> = {}): StoredCall {
  return {
    id,
    sessionId,
    startedAt: 1_000,
    endedAt: null,
    durationMs: 0,
    phase: 'live',
    deviceId: 'dev-a',
    saveTranscript: true,
    recording: 'off',
    notesState: 'writing',
    drive: { state: 'waiting' },
    updatedAt: 1_000,
    ...extra,
  };
}

/** The notes of one call. */
const NOTES = { summary: ['x'], questions: [], nextSteps: [], unclear: [], lessons: [] };

describe('call records and their notes', () => {
  it('saves, changes and lists calls; a deleted one is not brought back', async () => {
    await saveCall(call('c1', 's1', { startedAt: 2_000 }));
    await saveCall(call('c2', 's1', { startedAt: 1_000, deviceId: 'dev-b' }));
    await saveCall(call('c3', 's2'));
    expect(await updateCall('c1', { phase: 'ended', endedAt: 9_000 }, 9_500)).toBe(true);
    expect(await getCall('c1')).toMatchObject({ phase: 'ended', endedAt: 9_000, updatedAt: 9_500 });
    expect((await listCalls('s1')).map((one) => one.id)).toEqual(['c2', 'c1']);
    expect((await listDeviceCalls('dev-a')).map((one) => one.id).sort()).toEqual(['c1', 'c3']);
    await getDb().calls.delete('c3');
    expect(await updateCall('c3', { phase: 'ended' })).toBe(false);
    expect(await getCall('c3')).toBeNull();
  });

  it('keeps each call’s notes apart', async () => {
    await saveCallNotes({
      callId: 'c1',
      sessionId: 's1',
      notes: NOTES,
      callStartedAt: 1,
      createdAt: 2,
    });
    await saveCallNotes({
      callId: 'c2',
      sessionId: 's1',
      notes: NOTES,
      callStartedAt: 3,
      createdAt: 4,
    });
    expect((await getCallNotes('c2'))?.callStartedAt).toBe(3);
    expect(await listCallNotes('s1')).toHaveLength(2);
    expect(await getCallNotes('nope')).toBeNull();
  });

  it('deletes a session’s calls, notes and Drive jobs with it', async () => {
    const session = await createSession(sessionInput());
    await saveCall(call('c1', session.id));
    await saveCallNotes({
      callId: 'c1',
      sessionId: session.id,
      notes: NOTES,
      callStartedAt: 1,
      createdAt: 2,
    });
    await queueCallJob({
      callId: 'c1',
      sessionId: session.id,
      startedAt: 1,
      endedAt: 2,
      recordingMatch: 'meeting',
      origin: 'call',
    });
    await deleteSession(session.id);
    expect(await getCall('c1')).toBeNull();
    expect(await getCallNotes('c1')).toBeNull();
    expect(await getCallJob('c1')).toBeNull();
  });

  it('syncs calls and their notes as children of their session', () => {
    expect(STORE_KIND.calls).toBe('call');
    expect(STORE_KIND.callNotes).toBe('callNotes');
    expect(SYNC_KINDS).toEqual(expect.arrayContaining(['call', 'callNotes']));
    expect(SESSION_CHILD_KINDS).toEqual(expect.arrayContaining(['call', 'callNotes']));
    expect(sessionIdOf('calls', { sessionId: 's1' })).toBe('s1');
    expect(sessionIdOf('callNotes', { sessionId: 's1' })).toBe('s1');
  });
});

describe('call Drive jobs', () => {
  const input = {
    callId: 'c1',
    sessionId: 's1',
    startedAt: 1_000,
    endedAt: 2_000,
    recordingMatch: 'meeting' as const,
    origin: 'call' as const,
  };

  it('queues a call once; queued again it keeps its saved files', async () => {
    const job = await queueCallJob(input, 10);
    await putCallJob({
      ...job,
      state: 'done',
      files: [
        {
          key: 'call:1000:transcript-txt',
          folder: 'Transcripts',
          name: 'a',
          bytes: 1,
          sent: 1,
          done: true,
        },
      ],
    });
    const again = await queueCallJob({ ...input, endedAt: 3_000 }, 20);
    expect(again).toMatchObject({ state: 'queued', endedAt: 3_000, queuedAt: 10 });
    expect(again.files).toHaveLength(1);
    expect(await listCallJobs()).toHaveLength(1);
  });

  it('picks the oldest queued job, and Retry resets the failed files’ tries', async () => {
    await queueCallJob(input, 30);
    await queueCallJob({ ...input, callId: 'c0' }, 20);
    expect((await nextCallJob())?.callId).toBe('c0');
    const job = (await getCallJob('c1'))!;
    await putCallJob({
      ...job,
      state: 'error',
      files: [
        {
          key: 'k',
          folder: 'Transcripts',
          name: 'a',
          bytes: 1,
          sent: 0,
          done: false,
          failures: 5,
          error: 'failed',
        },
      ],
    });
    expect(await requeueCallJobs('s1', 40)).toBe(1);
    expect(await getCallJob('c1')).toMatchObject({
      state: 'queued',
      files: [{ failures: undefined }],
    });
  });

  it('shows a session’s jobs as one line: the busiest wins; the notice waits for every finished job', () => {
    const legacy = {
      sessionId: 's1',
      calls: [],
      files: [],
      state: 'done',
      notified: true,
      noticeShown: true,
      folderId: 'F1',
      queuedAt: 1,
      updatedAt: 1,
    } as DriveSessionJob;
    const job = (state: DriveCallJob['state'], noticeShown = false) =>
      ({
        ...input,
        files: [],
        state,
        callFilesReported: false,
        reportedFiles: 0,
        notified: false,
        noticeShown,
        queuedAt: 5,
        updatedAt: 9,
      }) as DriveCallJob;
    expect(summariseSessionJobs(legacy, [])).toBe(legacy);
    expect(summariseSessionJobs(legacy, [job('uploading')])).toMatchObject({
      state: 'uploading',
      folderId: 'F1',
      updatedAt: 9,
    });
    expect(summariseSessionJobs(legacy, [job('done')])).toMatchObject({
      state: 'done',
      noticeShown: false,
    });
    expect(summariseSessionJobs(undefined, [job('done', true), job('error')])).toMatchObject({
      state: 'error',
    });
    expect(summariseSessionJobs(undefined, [])).toBeUndefined();
  });
});
