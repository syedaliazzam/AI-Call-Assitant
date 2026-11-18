/**
 * Tests for apps/web/src/core/meetings/library.ts (ADR-0096, the Meetings library): session folders named
 * as in Google Drive and sorted newest first (sessions without calls left out); search by company, session
 * and the other person's name; the date filter; the recording status words (ADR-0106: who finishes an
 * upload, and a day without progress); the row marks; "Questions & answers only"; the transcript
 * search; finding a call. Invented sessions and calls only.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLibrary,
  callMarks,
  callTheirName,
  filterLibrary,
  findCall,
  lineMatches,
  questionsAndAnswers,
  rangeStart,
  recordingStatus,
} from '@/core/meetings/library';
import type { CallView } from '@/core/review/calls';
import type { ConversationEntry } from '@/core/review/conversation';
import type {
  Session,
  StoredAnswer,
  StoredCall,
  StoredRecording,
  StoredUtterance,
} from '@/core/storage/types';

/** 17 Nov 2026, 14:05 local time. */
const NOW = new Date(2026, 10, 17, 14, 5).getTime();

/** One day, ms. */
const DAY = 24 * 60 * 60_000;

/**
 * An invented session.
 * @param id      Its id.
 * @param changes Fields to change.
 * @returns The session.
 */
function session(id: string, changes: Partial<Session> = {}): Session {
  return {
    id,
    type: 'regular',
    company: 'Acme',
    role: 'Pricing review',
    description: '',
    preferences: {
      language: 'en',
      model: 'fast',
      style: { format: 'headline+bullets', length: 'short', tone: 'professional' },
      keyTerms: '',
    },
    instructions: '',
    saveTranscript: true,
    autoAnswer: false,
    createdAt: NOW - 30 * DAY,
    status: 'ended',
    lastActiveAt: null,
    ...changes,
  };
}

/**
 * An invented call record's Drive state and name.
 * @param changes Fields to change.
 * @returns The record.
 */
function record(changes: Partial<StoredCall> = {}): StoredCall {
  return {
    id: 'rec',
    sessionId: 's',
    startedAt: NOW,
    endedAt: NOW + 60_000,
    durationMs: 60_000,
    phase: 'ended',
    deviceId: 'd',
    saveTranscript: true,
    recording: 'off',
    notesState: 'saved',
    drive: { state: 'off' },
    updatedAt: NOW,
    ...changes,
  };
}

/**
 * An invented recording part.
 * @param changes Fields to change.
 * @returns The part.
 */
function part(changes: Partial<StoredRecording> = {}): StoredRecording {
  return {
    id: 'part-1',
    sessionId: 's',
    meetingId: 'c',
    part: 1,
    kind: 'screen',
    startedAt: NOW,
    durationMs: 60_000,
    bytes: 1_000,
    fileName: 'x.mkv',
    hasStereo: false,
    deviceId: 'd',
    deviceName: 'Office PC',
    status: 'complete',
    updatedAt: NOW,
    ...changes,
  };
}

/**
 * An invented call.
 * @param id        Its id.
 * @param sessionId Its session.
 * @param startedAt When it started.
 * @param changes   Fields to change.
 * @returns The call.
 */
function call(
  id: string,
  sessionId: string,
  startedAt: number,
  changes: Partial<CallView> = {},
): CallView {
  return {
    id,
    legacy: false,
    sessionId,
    startedAt,
    endedAt: startedAt + 60_000,
    durationMs: 60_000,
    record: null,
    lines: [],
    answers: [],
    notes: null,
    notesState: null,
    recordings: [],
    ...changes,
  };
}

/**
 * An invented transcript line.
 * @param text What was said.
 * @returns The line.
 */
function line(text: string): StoredUtterance {
  return { id: text, sessionId: 's', speaker: 'them', text, tStart: NOW, tEnd: NOW };
}

describe('buildLibrary', () => {
  it('names folders as Drive does, newest call first, and leaves out sessions without calls', () => {
    const a = session('a', { company: 'Acme', role: 'Pricing review' });
    const b = session('b', { company: 'Globex', role: 'Intro' });
    const c = session('c');
    const calls = new Map([
      ['a', [call('a1', 'a', NOW - 3 * DAY), call('a2', 'a', NOW - DAY)]],
      ['b', [call('b1', 'b', NOW)]],
    ]);
    const folders = buildLibrary([a, b, c], calls);
    expect(folders.map((folder) => folder.session.id)).toEqual(['b', 'a']);
    // Named after the session's first call, as its Drive folder is.
    expect(folders[1]!.name).toBe('2026-11-14 Acme – Pricing review');
    expect(folders[1]!.calls.map((one) => one.id)).toEqual(['a2', 'a1']);
  });
});

