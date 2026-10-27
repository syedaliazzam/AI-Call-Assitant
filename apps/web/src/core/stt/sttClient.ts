/**
 * File: apps/web/src/core/stt/sttClient.ts
 * Purpose: Starts and stops live microphone transcription: microphone (through the platform
 *          adapter) → AudioWorklet (16 kHz chunks) → speech-to-text Web Worker → callbacks.
 * Used by: src/features/dev/SttTest.tsx (Day 1 spike); core/audio + the live page (Day 2)
 * Depends on: src/platform (getPlatform().getMicStream), src/core/audio/resampler.worklet.ts,
 *             src/core/stt/stt.worker.ts, src/core/stt/protocol.ts, src/core/stt/models.ts,
 *             src/core/stt/hotwords.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 1–2, §7.1
 */
import { getPlatform } from '@/platform';
import { TARGET_SAMPLE_RATE } from '../audio/resample';
import { WORKLET_NAME, workletModuleUrl } from '../audio/resampler.worklet';
import { formatHotwords } from './hotwords';
import { STT_BASE_URL, type SttModelId } from './models';
import type { EndpointReason, FromWorker, LiveStats, LoadStats, ToWorker } from './protocol';

/** Callbacks for startMicTranscription(). */
export interface TranscriptionHandlers {
  /** Download progress of one file. */
  onProgress?: (file: string, loaded: number, total: number) => void;
  /** The model is loaded (with timings); audio starts flowing right after. */
  onReady?: (load: LoadStats) => void;
  /** The current utterance's text so far ('' when it was cleared). */
  onPartial: (text: string) => void;
  /** A finished utterance, and which rule ended it. */
  onFinal: (text: string, reason: EndpointReason) => void;
  /** Updated statistics (about once a second). */
  onStats?: (stats: LiveStats) => void;
  /** Loading or decoding failed. */
  onError: (message: string) => void;
}

/** Options for startMicTranscription(). */
export interface TranscriptionOptions {
  /**
   * Hotwords as typed: one phrase per line, optional " :score" (see hotwords.ts). Applied when
   * the model loads. Day 3: built from the session's details and documents.
   */
  hotwords?: string;
}

/** What startMicTranscription() returns. */
export interface Transcription {
  /** Stops the microphone, the audio graph and the worker. */
  stop: () => void;
}

/**
 * Opens the microphone and starts transcribing it with the chosen model.
 * The AudioContext is created at 16 kHz so the browser does the resampling; the worklet
 * resamples itself if the browser picks another rate.
 *
 * @param model    Which candidate to load (ADR-0020).
 * @param handlers Callbacks for text, statistics and errors.
 * @param options  Hotwords.
 * @returns `{ stop }` once the model is loaded and audio is flowing.
 * @throws Errors from getMicStream() (for example permission denied) or model loading.
 * Called from: SttTest.tsx
 */
export async function startMicTranscription(
  model: SttModelId,
  handlers: TranscriptionHandlers,
  options: TranscriptionOptions = {},
): Promise<Transcription> {
  const worker = new Worker(new URL('./stt.worker.ts', import.meta.url));
  let stopped = false;

  const ready = new Promise<void>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (stopped) return;
      switch (message.type) {
        case 'progress':
          handlers.onProgress?.(message.file, message.loaded, message.total);
          break;
        case 'ready':
          handlers.onReady?.(message.load);
          resolve();
          break;
        case 'partial':
          handlers.onPartial(message.text);
          break;
        case 'final':
          handlers.onFinal(message.text, message.reason);
          break;
        case 'stats':
          handlers.onStats?.(message.stats);
          break;
        case 'error':
          handlers.onError(message.message);
          reject(new Error(message.message));
          break;
      }
    };
  });
  const init: ToWorker = {
    type: 'init',
    model,
    baseUrl: new URL(STT_BASE_URL, location.href).href,
    hotwords: formatHotwords(options.hotwords ?? '').buffer,
  };
  worker.postMessage(init);

  try {
    await ready;
  } catch (error) {
    worker.terminate();
    throw error;
  }

  const mic = await getPlatform().getMicStream();
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    // Some browsers refuse custom rates; the worklet then resamples.
    context = new AudioContext();
  }
  const moduleUrl = workletModuleUrl();
  await context.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);

  const source = context.createMediaStreamSource(mic);
  // No outputs: the node only captures; nothing is played back.
  const node = new AudioWorkletNode(context, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
  });
  // Connect the worklet straight to the worker, so audio does not pass through the main thread.
  const channel = new MessageChannel();
  node.port.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
  worker.postMessage(
    { type: 'audio-port', port: channel.port2, inputSampleRate: context.sampleRate },
    [channel.port2],
  );
  source.connect(node);

  return {
    stop: () => {
      if (stopped) return;
      worker.postMessage({ type: 'stop' });
      source.disconnect();
      node.disconnect();
      for (const track of mic.getTracks()) track.stop();
      void context.close();
      // Give the worker a moment to send its last statistics, then end it.
      setTimeout(() => {
        stopped = true;
        worker.terminate();
      }, 300);
    },
  };
}

/**
 * Deletes the cached model files, so the next load measures a first (network) load.
 *
 * @returns True if a cache existed.
 * Called from: SttTest.tsx ("Clear model cache")
 */
export async function clearModelCache(): Promise<boolean> {
  return caches.delete('kite-stt-v1');
}
