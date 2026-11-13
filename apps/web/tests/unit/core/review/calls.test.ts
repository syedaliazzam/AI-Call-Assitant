/**
 * Tests for apps/web/src/core/review/calls.ts (ADR-0077: every start of a session is a call):
 * - a call record gets its own lines (by callId, or the call id inside the line id), answers (by callId or
 *   its exact start), notes and recordings (meeting id = call id); calls are listed newest first;
 * - calls made before records are worked out, never written: lines grouped by the call id inside their ids,
 *   answers joined to the call they were given in (two calls a minute apart stay apart), the call's start
 *   taken from its answers' recorded start (the start Drive used), the older single notes row joined to its
 *   own call, recordings by time, a recording-only call by its meeting;
 * - "Start again": the old call keeps its own transcript and notes; the new call has none of them.
 * All values are invented.
 */
import { describe, expect, it } from 'vitest';
import { buildCallViews, callIdInLineId, type SessionCallData } from '@/core/review/calls';
import type {
  StoredAnswer,
  StoredCall,
  StoredCallNotes,
  StoredNotes,
  StoredRecording,
  StoredUtterance,
} from '@/core/storage/types';

/** The session. */
const S = 'sess-1';

/** 12 Nov 2026, 23:16:01 local time. */
const T0 = new Date(2026, 10, 12, 23, 16, 1).getTime();

/**
 * A saved line.
 * @param call   The call id inside its id.
 * @param n      Its number.
 * @param tStart When it started.
 * @param extra  Other fields.
 * @returns The line.
 */
function line(call: string, n: number, tStart: number, extra: Partial<StoredUtterance> = {}) {
  return {
    id: `${S}:${call}:u${n}`,
    sessionId: S,
    speaker: n % 2 ? 'them' : 'you',
    text: `line ${n}`,
    tStart,
    tEnd: tStart + 2_000,
    ...extra,
  } as StoredUtterance;
}

/**
 * An answer.
 * @param id            Its id.
 * @param createdAt     When it was asked.
 * @param callStartedAt Its call's recorded start.
 * @param extra         Other fields.
 * @returns The answer.
 */
function answer(
  id: string,
  createdAt: number,
  callStartedAt?: number,
  extra: Partial<StoredAnswer> = {},
) {
  return {
    id,
    sessionId: S,
    createdAt,
    msTotal: 1_000,
    ...(callStartedAt !== undefined ? { callStartedAt } : {}),
    ...extra,
  } as StoredAnswer;
}

/**
 * A recording part.
 * @param id        Its id.
 * @param meetingId Its meeting.
 * @param startedAt When it started.
 * @returns The record.
 */
function recording(id: string, meetingId: string, startedAt: number): StoredRecording {
  return {
    id,
    sessionId: S,
    meetingId,
    part: 1,
    kind: 'screen',
    startedAt,
    durationMs: 60_000,
    bytes: 1,
    fileName: 'x.mkv',
    hasStereo: true,
    deviceId: 'd',
    deviceName: 'Office laptop',
    status: 'complete',
    updatedAt: startedAt,
  };
}

/**
 * A call record.
 * @param id        Its id.
 * @param startedAt When it connected.
 * @param extra     Other fields.
 * @returns The record.
 */
function record(id: string, startedAt: number, extra: Partial<StoredCall> = {}): StoredCall {
  return {
    id,
    sessionId: S,
    startedAt,
    endedAt: startedAt + 600_000,
    durationMs: 600_000,
    phase: 'ended',
    deviceId: 'dev',
    saveTranscript: true,
    recording: 'off',
    notesState: 'saved',
    drive: { state: 'done' },
    updatedAt: startedAt,
    ...extra,
  };
}

/**
 * Builds the calls from some data.
 * @param data What the session has.
 * @returns The calls.
 */
function build(data: Partial<SessionCallData>) {
  return buildCallViews({
    sessionId: S,
    calls: [],
    lines: [],
    answers: [],
    callNotes: [],
    legacyNotes: null,
    recordings: [],
    now: T0 + 86_400_000,
    ...data,
  });
}

describe('callIdInLineId', () => {
  it('reads the call id inside a saved line id', () => {
    expect(callIdInLineId(S, `${S}:abc:u12`)).toBe('abc');
    expect(callIdInLineId(S, 'other:abc:u12')).toBeNull();
    expect(callIdInLineId(S, `${S}-l1`)).toBeNull();
  });
});