describe('filterLibrary', () => {
  const acme = session('a', { company: 'Acme', role: 'Pricing review', contactName: 'Sarah' });
  const globex = session('b', { company: 'Globex', role: 'Intro' });
  const folders = buildLibrary(
    [acme, globex],
    new Map([
      [
        'a',
        [
          call('a1', 'a', NOW - 40 * DAY),
          call('a2', 'a', NOW - DAY, { record: record({ themName: 'Priya' }) }),
        ],
      ],
      ['b', [call('b1', 'b', NOW)]],
    ]),
  );

  it('finds by company, session and the other person’s name, every word, any case', () => {
    expect(filterLibrary(folders, 'globex', 'all', NOW).map((f) => f.session.id)).toEqual(['b']);
    expect(filterLibrary(folders, 'PRICING acme', 'all', NOW).map((f) => f.session.id)).toEqual([
      'a',
    ]);
    // The call's own name for the other person finds only that call.
    expect(filterLibrary(folders, 'priya', 'all', NOW)[0]!.calls.map((c) => c.id)).toEqual(['a2']);
    expect(filterLibrary(folders, 'nobody', 'all', NOW)).toEqual([]);
  });

  it('keeps only calls inside the dates', () => {
    const lastWeek = filterLibrary(folders, '', '7d', NOW);
    expect(lastWeek.flatMap((f) => f.calls.map((c) => c.id))).toEqual(['b1', 'a2']);
    expect(filterLibrary(folders, '', 'today', NOW).map((f) => f.session.id)).toEqual(['b']);
    expect(filterLibrary(folders, '', 'all', NOW).flatMap((f) => f.calls)).toHaveLength(3);
  });

  it('counts days from midnight', () => {
    const midnight = new Date(2026, 10, 17).getTime();
    expect(rangeStart('today', NOW)).toBe(midnight);
    expect(rangeStart('7d', NOW)).toBe(midnight - 6 * DAY);
    expect(rangeStart('year', NOW)).toBe(new Date(2026, 0, 1).getTime());
    expect(rangeStart('all', NOW)).toBe(0);
  });
});

describe('callTheirName', () => {
  it('is the call’s name, else the session’s, never the fallback label', () => {
    const named = session('a', { contactName: 'Sarah' });
    expect(callTheirName(named, call('c', 'a', NOW))).toBe('Sarah');
    expect(
      callTheirName(named, call('c', 'a', NOW, { record: record({ themName: 'Priya' }) })),
    ).toBe('Priya');
    expect(callTheirName(session('b'), call('c', 'b', NOW))).toBeNull();
    expect(callTheirName(session('b', { type: 'interview' }), call('c', 'b', NOW))).toBeNull();
  });
});

