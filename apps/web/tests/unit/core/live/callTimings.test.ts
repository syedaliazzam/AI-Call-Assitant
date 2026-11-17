/**
 * Tests apps/web/src/core/live/callTimings.ts (1.5.1, ADR-0069): the device-side call timing log records
 * lines (first grey words and final), the backlog once a second, Accurate outcomes, answers (updated by
 * id) and notices; End saves the call, newest first, keeping five; the summary gives p50 / p95. Never text.
 * 1.5.2 (ADR-0070): the per-card table: moments in seconds since the call started, intervals in ms, the
 * trigger and the grey / early / rerun flags, nulls where a moment is missing.
 */
import { describe, expect, it } from 'vitest';
import {
  cardTimings,
  createCallTimings,
  MAX_CALLS,
  percentiles,
  summarizeCall,
  type TimingStore,
} from '@/core/live/callTimings';

/**
 * An in-memory store.
 *
 * @returns The store, with its saved text.
 */
function memoryStore(): TimingStore & { text: string | null } {
  const store = {
    text: null as string | null,
    read: () => store.text,
    write: (text: string) => {
      store.text = text;
    },
  };
  return store;
}

const START = {
  sessionId: 's1',
  platform: 'desktop',
  accurate: true,
  recording: 'off',
  documentChars: 2_000,
};

describe('createCallTimings', () => {
  it('records a call and saves it at End', () => {
    const store = memoryStore();
    const timings = createCallTimings(store, () => 0);
    timings.start({ ...START, startedAt: 1_000 });
    timings.notePartial('them', 2_000);
    timings.notePartial('them', 2_500);
    timings.noteFinal({ id: 'u1', speaker: 'them', tStart: 1_500, tEnd: 4_000 }, 5_000);
    timings.noteBacklog(
      { state: 'ok', lagMs: 10, maxLagMs: 40, deferredMs: 0, deferredDroppedMs: 0, droppedMs: 0 },
      5_100,
    );
    timings.noteBacklog(
      { state: 'ok', lagMs: 10, maxLagMs: 90, deferredMs: 0, deferredDroppedMs: 0, droppedMs: 0 },
      5_200,
    );
    timings.noteRefine('u1', 'done', 5_300);
    timings.noteAnswer({ answerId: 'a1', trigger: 'hotkey', askedAt: 5_000, sentAt: 5_010 });
    timings.noteAnswer({ answerId: 'a1', firstWordAt: 6_000, status: 'done', doneAt: 6_500 });
    timings.noteNotice('mic-silent', 7_000);
    timings.end(8_000);
    expect(timings.current()).toBeNull();
    const [call] = timings.saved();
    expect(call).toMatchObject({ startedAt: 1_000, endedAt: 8_000, documentChars: 2_000 });
    // The first grey words of the line, not the later ones.
    expect(call!.lines).toEqual([
      { id: 'u1', speaker: 'them', tStart: 1_500, tEnd: 4_000, partialAt: 2_000, finalAt: 5_000 },
    ]);
    // One backlog entry per second.
    expect(call!.backlog).toEqual([[5_100, 40, 'ok']]);
    expect(call!.answers).toHaveLength(1);
    expect(call!.answers[0]).toMatchObject({ firstWordAt: 6_000, status: 'done', doneAt: 6_500 });
    expect(call!.notices).toEqual([[7_000, 'mic-silent']]);
  });

  it('keeps the last five calls, newest first', () => {
    const timings = createCallTimings(memoryStore(), () => 0);
    for (let i = 0; i < MAX_CALLS + 2; i += 1) {
      timings.start({ ...START, startedAt: i });
      timings.end(i + 1);
    }
    expect(timings.saved().map((call) => call.startedAt)).toEqual([6, 5, 4, 3, 2]);
  });

  it('records nothing without a started call, and survives a broken store', () => {
    const timings = createCallTimings({ read: () => '{not json', write: () => undefined });
    timings.noteNotice('mic-silent');
    timings.end();
    expect(timings.saved()).toEqual([]);
  });
});

describe('summarizeCall', () => {
  it('gives the re-test numbers', () => {
    const timings = createCallTimings(memoryStore(), () => 0);
    timings.start({ ...START, startedAt: 0 });
    timings.notePartial('them', 1_800);
    timings.noteFinal({ id: 'u1', speaker: 'them', tStart: 1_000, tEnd: 3_000 }, 4_200);
    timings.noteAnswer({ answerId: 'a', trigger: 'hotkey', askedAt: 4_000, sentAt: 4_020 });
    timings.noteAnswer({ answerId: 'a', firstWordAt: 5_500 });
    timings.noteAnswer({
      answerId: 'b',
      trigger: 'auto',
      askedAt: 9_000,
      sentAt: 9_000,
      speechEnd: 7_000,
    });
    timings.noteAnswer({ answerId: 'b', firstWordAt: 10_000 });
    const summary = summarizeCall(timings.current()!);
    expect(summary.themFirstWords).toEqual({ n: 1, p50: 800, p95: 800 });
    expect(summary.themFinal).toEqual({ n: 1, p50: 1_200, p95: 1_200 });
    expect(summary.pressToFirstWord).toEqual({ n: 1, p50: 1_500, p95: 1_500 });
    expect(summary.autoToFirstWord).toEqual({ n: 1, p50: 3_000, p95: 3_000 });
    expect(summary.pressToSent).toEqual({ n: 1, p50: 20, p95: 20 });
    expect(summary.triggers).toEqual({ hotkey: 1, auto: 1 });
  });

  it('percentiles of nothing are null', () => {
    expect(percentiles([])).toEqual({ n: 0, p50: null, p95: null });
    expect(percentiles([3, 1, 2])).toEqual({ n: 3, p50: 2, p95: 3 });
  });
});

