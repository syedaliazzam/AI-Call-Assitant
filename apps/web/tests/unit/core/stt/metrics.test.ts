/**
 * Tests for apps/web/src/core/stt/metrics.ts:
 * OnsetDetector finds speech after at least 0.5 s of quiet (to the 10 ms frame, also across
 * chunk boundaries) and ignores speech without a quiet stretch before it; realTimeFactor and
 * median compute what the spike reports.
 */
import { describe, expect, it } from 'vitest';
import { median, OnsetDetector, realTimeFactor } from '@/core/stt/metrics';

/** 16 kHz, 100 ms chunks. */
const RATE = 16_000;
const CHUNK = 1_600;

/** Quiet background noise (very low level). */
function quiet(count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, i) => 0.001 * Math.sin(i));
}

/** Loud "speech" (a 300 Hz tone at 0.3). */
function speech(count: number): Float32Array {
  return Float32Array.from(
    { length: count },
    (_, i) => 0.3 * Math.sin((2 * Math.PI * 300 * i) / RATE),
  );
}

describe('OnsetDetector', () => {
  it('finds the onset frame inside the chunk where speech starts after quiet', () => {
    const detector = new OnsetDetector({ sampleRate: RATE });
    for (let i = 0; i < 6; i += 1) expect(detector.push(quiet(CHUNK))).toBe(-1); // 0.6 s quiet
    const chunk = new Float32Array(CHUNK);
    chunk.set(quiet(800), 0);
    chunk.set(speech(800), 800); // speech starts halfway (sample 800 = frame 5)
    expect(detector.push(chunk)).toBe(800);
  });

  it('reports only the first onset of an utterance', () => {
    const detector = new OnsetDetector({ sampleRate: RATE });
    for (let i = 0; i < 6; i += 1) detector.push(quiet(CHUNK));
    expect(detector.push(speech(CHUNK))).toBe(0);
    expect(detector.push(speech(CHUNK))).toBe(-1);
  });

  it('needs 0.5 s of quiet before a new onset counts', () => {
    const detector = new OnsetDetector({ sampleRate: RATE });
    for (let i = 0; i < 6; i += 1) detector.push(quiet(CHUNK));
    detector.push(speech(CHUNK));
    detector.push(quiet(CHUNK * 2)); // only 0.2 s pause
    expect(detector.push(speech(CHUNK))).toBe(-1);
    for (let i = 0; i < 6; i += 1) detector.push(quiet(CHUNK)); // 0.6 s pause
    expect(detector.push(speech(CHUNK))).toBe(0);
  });

  it('works with chunks that do not align with 10 ms frames', () => {
    const detector = new OnsetDetector({ sampleRate: RATE });
    for (let i = 0; i < 9; i += 1) detector.push(quiet(1_000)); // 0.56 s
    const index = detector.push(speech(1_000));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(160);
  });
});

describe('realTimeFactor', () => {
  it('divides processing time by audio time', () => {
    expect(realTimeFactor(250, 1_000)).toBe(0.25);
    expect(realTimeFactor(10, 0)).toBe(0);
  });
});

describe('median', () => {
  it('handles odd, even and empty lists without changing the input', () => {
    const values = [500, 100, 300];
    expect(median(values)).toBe(300);
    expect(values).toEqual([500, 100, 300]);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
