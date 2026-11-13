/**
 * Tests for the on-device fallback's one clock (ADR-0076, E3 rule 1): apps/web/src/core/stt/channel.ts
 * (pinClock: a pinned capture clock is never replaced by the channel's own estimate, and grey lines carry
 * their capture time as tEnd) and apps/web/src/core/stt/sttEngine.ts (accept() and setClock() post the
 * worker messages; a partial's tEnd reaches onPartial).
 */
import { describe, expect, it, vi } from 'vitest';
import { ChannelDecoder, type ChannelEvent, type RecognizerLike } from '@/core/stt/channel';
import type { FromWorker, ToWorker } from '@/core/stt/protocol';
import { createSttEngine, type SttEngineDeps } from '@/core/stt/sttEngine';

/**
 * A recognizer that writes "HELLO" from the second chunk on.
 *
 * @returns The recognizer.
 */
function helloRecognizer(): RecognizerLike {
  let chunk = -1;
  return {
    createStream: () => ({
      acceptWaveform: () => {
        chunk += 1;
      },
      inputFinished: () => undefined,
      free: () => undefined,
    }),
    isReady: () => false,
    decode: () => undefined,
    isEndpoint: () => false,
    reset: () => undefined,
    getResult: () => ({ text: chunk >= 1 ? 'HELLO' : '' }),
  };
}

describe('ChannelDecoder.pinClock', () => {
  it('uses the call capture clock for grey lines, ignoring late arrival', () => {
    const events: ChannelEvent[] = [];
    // The worker's clock: arrival 50 s after capture, as for audio replayed after a failover.
    let now = 200_000;
    const decoder = new ChannelDecoder('them', helloRecognizer(), (event) => events.push(event), {
      clock: { now: () => (now += 1), timeOrigin: 1_700_000_000_000 },
      gate: null,
    });
    // Worker ms − audio ms: audio second 150 is worker ms 150,000 + 1,000.
    decoder.pinClock(1_000);
    const loud = new Float32Array(1_600).fill(0.2);
    decoder.accept(loud, 150.1);
    decoder.accept(loud, 150.2);
    const partial = events.find((event) => event.type === 'partial' && event.text === 'HELLO');
    expect(partial).toMatchObject({ tEnd: 1_700_000_000_000 + 150_200 + 1_000 });
  });
});

describe('createSttEngine accept() and setClock()', () => {
  it('posts chunks (copied) and the clock to the worker, and passes a partial tEnd on', () => {
    const posted: ToWorker[] = [];
    const worker = {
      onmessage: null as ((event: MessageEvent<FromWorker>) => void) | null,
      onerror: null,
      postMessage: vi.fn((message: ToWorker) => posted.push(message)),
      terminate: vi.fn(),
    };
    const deps: SttEngineDeps = {
      createWorker: () => worker as unknown as Worker,
      createAudioContext: () => ({}) as AudioContext,
      origin: 'http://localhost:3000',
      now: () => 10_000,
    };
    const onPartial = vi.fn();
    const engine = createSttEngine({ source: 'local', onPartial }, deps);
    const samples = new Float32Array(1_280).fill(0.1);
    engine.accept('them', samples, 101.08, true);
    engine.setClock(1_699_999_900_000);
    expect(posted.at(-2)).toMatchObject({
      type: 'accept',
      channel: 'them',
      endTime: 101.08,
      replay: true,
    });
    // The caller keeps its own array (the 10 s store).
    expect((posted.at(-2) as { samples: Float32Array }).samples).not.toBe(samples);
    expect(posted.at(-1)).toEqual({ type: 'clock', unixMinusAudioMs: 1_699_999_900_000 });
    worker.onmessage?.({
      data: { type: 'partial', channel: 'them', text: 'HI', tStart: 1, tEnd: 2 },
    } as MessageEvent<FromWorker>);
    expect(onPartial).toHaveBeenCalledWith({ channel: 'them', text: 'HI', tStart: 1, tEnd: 2 });
    engine.stop();
  });
});
