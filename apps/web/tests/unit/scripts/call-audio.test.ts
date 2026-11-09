/**
 * Tests for apps/web/scripts/lib/call-audio.ts (v1.4, ADR-0063): WAV files round-trip; the seeded random
 * generator repeats; resampling keeps the length ratio; silence is trimmed; clips are placed and the track
 * grows; levels and decibels convert; the room echo is sparse with its direct sound first; the low-pass
 * filter passes a slow signal and softens a fast one; noise has the asked level; the chime is short.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  addAt,
  CALL_RATE,
  chime,
  convolve,
  dbToGain,
  lowPass,
  noise,
  readWav,
  REFLECTIONS,
  resample,
  roomImpulse,
  scaleToRms,
  seededRandom,
  speechRms,
  trimSilence,
  writeWav,
} from '../../../scripts/lib/call-audio';

const dir = mkdtempSync(path.join(tmpdir(), 'kite-call-audio-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('call-audio', () => {
  it('writes and reads a 16-bit WAV', () => {
    const file = path.join(dir, 'a.wav');
    const samples = Float32Array.from([0, 0.5, -0.5, 0.25]);
    writeWav(file, samples);
    const back = readWav(file);
    expect(back.rate).toBe(CALL_RATE);
    back.samples.forEach((value, i) => expect(value).toBeCloseTo(samples[i]!, 3));
  });

  it('repeats the same random numbers for the same seed', () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('resamples, trims silence and places clips', () => {
    expect(resample(new Float32Array(48_000), 48_000, 16_000)).toHaveLength(16_000);
    expect(Array.from(trimSilence(Float32Array.from([0, 0, 0.3, -0.2, 0, 0])))).toEqual([
      expect.closeTo(0.3, 5),
      expect.closeTo(-0.2, 5),
    ]);
    const track = addAt(new Float32Array(2), Float32Array.from([1, 1]), 3, 0.5);
    expect(Array.from(track)).toEqual([0, 0, 0, 0.5, 0.5]);
  });

  it('measures and sets levels, and converts decibels', () => {
    const tone = Float32Array.from({ length: 1_000 }, (_, i) => 0.2 * Math.sin(i / 3));
    expect(speechRms(scaleToRms(tone, 0.05))).toBeCloseTo(0.05, 2);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 6);
  });

  it('makes a sparse room echo with the direct sound first', () => {
    const ir = roomImpulse(300, 1);
    expect(ir[0]).toBe(1);
    expect(ir.filter((value) => value !== 0).length).toBeLessThanOrEqual(REFLECTIONS + 1);
    const echoed = convolve(Float32Array.from([1, 0, 0]), ir);
    expect(echoed[0]).toBe(1);
    expect(echoed).toHaveLength(3 + ir.length - 1);
  });

  it('low-pass passes a slow signal and softens a fast one', () => {
    const slow = Float32Array.from({ length: 4_000 }, (_, i) =>
      Math.sin((2 * Math.PI * 100 * i) / CALL_RATE),
    );
    const fast = Float32Array.from({ length: 4_000 }, (_, i) =>
      Math.sin((2 * Math.PI * 6_000 * i) / CALL_RATE),
    );
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
    expect(rms(lowPass(slow, 3_400))).toBeGreaterThan(0.6);
    expect(rms(lowPass(fast, 3_400))).toBeLessThan(0.45);
  });

  it('makes noise at the asked level, and a short chime', () => {
    const pink = noise(16_000, 0.01, 'pink', 3);
    const rms = Math.sqrt(pink.reduce((sum, v) => sum + v * v, 0) / pink.length);
    expect(rms).toBeCloseTo(0.01, 4);
    expect(chime().length / CALL_RATE).toBeLessThan(0.5);
  });
});
