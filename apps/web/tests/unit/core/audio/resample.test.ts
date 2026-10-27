/**
 * Tests for apps/web/src/core/audio/resample.ts and resampler.worklet.ts:
 * the streaming resampler produces the right number of samples and a continuous signal across
 * block boundaries; the chunker emits exact 1,600-sample chunks; and the generated worklet
 * source registers a processor that turns 48 kHz blocks into 100 ms chunks at 16 kHz.
 */
import { describe, expect, it, vi } from 'vitest';
import { Chunker, StreamingResampler, TARGET_SAMPLE_RATE } from '@/core/audio/resample';
import { buildWorkletSource, CHUNK_SAMPLES, WORKLET_NAME } from '@/core/audio/resampler.worklet';

/** A sine wave of `count` samples at `hz`, sampled at `rate`. */
function sine(count: number, hz: number, rate: number, start = 0): Float32Array {
  return Float32Array.from({ length: count }, (_, i) =>
    Math.sin((2 * Math.PI * hz * (start + i)) / rate),
  );
}

describe('StreamingResampler', () => {
  it('copies audio that is already at 16 kHz', () => {
    const input = sine(160, 440, 16_000);
    expect(new StreamingResampler(16_000, 16_000).process(input)).toEqual(input);
  });

  it('turns one second of 48 kHz into one second of 16 kHz, in 128-sample blocks', () => {
    const resampler = new StreamingResampler(48_000, 16_000);
    let produced = 0;
    for (let i = 0; i < 48_000; i += 128)
      produced += resampler.process(sine(128, 440, 48_000, i)).length;
    expect(Math.abs(produced - 16_000)).toBeLessThanOrEqual(1);
  });

  it('keeps the signal continuous across block boundaries', () => {
    const resampler = new StreamingResampler(48_000, 16_000);
    const out: number[] = [];
    for (let i = 0; i < 4_800; i += 128) out.push(...resampler.process(sine(128, 200, 48_000, i)));
    const expected = Array.from({ length: out.length }, (_, k) =>
      Math.sin((2 * Math.PI * 200 * k) / 16_000),
    );
    const maxError = Math.max(...out.map((value, k) => Math.abs(value - (expected[k] ?? 0))));
    expect(maxError).toBeLessThan(0.01);
  });
});

describe('Chunker', () => {
  it('emits exact chunks and keeps the remainder for later', () => {
    const chunker = new Chunker(1_600);
    expect(chunker.push(new Float32Array(1_000))).toHaveLength(0);
    const chunks = chunker.push(new Float32Array(2_500));
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length === 1_600)).toBe(true);
    // 3,500 pushed so far → 2 chunks + 300 left; 1,300 more completes exactly one chunk.
    expect(chunker.push(new Float32Array(200))).toHaveLength(0);
    expect(chunker.push(new Float32Array(1_100))).toHaveLength(1);
  });
});

describe('buildWorkletSource', () => {
  it('registers a processor that posts 100 ms chunks at 16 kHz with a capture time', () => {
    expect(CHUNK_SAMPLES).toBe(TARGET_SAMPLE_RATE / 10);
    const registered: Record<string, new () => unknown> = {};
    const posted: { samples: Float32Array; endTime: number }[] = [];

    // Run the generated source with the AudioWorklet globals faked: 48 kHz context.
    class FakeProcessor {
      port = { onmessage: null as ((event: { data: unknown }) => void) | null };
    }
    const run = new Function(
      'AudioWorkletProcessor',
      'registerProcessor',
      'sampleRate',
      'currentTime',
      buildWorkletSource(),
    );
    run(
      FakeProcessor,
      (name: string, ctor: new () => unknown) => {
        registered[name] = ctor;
      },
      48_000,
      1.5,
    );
    const Processor = registered[WORKLET_NAME];
    expect(Processor).toBeDefined();

    const processor = new Processor!() as FakeProcessor & {
      process: (inputs: Float32Array[][]) => boolean;
    };
    const target = { postMessage: vi.fn((data) => posted.push(data)) };
    processor.port.onmessage?.({ data: { type: 'connect', port: target } });

    // 0.25 s of 48 kHz audio in 128-sample render quanta → two complete 100 ms chunks.
    for (let i = 0; i < 12_000; i += 128) processor.process([[sine(128, 300, 48_000, i)]]);
    expect(posted.length).toBe(2);
    expect(posted.every((message) => message.samples.length === 1_600)).toBe(true);
    expect(posted[0]!.endTime).toBeGreaterThan(1.5);
  });
});
