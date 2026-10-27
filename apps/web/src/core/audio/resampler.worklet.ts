/**
 * File: apps/web/src/core/audio/resampler.worklet.ts
 * Purpose: The AudioWorklet that turns microphone audio into 16 kHz mono Float32Array chunks of
 *          ~100 ms and posts them straight to the speech-to-text worker (through a MessagePort,
 *          so the main thread is not in the audio path).
 * Used by: src/core/stt/sttEngine.ts (loads it with audioWorklet.addModule, one node per channel)
 * Depends on: src/core/audio/resample.ts (StreamingResampler, Chunker; their source is embedded)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1, §7.1 (core/audio)
 *
 * Why a source string and a Blob URL: bundlers copy `new URL('./x.worklet.ts', …)` files as-is,
 * without compiling TypeScript, so the worklet is assembled here from compiled classes instead.
 */
import { Chunker, StreamingResampler, TARGET_SAMPLE_RATE } from './resample';

/** Name the processor is registered under (new AudioWorkletNode(context, WORKLET_NAME)). */
export const WORKLET_NAME = 'kite-resampler';

/** Samples per chunk posted to the worker: 100 ms at 16 kHz. */
export const CHUNK_SAMPLES = TARGET_SAMPLE_RATE / 10;

/**
 * Builds the worklet's JavaScript source.
 * The classes are inserted as class expressions under fixed names, so it still works when the
 * production build renames them.
 * The processor:
 * - receives {type:'connect', port} once and then posts {samples, endTime} chunks to that port
 *   (endTime: audio-clock seconds when the chunk's last sample was captured);
 * - uses channel 0 only (the microphone stream is mono; "You" and "Them" are separate streams);
 * - transfers each chunk's buffer (no copy).
 *
 * @returns JavaScript source for audioWorklet.addModule (via a Blob URL).
 * Called from: workletModuleUrl(); tests
 */
export function buildWorkletSource(): string {
  return `
const KiteResampler = (${StreamingResampler.toString()});
const KiteChunker = (${Chunker.toString()});
class KiteResamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.resampler = new KiteResampler(sampleRate, ${TARGET_SAMPLE_RATE});
    this.chunker = new KiteChunker(${CHUNK_SAMPLES});
    this.target = null;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'connect') this.target = event.data.port;
    };
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && this.target) {
      // currentTime (audio clock, seconds) at the end of this block = capture time of the
      // chunk's last sample, used by the worker to measure lag from real capture time.
      const endTime = currentTime + channel.length / sampleRate;
      for (const chunk of this.chunker.push(this.resampler.process(channel))) {
        this.target.postMessage({ samples: chunk, endTime }, [chunk.buffer]);
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(WORKLET_NAME)}, KiteResamplerProcessor);
`;
}

/**
 * Creates a Blob URL for the worklet source. Revoke it after addModule().
 *
 * @returns An object URL for audioWorklet.addModule.
 * Called from: ensureAudio() in src/core/stt/sttEngine.ts
 */
export function workletModuleUrl(): string {
  return URL.createObjectURL(new Blob([buildWorkletSource()], { type: 'text/javascript' }));
}
