/**
 * Tests for apps/web/src/core/audio/levels.ts:
 * rms() measures loudness; rmsToLevel() maps -60…-10 dBFS onto 0…1 (clamped; silence is 0);
 * LevelSmoother rises fast and falls slowly.
 */
import { describe, expect, it } from 'vitest';
import { LevelSmoother, MAX_DB, MIN_DB, rms, rmsToLevel } from '@/core/audio/levels';

describe('rms', () => {
  it('measures root-mean-square loudness', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe('rmsToLevel', () => {
  it('maps the decibel range onto 0…1 and clamps outside it', () => {
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(10 ** (MIN_DB / 20))).toBeCloseTo(0);
    expect(rmsToLevel(10 ** (MAX_DB / 20))).toBeCloseTo(1);
    expect(rmsToLevel(10 ** (-35 / 20))).toBeCloseTo(0.5);
    expect(rmsToLevel(1)).toBe(1);
    expect(rmsToLevel(0.00001)).toBe(0);
  });
});

describe('LevelSmoother', () => {
  it('rises fast and falls slowly', () => {
    const smoother = new LevelSmoother();
    const up = smoother.update(1);
    expect(up).toBeGreaterThan(0.5);
    const down = smoother.update(0);
    expect(down).toBeGreaterThan(up * 0.8);
    let level = down;
    for (let i = 0; i < 40; i += 1) level = smoother.update(0);
    expect(level).toBeLessThan(0.01);
  });
});
