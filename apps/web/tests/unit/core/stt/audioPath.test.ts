/**
 * Tests for the cloud path's audio pieces (ADR-0076): apps/web/src/core/stt/captureClock.ts (one capture
 * clock: the smallest transit offset over a sliding window), apps/web/src/core/stt/ringBuffer.ts (the last
 * 10 s per channel), and apps/web/src/core/stt/audioCleaner.ts ("Them" passes through as the reference;
 * "You" is held until its reference arrived, then cleaned; 16-bit PCM for Deepgram).
 */
import { describe, expect, it } from 'vitest';
import { AudioCleaner, toLinear16, type CleanChunk } from '@/core/stt/audioCleaner';
import { CaptureClock, CLOCK_BUCKET_MS, CLOCK_BUCKETS } from '@/core/stt/captureClock';
import type { EchoCanceller } from '@/core/stt/echoCanceller';
import { RingBuffer } from '@/core/stt/ringBuffer';

describe('CaptureClock', () => {
  it('uses the smallest offset seen (the chunk that waited least)', () => {
    const clock = new CaptureClock();
    expect(clock.offsetMs()).toBeNull();
    clock.observe(10, 1_000_000_000 + 10_050);
    clock.observe(10.1, 1_000_000_000 + 10_120);
    clock.observe(10.2, 1_000_000_000 + 10_230);
    expect(clock.offsetMs()).toBe(1_000_000_000 + 20);
    expect(clock.toUnix(11)).toBe(1_000_000_000 + 11_020);
  });

  it('forgets offsets older than the window, so it follows a slow drift', () => {
    const clock = new CaptureClock();
    const base = 2_000_000_000_000;
    clock.observe(0, base + 5);
    for (let i = 1; i <= CLOCK_BUCKETS + 1; i += 1) {
      const at = base + i * CLOCK_BUCKET_MS;
      clock.observe((at - base - 50) / 1000, at);
    }
    // The 5 ms offset of the first bucket has gone; the later chunks all waited 50 ms.
    expect(clock.offsetMs()).toBe(base + 50);
  });
});

describe('RingBuffer', () => {
  const chunk = (endTime: number) => ({ samples: new Float32Array(1_280), endTime });

  it('keeps the last 10 s and returns the chunks after a moment', () => {
    const ring = new RingBuffer();
    for (let i = 1; i <= 200; i += 1) ring.push(chunk(i * 0.08));
    // 200 chunks of 80 ms = 16 s: only the last 10 s are kept.
    expect(ring.oldestStart()).toBeCloseTo(6, 1);
    expect(ring.since(15).length).toBe(13);
    ring.clear();
    expect(ring.oldestStart()).toBeNull();
  });
});

describe('toLinear16', () => {
  it('writes little-endian 16-bit samples, clamped', () => {
    const view = new DataView(toLinear16(new Float32Array([0, 1, -1, 2, -0.5])));
    expect(view.byteLength).toBe(10);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(32_767);
    expect(view.getInt16(4, true)).toBe(-32_768);
    expect(view.getInt16(6, true)).toBe(32_767);
    expect(view.getInt16(8, true)).toBe(-16_384);
  });
});

describe('AudioCleaner', () => {
  /**
   * An echo canceller that halves the microphone and records the reference it got.
   *
   * @returns The canceller and the reference lengths it got.
   */
  const fakeEcho = () => {
    const references: number[] = [];
    const canceller = {
      addReference: (samples: Float32Array) => references.push(samples.length),
      cancel: (samples: Float32Array) => samples.map((value) => value / 2),
    } as unknown as EchoCanceller;
    return { canceller, references };
  };

  it('passes "Them" through at once and uses it as the reference', () => {
    const out: CleanChunk[] = [];
    const echo = fakeEcho();
    const cleaner = new AudioCleaner(
      (chunk) => out.push(chunk),
      () => echo.canceller,
    );
    cleaner.attach('them');
    const them = new Float32Array(1_280).fill(0.1);
    cleaner.push('them', them, 1.08);
    expect(out).toEqual([{ channel: 'them', samples: them, endTime: 1.08 }]);
    expect(echo.references).toEqual([1_280]);
    expect(cleaner.echoState()).toBe('on');
  });

  it('holds "You" until the reference up to its end arrived, then sends it cleaned, in order', () => {
    const out: CleanChunk[] = [];
    const echo = fakeEcho();
    const cleaner = new AudioCleaner(
      (chunk) => out.push(chunk),
      () => echo.canceller,
    );
    cleaner.attach('them');
    cleaner.push('them', new Float32Array(1_280), 1.0);
    cleaner.push('you', new Float32Array(1_280).fill(0.4), 1.08);
    // No "Them" sound up to 1.08 s yet: held.
    expect(out.filter((chunk) => chunk.channel === 'you')).toHaveLength(0);
    cleaner.push('them', new Float32Array(1_280), 1.08);
    const you = out.filter((chunk) => chunk.channel === 'you');
    expect(you).toHaveLength(1);
    expect(you[0]!.endTime).toBe(1.08);
    expect(you[0]!.samples[0]).toBeCloseTo(0.2);
  });

  it('never holds "You" without a "Them" stream, and releases what waits at detach', () => {
    const out: CleanChunk[] = [];
    const cleaner = new AudioCleaner(
      (chunk) => out.push(chunk),
      () => null,
    );
    cleaner.push('you', new Float32Array(1_280), 0.08);
    expect(out).toHaveLength(1);
    cleaner.attach('them');
    cleaner.push('you', new Float32Array(1_280), 0.16);
    expect(out).toHaveLength(1);
    cleaner.detach('them');
    expect(out).toHaveLength(2);
    expect(cleaner.echoState()).toBe('off');
  });

  it('goes on without echo cancelling when it fails', () => {
    const out: CleanChunk[] = [];
    const broken = {
      addReference: () => {
        throw new Error('broken');
      },
      cancel: (samples: Float32Array) => samples,
    } as unknown as EchoCanceller;
    const cleaner = new AudioCleaner(
      (chunk) => out.push(chunk),
      () => broken,
    );
    cleaner.attach('them');
    cleaner.push('them', new Float32Array(1_280), 1.0);
    expect(out).toHaveLength(1);
    expect(cleaner.echoState()).toBe('failed');
  });
});
