/**
 * Tests for apps/web/src/core/drive/backfill.ts (1.6.0, ADR-0072): a session's calls are worked out
 * from what it kept, split at 30 minutes of nothing, starting at the exact time the answers or notes
 * recorded (so the notes PDF matches its call); "Upload to Drive" queues them as "manual email only".
 * All values are invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { inferCalls, uploadSessionToDrive } from '@/core/drive/backfill';
import { saveAnswer } from '@/core/storage/answers';
import { getDriveJob } from '@/core/storage/driveUploads';
import type { StoredAnswer, StoredNotes, StoredUtterance } from '@/core/storage/types';
import { saveUtterance } from '@/core/storage/utterances';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

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
  it('queues the calls and marks the session "manual email only"', async () => {
    await saveUtterance(line(50_000));
    await saveAnswer({
      id: 'a',
      sessionId: 's1',
      createdAt: 51_000,
      callStartedAt: 49_000,
    } as StoredAnswer);
    expect(await uploadSessionToDrive('s1')).toBe(1);
    expect(await getDriveJob('s1')).toMatchObject({
      state: 'queued',
      manualEmail: true,
      calls: [{ startedAt: 49_000, endedAt: 51_000 }],
    });
    expect(await uploadSessionToDrive('nothing-here')).toBe(0);
  });
});
