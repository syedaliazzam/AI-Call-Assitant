/**
 * Tests for apps/web/src/core/live/afterCall.ts (ADR-0077: after-call work outside the call page):
 * - the next step of a call: wait while it runs here; end a call whose window closed; notes; then Drive
 *   (after the notes, and after the call window's short hold for its rewrite);
 * - notes: from the lines the call page handed over (also with "Save transcript" off), else the saved
 *   ones; "skipped" when nothing was heard or answered; from the answers only when the lines were kept in
 *   memory and the window closed; tried again a minute later, "failed" after three tries or at once when
 *   Claude is unavailable, or (ADR-0121) when the same request would fail the same way again;
 * - Drive: queued once the notes are settled (its own job, from this call), or 'off' when the account does
 *   not save to Drive; never before the notes;
 * - one call failing never stops the others.
 * All values are invented; nothing reaches a server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_NOTES_ATTEMPTS,
  NOTES_RETRY_MS,
  handOffCall,
  markCallLiveHere,
  nextAfterCallStep,
  runAfterCall,
  type AfterCallDeps,
  type CallNotesData,
} from '@/core/live/afterCall';
import type { NotesOutcome } from '@/core/notes/generate';
import type { CallJobInput } from '@/core/storage/driveCallJobs';
import type { Session, StoredCall } from '@/core/storage/types';

/** Now. */
const NOW = new Date(2026, 10, 13, 1, 10).getTime();

/**
 * A call record.
 * @param id    Its id.
 * @param extra Other fields.
 * @returns The record.
 */
function call(id: string, extra: Partial<StoredCall> = {}): StoredCall {
  return {
    id,
    sessionId: 's1',
    startedAt: NOW - 1_000_000,
    endedAt: NOW - 60_000,
    durationMs: 940_000,
    phase: 'ended',
    deviceId: 'dev',
    saveTranscript: true,
    recording: 'screen',
    heardLines: 3,
    notesState: 'writing',
    drive: { state: 'waiting' },
    updatedAt: NOW - 60_000,
    ...extra,
  };
}

/** What a world saw. */
interface Seen {
  /** The notes requests' line counts and answer counts. */
  notes: { lines: number; answers: number }[];
  /** The Drive jobs queued. */
  queued: CallJobInput[];
}

/**
 * A world of fakes.
 * @param calls    The device's calls.
 * @param options  What differs.
 * @returns The deps, the records as they change, and what was seen.
 */