describe('calls with a record', () => {
  it('"Start again": each call has its own lines, answers, notes and recordings, newest first', () => {
    const first = record('call-1', T0);
    const second = record('call-2', T0 + 3_600_000, { notesState: 'writing' });
    const notes = {
      callId: 'call-1',
      sessionId: S,
      notes: { summary: ['first'], questions: [], nextSteps: [], unclear: [], lessons: [] },
      callStartedAt: T0,
      createdAt: T0 + 700_000,
    } as StoredCallNotes;
    const calls = build({
      calls: [first, second],
      lines: [
        line('call-1', 1, T0 + 5_000),
        line('call-2', 1, T0 + 3_605_000),
        // A line rewritten after the call keeps its call by its id.
        line('call-2', 2, T0 + 3_610_000, { callId: undefined }),
      ],
      answers: [
        answer('a1', T0 + 10_000, T0, { callId: 'call-1' }),
        // An answer without a call id joins the call with its exact start.
        answer('a2', T0 + 3_611_000, T0 + 3_600_000),
      ],
      callNotes: [notes],
      recordings: [recording('r1', 'call-2', T0 + 3_601_000)],
    });
    expect(calls.map((call) => call.id)).toEqual(['call-2', 'call-1']);
    expect(calls[0]!.lines.map((l) => l.id)).toEqual([`${S}:call-2:u1`, `${S}:call-2:u2`]);
    expect(calls[0]!.answers.map((a) => a.id)).toEqual(['a2']);
    expect(calls[0]!.notes).toBeNull();
    expect(calls[0]!.notesState).toBe('writing');
    expect(calls[0]!.recordings.map((r) => r.id)).toEqual(['r1']);
    expect(calls[1]!.lines).toHaveLength(1);
    expect(calls[1]!.notes?.notes.summary).toEqual(['first']);
    expect(calls[1]!.durationMs).toBe(600_000);
  });

  it('a running call is as long as it has run so far', () => {
    const live = record('live', T0, { endedAt: null, durationMs: 0, phase: 'live' });
    const [call] = build({ calls: [live], now: T0 + 120_000 });
    expect(call!.durationMs).toBe(120_000);
  });
});

describe('calls made before records (worked out, never written)', () => {
  it('keeps two calls a minute apart apart, each starting at its answers’ recorded start', () => {
    const a = T0; // 23:16:01
    const b = T0 + 58_000; // 23:16:59
    const calls = build({
      lines: [
        line('saverA', 1, a + 4_000),
        line('saverA', 2, a + 20_000),
        line('saverB', 1, b + 5_000),
        line('saverB', 2, b + 40_000),
      ],
      answers: [answer('ansA', a + 30_000, a), answer('ansB', b + 45_000, b)],
    });
    expect(calls.map((call) => [call.id, call.startedAt])).toEqual([
      ['legacy-saverB', b],
      ['legacy-saverA', a],
    ]);
    expect(calls[0]!.answers.map((x) => x.id)).toEqual(['ansB']);
    expect(calls[1]!.answers.map((x) => x.id)).toEqual(['ansA']);
    expect(calls.every((call) => call.legacy && call.record === null)).toBe(true);
  });

  it('joins the older single notes row to its own call only, and recordings by time', () => {
    const late = T0 + 5_400_000;
    const notes = {
      sessionId: S,
      notes: { summary: ['old'], questions: [], nextSteps: [], unclear: [], lessons: [] },
      callStartedAt: T0,
      createdAt: T0 + 900_000,
    } as StoredNotes;
    const calls = build({
      lines: [line('first', 1, T0 + 3_000), line('second', 1, late + 3_000)],
      answers: [answer('x', T0 + 10_000, T0), answer('y', late + 10_000, late)],
      legacyNotes: notes,
      recordings: [recording('rec-late', 'm-late', late + 30_000)],
    });
    const byId = new Map(calls.map((call) => [call.id, call]));
    expect(byId.get('legacy-first')!.notes?.notes.summary).toEqual(['old']);
    // The newer call has no notes: it never shows another call's.
    expect(byId.get('legacy-second')!.notes).toBeNull();
    expect(byId.get('legacy-second')!.recordings.map((r) => r.id)).toEqual(['rec-late']);
  });

  it('works out answers-only calls ("Save transcript" off) and recording-only calls', () => {
    const calls = build({
      answers: [answer('only', T0 + 20_000, T0)],
      recordings: [recording('lonely', 'meeting-9', T0 + 7_200_000)],
    });
    expect(calls.map((call) => call.id)).toEqual(['legacy-mmeeting-9', `legacy-t${T0}`]);
    expect(calls[1]!.answers).toHaveLength(1);
    expect(calls[0]!.recordings).toHaveLength(1);
  });

  it('prefers a call’s own notes written since (Regenerate) over the older row', () => {
    const own = {
      callId: 'legacy-saverA',
      sessionId: S,
      notes: { summary: ['new'], questions: [], nextSteps: [], unclear: [], lessons: [] },
      callStartedAt: T0,
      createdAt: T0 + 1,
    } as StoredCallNotes;
    const [call] = build({
      lines: [line('saverA', 1, T0 + 3_000)],
      answers: [answer('a', T0 + 10_000, T0)],
      callNotes: [own],
      legacyNotes: {
        sessionId: S,
        notes: { summary: ['old'], questions: [], nextSteps: [], unclear: [], lessons: [] },
        callStartedAt: T0,
        createdAt: T0,
      } as StoredNotes,
    });
    expect(call!.notes?.notes.summary).toEqual(['new']);
  });
});
