/**
 * Tests for apps/web/src/core/audio/recordingStream.ts, with fake Web Audio objects:
 * joinWithGaps() puts the recordings one after another with 2 s of silence after each;
 * createRecordingStream() loops the joined buffer into a MediaStream destination (never the
 * speakers), stop() stops playback, its tracks and the context, and a failed fetch closes the
 * context and throws.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordingStream, GAP_SECONDS, joinWithGaps } from '@/core/audio/recordingStream';

/** A minimal AudioBuffer. */
function buffer(samples: number[], rate = 10) {
  const data = Float32Array.from(samples);
  return {
    length: data.length,
    sampleRate: rate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

/** A fake AudioContext that records what was created and connected. */
function fakeContext(rate = 10) {
  const track = { stop: vi.fn() };
  const destination = { stream: { getTracks: () => [track] } };
  const source = {
    buffer: null as AudioBuffer | null,
    loop: false,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const context = {
    sampleRate: rate,
    destination: { speakers: true },
    createBuffer: (_channels: number, length: number) => buffer(new Array(length).fill(0), rate),
    decodeAudioData: vi.fn(async () => buffer([0.5, 0.5], rate)),
    createBufferSource: () => source,
    createMediaStreamDestination: () => destination,
    close: vi.fn(async () => {}),
  };
  return { context, source, destination, track };
}

describe('joinWithGaps', () => {
  it('places recordings in order with GAP_SECONDS of silence after each', () => {
    const { context } = fakeContext(10);
    const joined = joinWithGaps(context as unknown as BaseAudioContext, [
      buffer([1, 1]),
      buffer([2]),
    ]);
    const gap = GAP_SECONDS * 10;
    expect(joined.length).toBe(2 + gap + 1 + gap);
    const data = joined.getChannelData(0);
    expect(data[0]).toBe(1);
    expect(data[2]).toBe(0);
    expect(data[2 + gap]).toBe(2);
  });
});

describe('createRecordingStream', () => {
  it('loops the recordings into a stream, not the speakers, and stops cleanly', async () => {
    const fake = fakeContext();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const recording = await createRecordingStream(['a.wav', 'b.wav'], {
      fetch: fetchMock as unknown as typeof fetch,
      createAudioContext: () => fake.context as unknown as AudioContext,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fake.source.loop).toBe(true);
    expect(fake.source.connect).toHaveBeenCalledWith(fake.destination);
    expect(fake.source.connect).not.toHaveBeenCalledWith(fake.context.destination);
    expect(recording.stream).toBe(fake.destination.stream);

    recording.stop();
    expect(fake.source.stop).toHaveBeenCalled();
    expect(fake.track.stop).toHaveBeenCalled();
    expect(fake.context.close).toHaveBeenCalled();
  });

  it('closes the context and throws when a recording cannot be fetched', async () => {
    const fake = fakeContext();
    await expect(
      createRecordingStream(['missing.wav'], {
        fetch: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
        createAudioContext: () => fake.context as unknown as AudioContext,
      }),
    ).rejects.toThrow(/HTTP 404/);
    expect(fake.context.close).toHaveBeenCalled();
  });
});
