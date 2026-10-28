/**
 * File: apps/web/src/core/stt/sttEngine.ts
 * Purpose: The speech-to-text engine the app uses: one Web Worker (one recognizer) serving up to
 *          two channels ("you", "them"). It loads the model with progress, attaches a MediaStream
 *          per channel through its own resampler worklet, and passes partial and final text and
 *          statistics to callbacks. No React. Replaces the Day 1 spike's sttClient.ts.
 * Used by: src/features/dev/SttTest.tsx (Day 2); core/audio/capture.ts and the live page
 *          (Day 2 Stages 3–4)
 * Depends on: src/core/stt/stt.worker.ts, src/core/stt/protocol.ts, src/core/stt/models.ts,
 *             src/core/stt/hotwords.ts, src/core/audio/resampler.worklet.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 1–2, §7.1 (core/stt)
 *
 * The engine does not open microphones or share screens: callers pass MediaStreams in (from the
 * platform adapter). It never stops the tracks it is given; their owner does.
 */
import { TARGET_SAMPLE_RATE } from '../audio/resample';
import { WORKLET_NAME, workletModuleUrl } from '../audio/resampler.worklet';
import type { DownloadProgress } from './download';
import { formatHotwords } from './hotwords';
import {
  DEFAULT_STT_MODEL,
  getSttModel,
  pickModelSource,
  resolveDownloads,
  type ModelSource,
  type SttModelId,
} from './models';
import type {
  ChannelId,
  EndpointReason,
  EngineErrorCode,
  EngineStats,
  FromWorker,
  LoadStats,
  ToWorker,
} from './protocol';

/** A partial-text update for one channel. */
export interface PartialEvent {
  /** Which channel. */
  channel: ChannelId;
  /** Current text ('' = cleared). Never logged. */
  text: string;
  /** Utterance start (Unix ms), or null when cleared. */
  tStart: number | null;
}

/** A finished utterance. */
export interface FinalEvent {
  /** Which channel. */
  channel: ChannelId;
  /** The text. Never logged. */
  text: string;
  /** Which rule ended it. */
  reason: EndpointReason;
  /** Start (Unix ms, capture time). */
  tStart: number;
  /** End (Unix ms, capture time). */
  tEnd: number;
  /** End of speech (Unix ms, capture time). */
  speechEnd: number;
  /** End of speech → this final line reached the page, in ms. */
  latencyMs: number;
}

/** An engine failure. */
export interface EngineError {
  /** What kind of failure. */
  code: EngineErrorCode;
  /** Explanation (no transcript text). */
  message: string;
}

/** Options for createSttEngine(). */
export interface SttEngineOptions {
  /** Which model (default: the production default). */
  model?: SttModelId;
  /** Hotwords as typed: one phrase per line, optional " :score" (see hotwords.ts). */
  hotwords?: string;
  /** Where model files come from (default: pickModelSource() for this build). */
  source?: ModelSource;
  /** Download progress. */
  onProgress?: (progress: DownloadProgress) => void;
  /** Partial text. */
  onPartial?: (event: PartialEvent) => void;
  /** Final lines. */
  onFinal?: (event: FinalEvent) => void;
  /** Statistics, about once a second. */
  onStats?: (stats: EngineStats) => void;
  /** Failures (loading, decoding). */
  onError?: (error: EngineError) => void;
}

/** What createSttEngine() returns. */
export interface SttEngine {
  /** Resolves when the model is loaded; rejects with an EngineError-shaped Error on failure. */
  ready: Promise<LoadStats>;
  /** Starts transcribing a stream as a channel (replaces that channel's earlier stream). */
  attach(channel: ChannelId, stream: MediaStream): Promise<void>;
  /** Stops transcribing a channel (its current text becomes a final line). */
  detach(channel: ChannelId): void;
  /** Replaces the hotwords (about 2 s; both channels restart their current utterance). */
  setHotwords(text: string): Promise<void>;
  /** Stops everything and ends the worker. The engine cannot be used afterwards. */
  stop(): void;
}

/** Browser objects the engine creates (injectable for tests). */
export interface SttEngineDeps {
  /** Creates the speech-to-text worker. */
  createWorker: () => Worker;
  /** Creates the AudioContext shared by the channels' worklets. */
  createAudioContext: () => AudioContext;
  /** The page's origin. */
  origin: string;
  /** Unix ms with sub-millisecond precision (for latencies). */
  now: () => number;
}

/**
 * The real browser objects.
 *
 * @returns Default dependencies.
 */
function defaultDeps(): SttEngineDeps {
  return {
    // Classic worker (no { type: 'module' }): the runtime scripts need importScripts.
    createWorker: () => new Worker(new URL('./stt.worker.ts', import.meta.url)),
    createAudioContext: () => {
      try {
        // At 16 kHz the browser does the resampling; the worklet resamples if it refuses.
        return new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      } catch {
        return new AudioContext();
      }
    },
    origin: location.origin,
    now: () => performance.timeOrigin + performance.now(),
  };
}

/**
 * The model source this build uses: NEXT_PUBLIC_STT_SOURCE if set, otherwise 'remote' in
 * production builds and 'local' in `pnpm dev` (both values are fixed when the app is built).
 *
 * @returns 'local' or 'remote'.
 * Called from: createSttEngine(); SttTest.tsx (test recordings come from the same source)
 */
export function buildModelSource(): ModelSource {
  return pickModelSource(process.env.NEXT_PUBLIC_STT_SOURCE, process.env.NODE_ENV);
}

