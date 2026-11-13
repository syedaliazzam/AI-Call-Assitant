/**
 * Tests for apps/web/src/core/drive/earlierCalls.ts (ADR-0077: "Upload N earlier calls"), modelled on the
 * session of 11–13 Nov 2026 (times only, invented ids): its older per-session Drive job holds five calls
 * (11 Nov 23:19:56, 12 Nov 23:16:01, 23:16:59, 23:19:09, 13 Nov 00:21:46); the 12 Nov 22:25 call (two
 * recording parts, before Drive was set up) and the 13 Nov 00:49 call (never queued) are not in it.
 * - exactly those two are offered, once; after they are queued, nothing is offered again;
 * - a call that ended a minute before the next one started (00:21 → 00:49) is not mistaken for it;
 * - a browser that never uploaded or recorded the session offers none of its old calls (no duplicate
 *   transcripts); a session card's own "Upload to Drive" may;
 * - call records: only this device's, ended, never queued (Drive was off).
 * All values are invented.
 */
import 'fake-indexeddb/auto';
import type { LocalRecording } from '@kite/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findEarlierCalls,
  loadEarlierCalls,
  sameTime,
  uploadEarlierCalls,
} from '@/core/drive/earlierCalls';
import { buildCallViews, type CallView } from '@/core/review/calls';
import { getDb } from '@/core/storage/db';
import { listCallJobs } from '@/core/storage/driveCallJobs';
import type {
  DriveCallJob,
  DriveSessionJob,
  Session,
  StoredAnswer,
  StoredCall,
  StoredRecording,
  StoredUtterance,
} from '@/core/storage/types';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

/** The session. */
const S = '11111111-1111-4111-8111-111111111111';

/** The session as stored. */
const SESSION = { id: S, saveTranscript: true, createdAt: 1, type: 'interview' } as Session;

/**
 * A local time on 11–13 Nov 2026.
 * @param day    The day.
 * @param h      Hours.
 * @param m      Minutes.
 * @param s      Seconds.
 * @returns Unix ms.
 */
const at = (day: number, h: number, m: number, s = 0) => new Date(2026, 10, day, h, m, s).getTime();

/** Each call's connect time and length (minutes), as the session had them. */
const CALLS = [
  { saver: 'c1119', start: at(11, 23, 19, 56), minutes: 2 },
  { saver: 'c2225', start: at(12, 22, 25, 0), minutes: 6, recorded: true },
  { saver: 'c2316a', start: at(12, 23, 16, 1), minutes: 0.8 },
  { saver: 'c2316b', start: at(12, 23, 16, 59), minutes: 2 },
  { saver: 'c2319', start: at(12, 23, 19, 9), minutes: 3 },
  { saver: 'c0021', start: at(13, 0, 21, 46), minutes: 27 },
  { saver: 'c0049', start: at(13, 0, 49, 38), minutes: 16.5, recorded: true },
];

/**
 * The lines, answers and recordings of every call.
 * @returns The session's data.
 */
function sessionData() {
  const lines: StoredUtterance[] = [];
  const answers: StoredAnswer[] = [];
  const recordings: StoredRecording[] = [];
  for (const call of CALLS) {
    const end = call.start + call.minutes * 60_000;
    lines.push(
      {
        id: `${S}:${call.saver}:u1`,
        sessionId: S,
        speaker: 'them',
        text: 'x',
        tStart: call.start + 3_000,
        tEnd: call.start + 6_000,
      },
      {
        id: `${S}:${call.saver}:u2`,
        sessionId: S,
        speaker: 'you',
        text: 'y',
        tStart: end - 6_000,
        tEnd: end - 1_000,
      },
    );
    answers.push({
      id: `ans-${call.saver}`,
      sessionId: S,
      createdAt: call.start + 10_000,
      callStartedAt: call.start,
      msTotal: 1_000,
    } as StoredAnswer);
    if (call.recorded) {
      for (const part of call.saver === 'c2225' ? [1, 2] : [1]) {
        recordings.push({
          id: `${call.saver}-p${part}`,
          sessionId: S,
          meetingId: `meeting-${call.saver}`,
          part,
          kind: 'screen',
          startedAt: call.start + 30_000 + (part - 1) * 120_000,
          durationMs: 100_000,
          bytes: 1,
          fileName: 'x.mkv',
          hasStereo: true,
          deviceId: 'desk',
          deviceName: 'Office laptop',
          status: 'complete',
          updatedAt: 1,
        });
      }
    }
  }
  return { lines, answers, recordings };
}

/** The older per-session job: five calls, each ended just before the next started at most. */
const LEGACY_JOB = {
  sessionId: S,
  calls: CALLS.filter((call) => !call.recorded).map((call) => ({
    startedAt: call.start,
    endedAt: call.start + call.minutes * 60_000 + 20_000,
  })),
  files: [],
  state: 'done',
  notified: true,
  noticeShown: true,
  queuedAt: 1,
  updatedAt: 1,
} as DriveSessionJob;

/**
 * This computer's recordings (the desktop app's index).
 * @param recordings The account's records of them.
 * @returns The index entries.
 */
function localRecordings(recordings: readonly StoredRecording[]): LocalRecording[] {
  return recordings.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    meetingId: r.meetingId,
    part: r.part,
    kind: r.kind,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    bytes: r.bytes,
    fileName: r.fileName,
    hasStereo: r.hasStereo,
    status: 'complete',
  }));
}

