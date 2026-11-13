/**
 * File: apps/web/src/core/stt/audio.worker.ts
 * Purpose: The light audio worker for cloud transcription (ADR-0076, investigation C1/C5). It receives
 *          both channels' 80 ms chunks straight from their worklets (the main thread is not in the audio
 *          path), cleans the microphone with AEC3 and the coupling gate (audioCleaner.ts), stamps every
 *          chunk with the call's one capture clock (captureClock.ts), and posts each chunk to the page as
 *          16-bit PCM for Deepgram plus the cleaned samples for the on-device fallback. It decodes nothing.
 *          Audio and text are never logged.
 * Used by: src/core/stt/cloudStt.ts (new Worker(new URL('./audio.worker.ts', import.meta.url)))
 * Depends on: src/core/stt/audioCleaner.ts, src/core/stt/captureClock.ts, src/core/stt/echoCanceller.ts,
 *             src/core/stt/download.ts (the checked AEC3 files), src/core/stt/audioProtocol.ts
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C1, C5; ADR-0070, ADR-0076
 *
 * Only checked code runs: the AEC3 loader is executed from its checked bytes (a Blob URL), as in
 * stt.worker.ts. A classic worker, because that loader needs importScripts.
 */
import { AudioCleaner, toLinear16 } from './audioCleaner';
import type { FromAudioWorker, ToAudioWorker } from './audioProtocol';
import { CaptureClock } from './captureClock';
import { downloadModelFiles } from './download';
import { AEC_RATE, EchoCanceller, type Aec3Instance } from './echoCanceller';
import type { DownloadFile } from './models';
import type { ChannelId } from './protocol';

/** This worker's global scope, as far as this file needs it. */
interface WorkerScope {
  /** Runs scripts in this classic worker (used with Blob URLs of checked bytes). */
  importScripts: (...urls: string[]) => void;
  /** Sends a message to the page. */
  postMessage(message: FromAudioWorker, transfer?: Transferable[]): void;
  /** Handles messages from the page. */
  onmessage: ((event: MessageEvent<ToAudioWorker>) => void) | null;
}

/** This worker's global object. */
const scope = globalThis as unknown as WorkerScope;

/** The AEC3 module once loaded, or null. */
let aecModule: {
  AEC3: new (rate: number, render: number, capture: number) => Aec3Instance;
} | null = null;

/** The call's one capture clock (both channels share it). */
const clock = new CaptureClock();

/** The worklet ports, by channel (closed on detach). */
const ports = new Map<ChannelId, MessagePort>();

/** Statistics timer (the echo canceller's state, once a second). */
let statsTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Posts one cleaned chunk to the page: PCM for Deepgram and the samples for the fallback, both moved.
 *
 * @param channel Which channel.
 * @param samples The cleaned samples.
 * @param endTime Capture time of its last sample (audio clock, seconds).
 */
function post(channel: ChannelId, samples: Float32Array, endTime: number): void {
  const pcm = toLinear16(samples);
  // A fresh copy for the fallback: the worklet's buffer may be the cleaner's input (shared by reference).
  const copy = new Float32Array(samples);
  scope.postMessage(
    { type: 'chunk', channel, pcm, samples: copy, endTime, offsetMs: clock.offsetMs() ?? 0 },
    [pcm, copy.buffer],
  );
}

const cleaner = new AudioCleaner(
  (chunk) => post(chunk.channel, chunk.samples, chunk.endTime),
  () => (aecModule ? new EchoCanceller(new aecModule.AEC3(AEC_RATE, 1, 1)) : null),
);

/**
 * Runs checked script bytes at the worker's global scope.
 *
 * @param bytes The checked bytes.
 */
function runVerifiedScript(bytes: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try {
    scope.importScripts(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downloads and checks the AEC3 files and starts the module. Never throws: a failure leaves echo
 * cancelling off (the coupling gate and the text echo rules still run).
 *
 * @param files The loader and the .wasm (models.ts aecDownloads).
 */
async function loadEchoCanceller(files: {
  loader: DownloadFile;
  wasm: DownloadFile;
}): Promise<void> {
  try {
    const { files: got } = await downloadModelFiles([files.wasm, files.loader]);
    const bytes = new Map(got.map((file) => [file.name, file.bytes]));
    runVerifiedScript(bytes.get(files.loader.name)!);
    const factory = (
      globalThis as unknown as {
        WebRtcAec3?: (config: object) => Promise<NonNullable<typeof aecModule>>;
      }
    ).WebRtcAec3;
    if (!factory) throw new Error('The echo canceller did not start');
    aecModule = await factory({
      wasmBinary: bytes.get(files.wasm.name),
      print: () => {},
      printErr: () => {},
    });
  } catch {
    aecModule = null;
    scope.postMessage({ type: 'echo', state: 'failed' });
  }
}

scope.onmessage = (event: MessageEvent<ToAudioWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      if (message.aec) void loadEchoCanceller(message.aec);
      statsTimer ??= setInterval(
        () => scope.postMessage({ type: 'echo', state: cleaner.echoState() }),
        1_000,
      );
      break;
    case 'attach': {
      ports.get(message.channel)?.close();
      const channel = message.channel;
      cleaner.attach(channel);
      ports.set(channel, message.port);
      message.port.onmessage = (port: MessageEvent<{ samples: Float32Array; endTime: number }>) => {
        // One clock: the arrival of every chunk of either channel refines the same offset.
        clock.observe(port.data.endTime, performance.timeOrigin + performance.now());
        cleaner.push(channel, port.data.samples, port.data.endTime);
      };
      break;
    }
    case 'detach':
      ports.get(message.channel)?.close();
      ports.delete(message.channel);
      cleaner.detach(message.channel);
      break;
    case 'stop':
      for (const port of ports.values()) port.close();
      ports.clear();
      if (statsTimer) clearInterval(statsTimer);
      statsTimer = null;
      break;
  }
};
