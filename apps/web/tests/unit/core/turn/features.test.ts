/**
 * Tests for apps/web/src/core/turn/features.ts (v1.4, ADR-0065): the fast Fourier transform equals the
 * plain discrete transform for 400 points; audio is cut to its last 8 s or padded with silence at the
 * start; the mel filter bank has 80 non-negative triangles over 201 bins; and the features have the
 * model's shape (80 × 800), are finite, and lie in Whisper's range after (x + 4) / 4.
 */
import { describe, expect, it } from 'vitest';
import {
  fft,
  lastEightSeconds,
  melFilterBank,
  N_FRAMES,
  N_MELS,
  TURN_SAMPLES,
  turnFeatures,
} from '@/core/turn/features';

describe('turn features', () => {
  it('fft equals the plain discrete transform (400 points)', () => {
    const n = 400;
    const signal = Array.from(
      { length: n },
      (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.9),
    );
    const re = Float64Array.from(signal);
    const im = new Float64Array(n);
    fft(re, im);
    for (const k of [0, 1, 7, 64, 199, 200, 333]) {
      let dr = 0;
      let di = 0;
      for (let t = 0; t < n; t += 1) {
        dr += signal[t]! * Math.cos((-2 * Math.PI * k * t) / n);
        di += signal[t]! * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(dr, 6);
      expect(im[k]).toBeCloseTo(di, 6);
    }
  });

  it('keeps the last 8 s, or pads with silence at the start', () => {
    const short = Float32Array.from([1, 2, 3]);
    const padded = lastEightSeconds(short);
    expect(padded).toHaveLength(TURN_SAMPLES);
    expect(Array.from(padded.slice(-3))).toEqual([1, 2, 3]);
    expect(padded[0]).toBe(0);
    const long = Float32Array.from({ length: TURN_SAMPLES + 5 }, (_, i) => i);
    expect(lastEightSeconds(long)[0]).toBe(5);
  });

  it('has 80 non-negative triangular mel filters over 201 bins', () => {
    const bank = melFilterBank();
    expect(bank).toHaveLength(N_MELS);
    for (const row of bank) {
      expect(row).toHaveLength(201);
      expect(row.every((value) => value >= 0)).toBe(true);
      expect(row.some((value) => value > 0)).toBe(true);
    }
  });

  it('gives finite features of the model shape, in Whisper range', () => {
    const audio = Float32Array.from({ length: 32_000 }, (_, i) => 0.1 * Math.sin(i / 9));
    const features = turnFeatures(audio);
    expect(features).toHaveLength(N_MELS * N_FRAMES);
    expect(features.every((value) => Number.isFinite(value))).toBe(true);
    // log10 floored at max - 8, then (x + 4) / 4: the range spans exactly 2 at most.
    const max = Math.max(...features);
    const min = Math.min(...features);
    expect(max - min).toBeLessThanOrEqual(2 + 1e-6);
  });
});