/**
 * The session's calls.
 * @param records Call records, if any.
 * @returns The calls.
 */
function views(records: StoredCall[] = []): CallView[] {
  const data = sessionData();
  return buildCallViews({
    sessionId: S,
    calls: records,
    ...data,
    callNotes: [],
    legacyNotes: null,
    now: at(13, 2, 0),
  });
}

describe('findEarlierCalls', () => {
  it('offers exactly the 22:25 and 00:49 calls, once', () => {
    const data = sessionData();
    const found = findEarlierCalls({
      sessions: [{ session: SESSION, calls: views() }],
      legacyJobs: [LEGACY_JOB],
      callJobs: [],
      deviceId: 'desk-device',
      localRecordings: localRecordings(data.recordings),
      anySession: false,
    });
    expect(found.map((call) => call.startedAt)).toEqual([at(12, 22, 25), at(13, 0, 49, 38)]);
    expect(found.every((call) => call.legacy)).toBe(true);
    // Queued: nothing is offered again (no duplicate transcripts).
    const queued = found.map(
      (call) =>
        ({
          callId: call.callId,
          sessionId: S,
          startedAt: call.startedAt,
          endedAt: call.endedAt,
        }) as DriveCallJob,
    );
    expect(
      findEarlierCalls({
        sessions: [{ session: SESSION, calls: views() }],
        legacyJobs: [LEGACY_JOB],
        callJobs: queued,
        deviceId: 'desk-device',
        localRecordings: localRecordings(data.recordings),
        anySession: false,
      }),
    ).toEqual([]);
  });

  it('offers nothing old in a browser that never uploaded or recorded the session, unless asked per session', () => {
    const input = {
      sessions: [{ session: SESSION, calls: views() }],
      legacyJobs: [],
      callJobs: [],
      deviceId: 'browser',
      localRecordings: [],
    };
    expect(findEarlierCalls({ ...input, anySession: false })).toEqual([]);
    expect(findEarlierCalls({ ...input, anySession: true })).toHaveLength(CALLS.length);
  });

  it('offers this device’s ended calls that were never queued (Drive was off), and no other device’s', () => {
    const start = at(13, 9, 0);
    const off = (
      id: string,
      deviceId: string,
      state: StoredCall['drive']['state'],
    ): StoredCall => ({
      id,
      sessionId: S,
      startedAt: start + (id === 'mine' ? 0 : id === 'theirs' ? 3_600_000 : 7_200_000),
      endedAt: start + (id === 'mine' ? 600_000 : id === 'theirs' ? 4_200_000 : 7_800_000),
      durationMs: 600_000,
      phase: 'ended',
      deviceId,
      saveTranscript: true,
      recording: 'off',
      notesState: 'saved',
      drive: { state },
      updatedAt: start,
    });
    const records = [
      off('mine', 'me', 'off'),
      off('theirs', 'other', 'off'),
      off('done', 'me', 'done'),
    ];
    const calls = views(records).filter((call) => call.record);
    // Give each a line, so there is something to upload.
    for (const call of calls) {
      call.lines.push({
        id: `${call.id}-l`,
        sessionId: S,
        speaker: 'them',
        text: 'x',
        tStart: call.startedAt,
        tEnd: call.startedAt + 1,
      });
    }
    const found = findEarlierCalls({
      sessions: [{ session: SESSION, calls }],
      legacyJobs: [],
      callJobs: [],
      deviceId: 'me',
      localRecordings: [],
      anySession: false,
    });
    expect(found.map((call) => [call.callId, call.legacy])).toEqual([['mine', false]]);
  });

  it('treats calls that touch at a minute apart as different, and the same start as the same call', () => {
    expect(sameTime({ startedAt: 0, endedAt: 100 }, { startedAt: 100, endedAt: 200 })).toBe(false);
    expect(sameTime({ startedAt: 0, endedAt: 100 }, { startedAt: 99, endedAt: 200 })).toBe(true);
    expect(sameTime({ startedAt: 5, endedAt: 5 }, { startedAt: 5, endedAt: 9 })).toBe(true);
  });
});

describe('loadEarlierCalls and uploadEarlierCalls (storage)', () => {
  it('queues each earlier call as its own upload, once', async () => {
    const db = getDb();
    const data = sessionData();
    await db.sessions.put(SESSION);
    await db.utterances.bulkPut(data.lines);
    await db.answers.bulkPut(data.answers);
    await db.recordings.bulkPut(data.recordings);
    await db.driveUploads.put(LEGACY_JOB);
    const recordings = async () => localRecordings(data.recordings);
    const found = await loadEarlierCalls({ recordings });
    expect(found.map((call) => call.startedAt)).toEqual([at(12, 22, 25), at(13, 0, 49, 38)]);
    expect(await uploadEarlierCalls(found)).toBe(2);
    const jobs = await listCallJobs();
    expect(jobs.map((job) => [job.startedAt, job.origin, job.recordingMatch]).sort()).toEqual([
      [at(12, 22, 25), 'earlier', 'window'],
      [at(13, 0, 49, 38), 'earlier', 'window'],
    ]);
    expect(await loadEarlierCalls({ recordings })).toEqual([]);
  });
});