function world(
  calls: StoredCall[],
  options: {
    outcome?: (call: StoredCall) => NotesOutcome;
    data?: Partial<CallNotesData>;
    saves?: boolean;
    live?: boolean;
  } = {},
) {
  const records = new Map(calls.map((one) => [one.id, { ...one }]));
  const seen: Seen = { notes: [], queued: [] };
  const deps: AfterCallDeps = {
    calls: async () => [...records.values()],
    update: async (id, changes) => {
      const current = records.get(id);
      if (!current) return false;
      records.set(id, { ...current, ...changes, updatedAt: NOW });
      return true;
    },
    callLive: async () => options.live ?? false,
    session: async () => ({ id: 's1', saveTranscript: true }) as Session,
    documents: async () => [],
    callData: async () => ({
      lines: [{ speaker: 'them', text: 'saved line', tStart: NOW - 900_000 }],
      answers: [],
      lastAt: NOW - 120_000,
      ...options.data,
    }),
    writeNotes: async (one, input) => {
      seen.notes.push({ lines: input.lines.length, answers: input.answers.length });
      return options.outcome?.(one) ?? ({ status: 'saved', stored: {} } as unknown as NotesOutcome);
    },
    driveSaves: async () => options.saves ?? true,
    queueDrive: async (input) => {
      seen.queued.push(input);
    },
    now: () => NOW,
  };
  return { deps, records, seen };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('nextAfterCallStep', () => {
  it('waits while the call runs, ends a call whose window closed, then notes, then Drive', () => {
    const live = call('a', { phase: 'live', endedAt: null });
    expect(nextAfterCallStep(live, true, NOW)).toBe('wait');
    expect(nextAfterCallStep(live, false, NOW)).toBe('finish-call');
    expect(nextAfterCallStep(call('b', { phase: 'ending' }), false, NOW)).toBe('finish-call');
    expect(nextAfterCallStep(call('c'), false, NOW)).toBe('notes');
    // A failed try waits a minute.
    expect(
      nextAfterCallStep(call('d', { notesAttempts: 1, updatedAt: NOW - 1_000 }), false, NOW),
    ).toBe('wait');
    expect(
      nextAfterCallStep(
        call('d', { notesAttempts: 1, updatedAt: NOW - NOTES_RETRY_MS }),
        false,
        NOW,
      ),
    ).toBe('notes');
    const settled = call('e', { notesState: 'saved' });
    expect(nextAfterCallStep(settled, false, NOW)).toBe('drive');
    // The call window's rewrite holds Drive for a while, never longer.
    expect(nextAfterCallStep({ ...settled, driveHoldUntil: NOW + 1 }, false, NOW)).toBe('wait');
    expect(nextAfterCallStep({ ...settled, driveHoldUntil: NOW }, false, NOW)).toBe('drive');
    expect(
      nextAfterCallStep(call('f', { notesState: 'saved', drive: { state: 'queued' } }), false, NOW),
    ).toBe('none');
  });
});

describe('runAfterCall', () => {
  it('writes the notes from the lines the call page handed over, then queues the call for Drive', async () => {
    const w = world([call('c1', { saveTranscript: false })]);
    handOffCall('c1', {
      lines: [
        { speaker: 'them', text: 'a', tStart: 1 },
        { speaker: 'you', text: 'b', tStart: 2 },
      ],
    });
    await runAfterCall(w.deps);
    expect(w.seen.notes).toEqual([{ lines: 2, answers: 0 }]);
    expect(w.records.get('c1')).toMatchObject({ notesState: 'saved', drive: { state: 'queued' } });
    expect(w.seen.queued).toEqual([
      {
        callId: 'c1',
        sessionId: 's1',
        startedAt: NOW - 1_000_000,
        endedAt: NOW - 60_000,
        recordingMatch: 'meeting',
        origin: 'call',
      },
    ]);
  });

  it('ends a call whose window closed, and writes its notes from the saved lines (the panel)', async () => {
    const w = world([
      call('c2', { phase: 'ending', endedAt: null, durationMs: 0, heardLines: undefined }),
    ]);
    await runAfterCall(w.deps);
    const after = w.records.get('c2')!;
    expect(after).toMatchObject({ phase: 'ended', endedAt: NOW - 120_000, heardLines: 1 });
    expect(w.seen.notes).toEqual([{ lines: 1, answers: 0 }]);
    expect(after.notesState).toBe('saved');
    expect(w.seen.queued).toHaveLength(1);
  });

  it('never touches a call still live on this device', async () => {
    const w = world([call('c3', { phase: 'live', endedAt: null })], { live: true });
    await runAfterCall(w.deps);
    expect(w.records.get('c3')!.phase).toBe('live');
    expect(w.seen.notes).toHaveLength(0);
    // Nor one running in this window, even where the call lock cannot be read.
    const here = world([call('c3b', { phase: 'live', endedAt: null })]);
    markCallLiveHere('c3b', true);
    await runAfterCall(here.deps);
    expect(here.records.get('c3b')!.phase).toBe('live');
    markCallLiveHere('c3b', false);
  });

  it('skips the notes when nothing was heard or answered ("No notes — nothing was heard")', async () => {
    const w = world([call('c4', { heardLines: 0 })], { data: { lines: [] } });
    await runAfterCall(w.deps);
    expect(w.seen.notes).toHaveLength(0);
    expect(w.records.get('c4')).toMatchObject({
      notesState: 'skipped',
      drive: { state: 'queued' },
    });
  });

  it('writes from the answers only when the lines were in memory and the window closed', async () => {
    const answer = { id: 'a', createdAt: NOW - 500_000 } as never;
    const w = world([call('c5', { saveTranscript: false, heardLines: 12 })], {
      data: { lines: [], answers: [answer] },
    });
    await runAfterCall(w.deps);
    expect(w.seen.notes).toEqual([{ lines: 0, answers: 1 }]);
    // No answers either: it says why.
    const none = world([call('c6', { saveTranscript: false, heardLines: 12 })], {
      data: { lines: [] },
    });
    await runAfterCall(none.deps);
    expect(none.records.get('c6')).toMatchObject({
      notesState: 'failed',
      notesError: 'lines-lost',
    });
    // Drive still goes (the recording and what else there is).
    expect(none.seen.queued).toHaveLength(1);
  });

  it('tries the notes again a minute later, gives up after three tries, and Drive then goes', async () => {
    const failed: NotesOutcome = { status: 'failed', unavailable: null };
    const w = world([call('c7')], { outcome: () => failed });
    await runAfterCall(w.deps);
    expect(w.records.get('c7')).toMatchObject({ notesState: 'writing', notesAttempts: 1 });
    expect(w.seen.queued).toHaveLength(0);
    // Not again within the minute.
    await runAfterCall(w.deps);
    expect(w.seen.notes).toHaveLength(1);
    for (let attempt = 2; attempt <= MAX_NOTES_ATTEMPTS; attempt += 1) {
      w.records.set('c7', { ...w.records.get('c7')!, updatedAt: NOW - NOTES_RETRY_MS });
      await runAfterCall(w.deps);
    }
    expect(w.seen.notes).toHaveLength(MAX_NOTES_ATTEMPTS);
    expect(w.records.get('c7')).toMatchObject({ notesState: 'failed', notesError: 'failed' });
    expect(w.seen.queued).toHaveLength(1);
  });

  it('gives up at once when Claude is unavailable (a usage limit)', async () => {
    const w = world([call('c8')], {
      outcome: () => ({ status: 'failed', unavailable: 'usageLimit' }) as NotesOutcome,
    });
    await runAfterCall(w.deps);
    expect(w.records.get('c8')).toMatchObject({ notesState: 'failed', notesError: 'usageLimit' });
  });

  it('ADR-0121: gives up at once on a failure the same request would meet again (no paid retries)', async () => {
    const w = world([call('c8b')], {
      outcome: () => ({ status: 'failed', unavailable: null, final: true }) as NotesOutcome,
    });
    await runAfterCall(w.deps);
    expect(w.seen.notes).toHaveLength(1);
    expect(w.records.get('c8b')).toMatchObject({
      notesState: 'failed',
      notesError: 'failed',
      notesAttempts: 1,
    });
    // A minute later nothing is sent again, and the call goes on to Drive.
    w.records.set('c8b', { ...w.records.get('c8b')!, updatedAt: NOW - NOTES_RETRY_MS });
    await runAfterCall(w.deps);
    expect(w.seen.notes).toHaveLength(1);
    expect(w.seen.queued).toHaveLength(1);
  });

  it('marks Drive "off" when the account does not save to Drive, and keeps going past a failure', async () => {
    const w = world([call('c9', { notesState: 'saved' }), call('c10', { notesState: 'saved' })], {
      saves: false,
    });
    const update = w.deps.update;
    w.deps.update = async (id, changes) => {
      if (id === 'c9') throw new Error('storage');
      return update(id, changes);
    };
    await runAfterCall(w.deps);
    expect(w.records.get('c10')!.drive.state).toBe('off');
    expect(w.seen.queued).toHaveLength(0);
  });
});
