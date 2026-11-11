/**
 * Tests for apps/web/src/core/stt/echoCanceller.ts (1.5.2, ADR-0070), with a fake AEC3 that subtracts the
 * last reference frame it was given: the reference is analysed in 10 ms frames as it arrives; the
 * microphone comes back with as many samples as went in, one frame (10 ms) late with silence first; the
 * echo is removed; chunk sizes that are not whole frames keep the same constant lag; an output size other
 * than one frame passes the frame through unchanged.
 */
import { describe, expect, it } from 'vitest';
import { AEC_FRAME, EchoCanceller, type Aec3Instance } from '@/core/stt/echoCanceller';

/**
 * A fake AEC3: remembers the last reference frame and subtracts it from each captured frame.
 *
 * @param outSize The output size it reports (AEC_FRAME normally).
 * @returns The fake and the number of frames it analysed.
 */
function fakeAec(outSize = AEC_FRAME): { aec: Aec3Instance; analysed: () => number } {
  let reference = new Float32Array(AEC_FRAME);
  let analysed = 0;
  return {
    aec: {
      analyze: ([frame]) => {
        reference = frame!.slice();
        analysed += 1;
      },
      processSize: () => outSize,
      process: ([out], [frame]) => {
        for (let i = 0; i < out!.length; i += 1) out![i] = frame![i]! - reference[i]!;
      },
    },
    analysed: () => analysed,
  };
}

/**
 * A chunk of one value.
 *
 * @param length Samples.
 * @param value  The value of each.
 * @returns The chunk.
 */
const fill = (length: number, value: number) => new Float32Array(length).fill(value);

describe('EchoCanceller', () => {
  it('analyses the reference in 10 ms frames as it arrives', () => {
    const { aec, analysed } = fakeAec();
    const canceller = new EchoCanceller(aec);
    canceller.addReference(fill(1_600, 0.1));
    expect(analysed()).toBe(10);
    canceller.addReference(fill(100, 0.1));
    expect(analysed()).toBe(10);
    canceller.addReference(fill(60, 0.1));
    expect(analysed()).toBe(11);
  });

  it('returns as many samples, one frame late, with the echo removed', () => {
    const { aec } = fakeAec();
    const canceller = new EchoCanceller(aec);
    canceller.addReference(fill(1_600, 0.25));
    const first = canceller.cancel(fill(1_600, 0.25));
    expect(first).toHaveLength(1_600);
    // The first frame is the lag's silence; the rest is the microphone minus the echo (0).
    expect(Array.from(first.subarray(0, AEC_FRAME)).every((v) => v === 0)).toBe(true);
    expect(Math.max(...first.subarray(AEC_FRAME).map(Math.abs))).toBeLessThan(1e-6);
    canceller.addReference(fill(1_600, 0));
    const second = canceller.cancel(fill(1_600, 0.5));
    // The frame carried over from the first chunk (echo removed), then the user's own 0.5 untouched.
    expect(second[0]).toBeCloseTo(0, 6);
    expect(second[AEC_FRAME]).toBeCloseTo(0.5, 6);
  });

  it('keeps the same lag for chunks that are not whole frames', () => {
    const { aec } = fakeAec();
    const canceller = new EchoCanceller(aec);
    let out = 0;
    for (let i = 0; i < 25; i += 1) {
      canceller.addReference(fill(1_000, 0));
      const result = canceller.cancel(fill(1_000, 0.5));
      expect(result).toHaveLength(1_000);
      out += result.length;
      // After the first chunk, every sample is the user's (nothing missing, no gap of silence).
      if (i > 0) expect(Math.min(...result)).toBeCloseTo(0.5, 6);
    }
    expect(out).toBe(25_000);
  });

  it('passes a frame through when the engine reports another output size', () => {
    const { aec } = fakeAec(AEC_FRAME * 3);
    const canceller = new EchoCanceller(aec);
    canceller.addReference(fill(AEC_FRAME * 2, 0.25));
    const result = canceller.cancel(fill(AEC_FRAME * 2, 0.25));
    expect(result[AEC_FRAME]).toBeCloseTo(0.25, 6);
  });
});