describe('recordingStatus', () => {
  it('says Not recorded, Recording…, Recorded, waiting for the desktop app, or Saved on <computer> only', () => {
    expect(recordingStatus(call('c', 's', NOW), NOW).label).toBe('Not recorded');
    expect(
      recordingStatus(call('c', 's', NOW, { recordings: [part({ status: 'recording' })] }), NOW)
        .kind,
    ).toBe('recording');
    const recorded = (state: StoredCall['drive']['state']) =>
      recordingStatus(
        call('c', 's', NOW, { recordings: [part()], record: record({ drive: { state } }) }),
        NOW,
      ).label;
    const waiting = 'Waiting for the desktop app to finish the upload';
    expect(recorded('done')).toBe('Recorded');
    expect(recorded('uploading')).toBe(waiting);
    expect(recorded('queued')).toBe(waiting);
    expect(recorded('paused')).toBe(waiting);
    expect(recorded('off')).toBe('Saved on Office PC only');
    expect(recorded('error')).toBe('Saved on Office PC only');
    expect(recorded('waiting')).toBe(waiting);
    // Waiting for the person (Drive not connected): not on its way.
    expect(
      recordingStatus(
        call('c', 's', NOW, {
          recordings: [part()],
          record: record({ drive: { state: 'waiting', reason: 'not-connected' } }),
        }),
        NOW,
      ).label,
    ).toBe('Saved on Office PC only');
    expect(
      recordingStatus(call('c', 's', NOW, { recordings: [part({ deviceName: '' })] }), NOW).label,
    ).toBe('Saved on one computer only');
  });

  it('ADR-0106: says to open the desktop app when its upload has not moved for a day', () => {
    const withDrive = (drive: StoredCall['drive'], updatedAt = NOW) =>
      recordingStatus(
        call('c', 's', NOW, { recordings: [part()], record: record({ drive, updatedAt }) }),
        NOW + DAY,
      );
    const paused = 'Upload paused: open the desktop app on the computer used for this call';
    // The app last worked on it exactly a day ago.
    expect(withDrive({ state: 'uploading', movedAt: NOW })).toEqual({
      kind: 'stalled',
      label: paused,
    });
    // An hour ago: still on its way.
    expect(withDrive({ state: 'uploading', movedAt: NOW + DAY - 3_600_000 }).kind).toBe(
      'uploading',
    );
    // A record from before movedAt: its last change stands in.
    expect(withDrive({ state: 'queued' }).label).toBe(paused);
    expect(withDrive({ state: 'queued' }, NOW + DAY - 60_000).kind).toBe('uploading');
    // Saved, or waiting for the person: not "paused".
    expect(withDrive({ state: 'done', movedAt: NOW - DAY }).kind).toBe('recorded');
    expect(withDrive({ state: 'waiting', reason: 'reconnect', movedAt: NOW - DAY }).kind).toBe(
      'device-only',
    );
  });
});

describe('callMarks', () => {
  it('marks recorded, notes and transcript', () => {
    expect(callMarks(call('c', 's', NOW))).toEqual({
      recorded: false,
      notes: false,
      transcript: false,
    });
    expect(
      callMarks(
        call('c', 's', NOW, {
          recordings: [part()],
          lines: [line('Hello')],
          notes: {
            notes: { summary: [], questions: [], nextSteps: [], unclear: [], lessons: [] },
            callStartedAt: NOW,
            createdAt: NOW,
          },
        }),
      ),
    ).toEqual({ recorded: true, notes: true, transcript: true });
  });
});

describe('questionsAndAnswers', () => {
  /**
   * A turn entry.
   * @param id      Its id.
   * @param speaker Who spoke.
   * @returns The entry.
   */
  const turn = (id: string, speaker: 'you' | 'them'): ConversationEntry => ({
    kind: 'turn',
    at: NOW,
    elapsed: 0,
    turn: {
      id,
      speaker,
      tStart: NOW,
      tEnd: NOW,
      parts: [],
      finalText: id,
      provisionalText: '',
      unclear: false,
    },
  });
  /**
   * An answer entry.
   * @param id Its id.
   * @returns The entry.
   */
  const answer = (id: string): ConversationEntry => ({
    kind: 'answer',
    at: NOW,
    elapsed: 0,
    answer: { id } as StoredAnswer,
  });

  it('keeps each answer with the other person’s turn before it, once', () => {
    const entries = [
      turn('hello', 'them'),
      turn('hi', 'you'),
      turn('question', 'them'),
      answer('a1'),
      answer('a2'),
      turn('reply', 'you'),
      answer('a3'),
    ];
    const kept = questionsAndAnswers(entries).map((entry) =>
      entry.kind === 'turn' ? entry.turn.id : entry.kind === 'answer' ? entry.answer.id : 'call',
    );
    // a3 followed the user's own turn: it is kept without a question.
    expect(kept).toEqual(['question', 'a1', 'a2', 'a3']);
  });
});

describe('lineMatches and findCall', () => {
  it('matches every typed word in a line, any case', () => {
    expect(lineMatches(line('The price per seat is fixed'), 'PRICE seat')).toBe(true);
    expect(lineMatches(line('The price per seat is fixed'), 'price month')).toBe(false);
    expect(lineMatches(line('Anything'), '  ')).toBe(true);
  });

  it('finds a call and its folder, or null', () => {
    const folders = buildLibrary([session('a')], new Map([['a', [call('a1', 'a', NOW)]]]));
    expect(findCall(folders, 'a1')?.folder.session.id).toBe('a');
    expect(findCall(folders, 'gone')).toBeNull();
  });
});
