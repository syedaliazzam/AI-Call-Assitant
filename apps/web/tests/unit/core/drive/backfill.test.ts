/**
 * Tests for apps/web/src/core/drive/backfill.ts (1.6.0, ADR-0072): a session's calls are worked out
 * from what it kept, split at 30 minutes of nothing, starting at the exact time the answers or notes
 * recorded (so the notes PDF matches its call); "Upload to Drive" queues each call as its own upload,
 * emailed by hand only (ADR-0077).
 * All values are invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { inferCalls, uploadSessionToDrive } from '@/core/drive/backfill';
import { saveAnswer } from '@/core/storage/answers';
import { listCallJobs } from '@/core/storage/driveCallJobs';
import { getDriveJob } from '@/core/storage/driveUploads';
import { getDb } from '@/core/storage/db';
import type { Session, StoredAnswer, StoredNotes, StoredUtterance } from '@/core/storage/types';
import { saveUtterance } from '@/core/storage/utterances';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

/**
 * Stores a session as is (only the fields the code reads).
 * @param session The session.
 */
const saveSession = async (session: Session) => {
  await getDb().sessions.put(session);
};

/** Thirty minutes and a bit, ms. */
const GAP = 31 * 60_000;

/**
 * A line at a time.
 * @param at When it started.
 * @returns The line.
 */
const line = (at: number) =>
  ({
    id: String(at),
    sessionId: 's1',
    speaker: 'them',
    text: 'x',
    tStart: at,
    tEnd: at + 1_000,
  }) as StoredUtterance;

describe('inferCalls', () => {
  it('splits at long gaps and starts each call at its recorded start', () => {
    const notes = { callStartedAt: 100_000 } as StoredNotes;
    const answers = [{ createdAt: 10_000, callStartedAt: 9_000 } as StoredAnswer];
    const calls = inferCalls({
      lines: [line(10_000), line(20_000), line(100_000 + GAP), line(110_000 + GAP)],
      answers,
      notes: { ...notes, callStartedAt: 99_000 + GAP },
      recordings: [],
    });
    expect(calls).toEqual([
      { startedAt: 9_000, endedAt: 21_000 },
      { startedAt: 99_000 + GAP, endedAt: 111_000 + GAP },
    ]);
    expect(inferCalls({ lines: [], answers: [], notes: null, recordings: [] })).toEqual([]);
  });
});

describe('uploadSessionToDrive', () => {
  it('queues each call this device never saved as its own upload, emailed by hand only (ADR-0077)', async () => {
    await saveSession({ id: 's1', saveTranscript: true } as Session);
    await saveUtterance(line(50_000));
    await saveAnswer({
      id: 'a',
      sessionId: 's1',
      createdAt: 51_000,
      callStartedAt: 49_000,
      msTotal: 0,
    } as StoredAnswer);
    expect(await uploadSessionToDrive('s1')).toBe(1);
    const jobs = await listCallJobs();
    expect(jobs).toHaveLength(1);
    // The call's exact start (its answer's), so the files keep the keys any earlier upload used.
    expect(jobs[0]).toMatchObject({
      sessionId: 's1',
      startedAt: 49_000,
      state: 'queued',
      origin: 'earlier',
      recordingMatch: 'window',
    });
    // The older per-session job is never made again.
    expect(await getDriveJob('s1')).toBeNull();
    // Asked again: the call is already queued, so nothing is added.
    expect(await uploadSessionToDrive('s1')).toBe(0);
    expect(await uploadSessionToDrive('nothing-here')).toBe(0);
  });
});
