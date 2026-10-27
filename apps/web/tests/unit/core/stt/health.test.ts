/**
 * Tests for apps/web/src/core/stt/health.ts:
 * SttHealthMonitor reports 'ok' while decoding keeps up (and before any statistics),
 * 'falling-behind' only after the per-second real-time factor stays above 0.8 for 5 s (a short
 * spike does not count), 'stalled' when statistics stop for 3 s, and returns to 'ok' when
 * decoding recovers; healthMessage() gives the user-facing text.
 */
import { describe, expect, it } from 'vitest';
import { healthMessage, SttHealthMonitor } from '@/core/stt/health';
import type { EngineStats } from '@/core/stt/protocol';

/** Statistics with the given cumulative totals. */
function stats(totalDecodeMs: number, totalAudioMs: number): EngineStats {
  return { channels: {}, combinedRtf: 0, totalDecodeMs, totalAudioMs, wasmMemoryBytes: 0 };
}

/**
 * Feeds one statistics message per second with the given per-second real-time factors.
 *
 * @returns The monitor and the time of the last message.
 */
function feed(rtfs: number[]) {
  const monitor = new SttHealthMonitor();
  let decode = 0;
  let audio = 0;
  let at = 0;
  monitor.push(stats(decode, audio), at);
  for (const rtf of rtfs) {
    audio += 1_000;
    decode += rtf * 1_000;
    at += 1_000;
    monitor.push(stats(decode, audio), at);
  }
  return { monitor, at };
}

describe('SttHealthMonitor', () => {
  it('is ok before any statistics and while decoding keeps up', () => {
    expect(new SttHealthMonitor().status(0)).toBe('ok');
    const { monitor, at } = feed([0.3, 0.4, 0.5, 0.3, 0.6, 0.4]);
    expect(monitor.status(at)).toBe('ok');
  });

  it('reports falling-behind only after 5 s above 0.8', () => {
    expect(feed([0.9, 0.9, 0.9, 0.9]).monitor.status(4_000)).toBe('ok');
    const { monitor, at } = feed([0.9, 0.95, 1.1, 0.9, 1.0]);
    expect(monitor.status(at)).toBe('falling-behind');
  });

  it('ignores a short spike and recovers when decoding speeds up', () => {
    expect(feed([0.9, 0.9, 0.3, 0.9, 0.9, 0.9]).monitor.status(6_000)).toBe('ok');
    const { monitor, at } = feed([1, 1, 1, 1, 1, 0.4]);
    expect(monitor.status(at)).toBe('ok');
  });

  it('treats seconds without new audio as not slow', () => {
    const monitor = new SttHealthMonitor();
    for (let i = 0; i < 8; i += 1) monitor.push(stats(100, 1_000), i * 1_000);
    expect(monitor.status(7_000)).toBe('ok');
  });

  it('reports stalled when statistics stop arriving for 3 s, and forgets on reset()', () => {
    const { monitor, at } = feed([0.3, 0.3]);
    expect(monitor.status(at + 2_999)).toBe('ok');
    expect(monitor.status(at + 3_000)).toBe('stalled');
    monitor.reset();
    expect(monitor.status(at + 10_000)).toBe('ok');
  });
});

describe('healthMessage', () => {
  it('has text for problems and nothing for ok', () => {
    expect(healthMessage('ok')).toBeNull();
    expect(healthMessage('falling-behind')).toMatch(/plug in your laptop/);
    expect(healthMessage('stalled')).toMatch(/stopped responding/);
  });
});