describe('cardTimings (1.5.2, ADR-0070)', () => {
  it('ADR-0099: names the model that fell back to Claude Haiku (Groq in an older log)', () => {
    const start = 1_700_000_000_000;
    const t = createCallTimings({ read: () => null, write: () => undefined }, () => start);
    t.start({
      sessionId: 's',
      startedAt: start,
      platform: 'web',
      accurate: true,
      recording: 'off',
      documentChars: 0,
    });
    t.noteAnswer({ answerId: 'a', trigger: 'auto', askedAt: start, sentAt: start });
    t.noteAnswer({
      answerId: 'a',
      model: 'fast',
      fallback: 'timeout',
      fallbackFrom: 'gemini-lite',
    });
    t.noteAnswer({ answerId: 'b', trigger: 'auto', askedAt: start, sentAt: start });
    t.noteAnswer({ answerId: 'b', model: 'fast', fallback: 'error' });
    const cards = cardTimings(t.current()!);
    expect(cards[0]!.flags).toEqual(['gemini-lite-fallback-timeout']);
    expect(cards[1]!.flags).toEqual(['groq-fallback-error']);
  });

  it('lists each card with its moments and intervals', () => {
    const start = 1_700_000_000_000;
    const t = createCallTimings({ read: () => null, write: () => undefined }, () => start);
    t.start({
      sessionId: 's',
      startedAt: start,
      platform: 'desktop',
      accurate: true,
      recording: 'off',
      documentChars: 0,
    });
    t.noteAnswer({
      answerId: 'a',
      trigger: 'auto',
      askedAt: start + 10_900,
      speechEnd: start + 10_000,
      sentAt: start + 10_950,
      early: true,
      grey: true,
    });
    t.noteAnswer({ answerId: 'a', firstWordAt: start + 12_000 });
    t.noteAnswer({ answerId: 'a', status: 'done', doneAt: start + 13_000 });
    t.noteAnswer({
      answerId: 'a~1',
      trigger: 'auto',
      askedAt: start + 15_000,
      speechEnd: start + 14_000,
      sentAt: start + 15_000,
      rerunOf: 'a',
    });
    const cards = cardTimings(t.current()!);
    expect(cards[0]).toMatchObject({
      n: 1,
      trigger: 'auto',
      flags: ['grey', 'early'],
      status: 'done',
      questionEnd: 10,
      sent: 11,
      firstWord: 12,
      done: 13,
      endToSentMs: 950,
      endToFirstWordMs: 2_000,
      askedToFirstWordMs: 1_100,
      sentToFirstWordMs: 1_050,
      firstWordToDoneMs: 1_000,
    });
    expect(cards[1]).toMatchObject({
      n: 2,
      flags: ['rerun'],
      firstWord: null,
      endToFirstWordMs: null,
    });
    t.noteEchoCancel('on');
    expect(t.current()!.echoCancel).toBe('on');
  });

  it("ADR-0094: records the model per answer; the server's tier replaces the one asked for", () => {
    const start = 1_700_000_000_000;
    const t = createCallTimings({ read: () => null, write: () => undefined }, () => start);
    t.start({
      sessionId: 's',
      startedAt: start,
      platform: 'desktop',
      accurate: true,
      recording: 'off',
      documentChars: 0,
    });
    // Asked on Fast, then the model is switched mid-call: the next one asks for Smart.
    t.noteAnswer({ answerId: 'a', sentAt: start + 1_000, model: 'fast' });
    t.noteAnswer({ answerId: 'b', sentAt: start + 5_000, model: 'smart' });
    // An admin turned Smart off: the server answered with the fast model, and says so.
    t.noteAnswer({ answerId: 'b', status: 'done', doneAt: start + 6_000, model: 'fast' });
    t.noteAnswer({ answerId: 'c', sentAt: start + 9_000 });
    const cards = cardTimings(t.current()!);
    expect(cards.map((card) => card.model)).toEqual(['fast', 'fast', null]);
    expect(t.current()!.answers.map((answer) => answer.model)).toEqual(['fast', 'fast', undefined]);
  });
});
