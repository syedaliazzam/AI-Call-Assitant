/**
 * Tests for the timing trace in apps/web/src/core/live/callTimings.ts (ADR-0076, investigation T0.1): off
 * by default; with "Timing trace" on, a call keeps timed events (codes and numbers only), the engine of each
 * line and of the call, and the summary counts failovers, press decisions and the press wait.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createCallTimings,
  setTraceEnabled,
  summarizeCall,
  traceEnabled,
  TRACE_KEY,
} from '@/core/live/callTimings';

/**
 * A localStorage stand-in.
 *
 * @returns Its values.
 */
function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

/**
 * A store for saved calls.
 *
 * @returns The store.
 */
function memory() {
  let text: string | null = null;
  return {
    read: () => text,
    write: (next: string) => {
      text = next;
    },
  };
}

/** A call's start. */
const START = {
  sessionId: 's1',
  startedAt: 1_000,
  platform: 'desktop',
  accurate: false,
  recording: 'off',
  documentChars: 0,
};

describe('timing trace', () => {
  it('is off by default and switched on per device', () => {
    const values = stubStorage();
    expect(traceEnabled()).toBe(false);
    setTraceEnabled(true);
    expect(values.get(TRACE_KEY)).toBe('1');
    expect(traceEnabled()).toBe(true);
    setTraceEnabled(false);
    expect(traceEnabled()).toBe(false);
  });

  it('records nothing extra while off', () => {
    stubStorage();
    const timings = createCallTimings(memory(), () => 2_000);
    timings.start(START);
    timings.noteTrace('press', { trigger: 'hotkey' });
    expect(timings.tracing()).toBe(false);
    expect(timings.current()?.trace).toBeUndefined();
  });

  it('keeps events, engines and press details while on, and summarises them', () => {
    stubStorage();
    setTraceEnabled(true);
    const timings = createCallTimings(memory(), () => 2_000);
    timings.start(START);
    timings.noteEngine('deepgram');
    timings.noteFinal({
      id: 'u1',
      speaker: 'them',
      tStart: 1_100,
      tEnd: 1_900,
      engine: 'deepgram',
    });
    timings.noteTrace('failover', { channel: 'them', to: 'local', reason: 'closed' });
    timings.noteEngine('local');
    timings.noteFinal({ id: 'u2', speaker: 'them', tStart: 2_100, tEnd: 2_900, engine: 'local' });
    timings.noteTrace('press-wait', { waitedMs: 120, timedOut: false, forced: false });
    timings.noteTrace('press-decision', { decision: 'sent' });
    timings.noteTrace('press-decision', { decision: 'shown-existing' });
    timings.noteAnswer({ answerId: 'a1', cacheRead: 4_000, serverMs: { firstText: 420 } });
    // Batch C: speculative answers and the recording's frames.
    timings.noteTrace('speculative', { state: 'held', answerId: 'a2', ms: 0 });
    timings.noteTrace('speculative', { state: 'cancelled', answerId: 'a2', ms: 180 });
    timings.noteTrace('rec-frames', { delivered: 148, discarded: 0, fps: 14.8, cap: 15 });
    const log = timings.current()!;
    expect(log.engine).toBe('mixed');
    expect(log.trace?.map(([, kind]) => kind)).toEqual([
      'failover',
      'press-wait',
      'press-decision',
      'press-decision',
      'speculative',
      'speculative',
      'rec-frames',
    ]);
    const summary = summarizeCall(log);
    expect(summary.lineEngines).toEqual({ deepgram: 1, local: 1 });
    expect(summary.failovers).toBe(1);
    expect(summary.pressDecisions).toEqual({ sent: 1, 'shown-existing': 1 });
    expect(summary.pressWait).toMatchObject({ n: 1, p50: 120 });
    expect(summary.speculative).toEqual({ held: 1, cancelled: 1 });
    expect(summary.recordingFps).toMatchObject({ n: 1, p50: 15 });
    expect(log.answers[0]).toMatchObject({ cacheRead: 4_000, serverMs: { firstText: 420 } });
  });
});