/** One attached channel's audio graph. */
interface AttachedChannel {
  /** Source node for the stream. */
  source: MediaStreamAudioSourceNode;
  /** The resampler worklet. */
  node: AudioWorkletNode;
}

/**
 * Creates the engine and starts loading the model right away.
 *
 * @param options Model, hotwords, source and callbacks.
 * @param deps    Browser objects (tests only).
 * @returns The engine. Await `ready` before relying on `attach`.
 * Called from: SttTest.tsx; core/audio/capture.ts (Stage 3)
 */
export function createSttEngine(
  options: SttEngineOptions = {},
  deps: SttEngineDeps = defaultDeps(),
): SttEngine {
  const model = getSttModel(options.model ?? DEFAULT_STT_MODEL);
  const source = options.source ?? buildModelSource();
  const worker = deps.createWorker();
  /** stop() was called: no new work is accepted. */
  let ending = false;
  /** The worker was terminated: late messages are ignored. */
  let stopped = false;
  let context: AudioContext | null = null;
  let workletReady: Promise<void> | null = null;
  const attached = new Map<ChannelId, AttachedChannel>();
  let hotwordsWaiter: (() => void) | null = null;

  const post = (message: ToWorker, transfer: Transferable[] = []) =>
    worker.postMessage(message, transfer);

  let resolveReady!: (load: LoadStats) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<LoadStats>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let loaded = false;
  // Callers that never await `ready` (for example after an early stop) must not cause an
  // "unhandled rejection"; callers that do await it still get the error.
  ready.catch(() => undefined);

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (stopped) return;
    const message = event.data;
    switch (message.type) {
      case 'progress':
        options.onProgress?.(message.progress);
        break;
      case 'ready':
        loaded = true;
        resolveReady(message.load);
        break;
      case 'hotwords-set':
        hotwordsWaiter?.();
        hotwordsWaiter = null;
        break;
      case 'partial':
        options.onPartial?.({
          channel: message.channel,
          text: message.text,
          tStart: message.tStart,
        });
        break;
      case 'final':
        options.onFinal?.({
          channel: message.channel,
          text: message.text,
          reason: message.reason,
          tStart: message.tStart,
          tEnd: message.tEnd,
          speechEnd: message.speechEnd,
          // Measured on the page, so it includes the worker → page hop.
          latencyMs: Math.round(deps.now() - message.speechEnd),
        });
        break;
      case 'stats':
        options.onStats?.(message.stats);
        break;
      case 'error':
        options.onError?.({ code: message.code, message: message.message });
        if (!loaded) rejectReady(Object.assign(new Error(message.message), { code: message.code }));
        break;
    }
  };
  // A failure to even start the worker (for example a missing build file).
  worker.onerror = (event: ErrorEvent) => {
    const error = { code: 'runtime' as const, message: event.message || 'Worker failed to start' };
    options.onError?.(error);
    if (!loaded) rejectReady(Object.assign(new Error(error.message), { code: error.code }));
  };

  const downloads = resolveDownloads(model, source, deps.origin);
  post({
    type: 'load',
    model: model.id,
    runtime: downloads.runtime,
    files: downloads.model,
    hotwords: formatHotwords(options.hotwords ?? '').buffer,
  });

  /** Creates the shared AudioContext and loads the worklet module once. */
  const ensureAudio = async (): Promise<AudioContext> => {
    if (!context) {
      context = deps.createAudioContext();
      const moduleUrl = workletModuleUrl();
      workletReady = context.audioWorklet.addModule(moduleUrl).finally(() => {
        URL.revokeObjectURL(moduleUrl);
      });
    }
    await workletReady;
    // Chrome may start an AudioContext suspended when it was created without a recent click.
    if (context.state === 'suspended') await context.resume();
    return context;
  };

  /** Disconnects a channel's graph (the worker is told separately). */
  const disconnect = (channel: ChannelId) => {
    const graph = attached.get(channel);
    if (!graph) return;
    graph.source.disconnect();
    graph.node.disconnect();
    graph.node.port.close();
    attached.delete(channel);
  };

  return {
    ready,

    async attach(channel, stream) {
      if (ending) throw new Error('The speech-to-text engine was stopped');
      await ready;
      const audio = await ensureAudio();
      disconnect(channel);
      const sourceNode = audio.createMediaStreamSource(stream);
      // No outputs: the node only captures; nothing is played back.
      const node = new AudioWorkletNode(audio, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      // The worklet posts straight to the worker, so audio does not pass through the main thread.
      const pipe = new MessageChannel();
      node.port.postMessage({ type: 'connect', port: pipe.port1 }, [pipe.port1]);
      post({ type: 'attach', channel, port: pipe.port2, inputSampleRate: audio.sampleRate }, [
        pipe.port2,
      ]);
      sourceNode.connect(node);
      attached.set(channel, { source: sourceNode, node });
    },

    detach(channel) {
      disconnect(channel);
      if (!ending) post({ type: 'detach', channel });
    },

    async setHotwords(text) {
      await ready;
      const done = new Promise<void>((resolve) => {
        hotwordsWaiter = resolve;
      });
      post({ type: 'set-hotwords', hotwords: formatHotwords(text).buffer });
      await done;
    },

    stop() {
      if (ending) return;
      ending = true;
      for (const channel of [...attached.keys()]) disconnect(channel);
      post({ type: 'stop' });
      void context?.close();
      // Give the worker a moment to send its last statistics and final lines, then end it.
      setTimeout(() => {
        stopped = true;
        worker.terminate();
      }, 300);
      if (!loaded)
        rejectReady(
          Object.assign(new Error('Stopped before loading finished'), { code: 'download-aborted' }),
        );
    },
  };
}
