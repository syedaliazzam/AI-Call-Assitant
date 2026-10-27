/**
 * File: apps/web/src/core/stt/sttEngine.ts
 * Purpose: The speech-to-text engine the app uses: one streaming Web Worker (one recognizer)
 *          serving up to two channels ("you", "them"), plus, when the second pass is on (Day 2
 *          Stage 5), a second worker that re-decodes each finished utterance. It loads the
 *          models with progress, attaches a MediaStream per channel through its own resampler
 *          worklet, and passes partial, final and refined text, latencies and statistics to
 *          callbacks. No React.
 * Used by: src/features/dev/SttTest.tsx (Day 2); core/audio/capture.ts and the live page
 *          (Day 2 Stages 3–4)
 * Depends on: src/core/stt/stt.worker.ts, src/core/stt/secondPass.worker.ts,
 *             src/core/stt/protocol.ts, src/core/stt/models.ts,
 *             src/core/stt/hotwords.ts, src/core/audio/resampler.worklet.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 1–2, §7.1 (core/stt)
 *
 * The engine does not open microphones or share screens: callers pass MediaStreams in (from the
 * platform adapter). It never stops the tracks it is given; their owner does.
 *
 * Second pass: the first-pass final line is passed on at once (onFinal); when the second worker
 * has decoded the same utterance again, onRefined passes its text with the same segmentId, and
 * the transcript replaces the line's text in place. The streaming worker sends the audio to the
 * second worker directly (a MessagePort), so call audio never passes through this page.
 * Latencies are measured here, on the page, from the end of speech (Unix ms on both sides).
 */
import { TARGET_SAMPLE_RATE } from '../audio/resample';
import { WORKLET_NAME, workletModuleUrl } from '../audio/resampler.worklet';
import type { DownloadProgress } from './download';
import { formatHotwords } from './hotwords';
import {
  DEFAULT_SECOND_PASS,
  DEFAULT_STT_MODEL,
  getSecondPassModel,
  getSttModel,
  pickModelSource,
  resolveDownloads,
  resolveSecondPassDownloads,
  type ModelSource,
  type SecondPassSetting,
  type SttModelId,
} from './models';
import type {
  ChannelId,
  EndpointReason,
  EngineErrorCode,
  EngineStats,
  FromSecondPass,
  FromWorker,
  LoadStats,
  RefineStatus,
  SecondPassStats,
  ToSecondPass,
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
  /** Utterance id; a later RefinedEvent refers to it. */
  segmentId: string;
  /** End of speech (Unix ms, capture time). */
  speechEnd: number;
  /** End of speech → this final line reached the page, in ms. */
  latencyMs: number;
  /** True when the second pass will send a RefinedEvent for it. */
  secondPass: boolean;
}

/** The second pass's result for one utterance. */
export interface RefinedEvent {
  /** Which channel. */
  channel: ChannelId;
  /** The utterance id from its FinalEvent. */
  segmentId: string;
  /** New text ('' unless status is 'refined': then keep the first-pass text). Never logged. */
  text: string;
  /** How the second pass ended. */
  status: RefineStatus;
  /** End of speech → this result reached the page, in ms. */
  latencyMs: number;
  /** Audio the second pass decoded (after VAD trimming), in ms. */
  speechMs: number;
  /** VAD time, in ms. */
  vadMs: number;
  /** Decode time, in ms. */
  decodeMs: number;
  /** Time waiting in the second pass's queue, in ms. */
  queuedMs: number;
}

/** How loading went: the streaming worker's numbers plus the second worker's (or null). */
export interface EngineLoad extends LoadStats {
  /** The second-pass worker's load, or null when it is off or failed to load. */
  secondPass: LoadStats | null;
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
  /** Which streaming model (default: the production default). */
  model?: SttModelId;
  /** Second pass: 'off' or a second-pass model id (default DEFAULT_SECOND_PASS). */
  secondPass?: SecondPassSetting;
  /** Hotwords as typed: one phrase per line, optional " :score" (see hotwords.ts). */
  hotwords?: string;
  /** Where model files come from (default: pickModelSource() for this build). */
  source?: ModelSource;
  /** Download progress. */
  onProgress?: (progress: DownloadProgress) => void;
  /** Partial text. */
  onPartial?: (event: PartialEvent) => void;
  /** Final lines (first pass). */
  onFinal?: (event: FinalEvent) => void;
  /** Second-pass results (always after the FinalEvent with the same segmentId). */
  onRefined?: (event: RefinedEvent) => void;
  /** Statistics, about once a second. */
  onStats?: (stats: EngineStats) => void;
  /** Failures (loading, decoding). */
  onError?: (error: EngineError) => void;
}

/** What createSttEngine() returns. */
export interface SttEngine {
  /**
   * Resolves when the streaming model (and the second pass, if on) is loaded; rejects with an
   * EngineError-shaped Error when the streaming model fails. A second pass that fails to load is
   * reported through onError ('second-pass') and leaves secondPass null.
   */
  ready: Promise<EngineLoad>;
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
  /** Creates the streaming speech-to-text worker. */
  createWorker: () => Worker;
  /** Creates the second-pass worker. */
  createSecondPassWorker: () => Worker;
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
    // Classic worker too: the second-pass runtime also uses importScripts.
    createSecondPassWorker: () => new Worker(new URL('./secondPass.worker.ts', import.meta.url)),
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
 * @param options Models, hotwords, source and callbacks.
 * @param deps    Browser objects (tests only).
 * @returns The engine. Await `ready` before relying on `attach`.
 * Called from: SttTest.tsx; LivePage.tsx
 */
export function createSttEngine(
  options: SttEngineOptions = {},
  deps: SttEngineDeps = defaultDeps(),
): SttEngine {
  const model = getSttModel(options.model ?? DEFAULT_STT_MODEL);
  const secondPassSetting = options.secondPass ?? DEFAULT_SECOND_PASS;
  const secondPassModel =
    secondPassSetting === 'off' ? null : getSecondPassModel(secondPassSetting);
  const source = options.source ?? buildModelSource();
  const worker = deps.createWorker();
  const secondWorker = secondPassModel ? deps.createSecondPassWorker() : null;
  /** Latest second-pass statistics (merged into every stats callback). */
  let secondStats: SecondPassStats | null = null;
  /** Final lines passed on so far, by segmentId (a refined result must follow its final). */
  const finalsSeen = new Set<string>();
  /** Refined results that arrived before their final line (rare: two threads race). */
  const earlyRefined = new Map<string, RefinedEvent>();
  /** Latest download progress of each worker. */
  const progress = { first: 0, second: 0 };
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

  let resolveFirst!: (load: LoadStats) => void;
  let rejectReady!: (error: Error) => void;
  const firstReady = new Promise<LoadStats>((resolve, reject) => {
    resolveFirst = resolve;
    rejectReady = reject;
  });
  let resolveSecond!: (load: LoadStats | null) => void;
  const secondReady = new Promise<LoadStats | null>((resolve) => {
    resolveSecond = resolve;
  });
  if (!secondWorker) resolveSecond(null);
  const ready: Promise<EngineLoad> = Promise.all([firstReady, secondReady]).then(
    ([first, second]) => ({ ...first, secondPass: second }),
  );
  let loaded = false;
  let secondLoaded = false;
  // Callers that never await `ready` (for example after an early stop) must not cause an
  // "unhandled rejection"; callers that do await it still get the error.
  ready.catch(() => undefined);

  const downloads = resolveDownloads(model, source, deps.origin);
  const secondDownloads = secondPassModel
    ? resolveSecondPassDownloads(secondPassModel, source, deps.origin)
    : null;
  const sumBytes = (files: readonly { bytes: number }[]) =>
    files.reduce((sum, file) => sum + file.bytes, 0);
  // Totals are known up front, so the combined progress never jumps backwards.
  const firstTotal = sumBytes([
    ...Object.values(downloads.runtime),
    ...Object.values(downloads.model),
  ]);
  const secondTotal = secondDownloads
    ? sumBytes([
        ...Object.values(secondDownloads.runtime),
        secondDownloads.vad,
        ...Object.values(secondDownloads.model),
      ])
    : 0;

  /** Passes on the combined progress of both workers. */
  const reportProgress = (file: string) => {
    const totalBytes = firstTotal + secondTotal;
    const loadedBytes = progress.first + progress.second;
    options.onProgress?.({
      file,
      loadedBytes,
      totalBytes,
      fraction: totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : 1,
    });
  };

  /** Passes on a refined result (its final line has been passed on). */
  const deliverRefined = (event: RefinedEvent) => options.onRefined?.(event);

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (stopped) return;
    const message = event.data;
    switch (message.type) {
      case 'progress':
        progress.first = message.progress.loadedBytes;
        reportProgress(message.progress.file);
        break;
      case 'ready':
        loaded = true;
        resolveFirst(message.load);
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
      case 'final': {
        options.onFinal?.({
          channel: message.channel,
          text: message.text,
          reason: message.reason,
          tStart: message.tStart,
          tEnd: message.tEnd,
          segmentId: message.segmentId,
          speechEnd: message.speechEnd,
          latencyMs: Math.round(deps.now() - message.speechEnd),
          secondPass: message.secondPass,
        });
        finalsSeen.add(message.segmentId);
        const early = earlyRefined.get(message.segmentId);
        if (early) {
          earlyRefined.delete(message.segmentId);
          deliverRefined(early);
        }
        break;
      }
      case 'stats': {
        const sp = secondStats;
        options.onStats?.({
          ...message.stats,
          ...(sp ? { secondPass: sp } : {}),
          allWorkersRtf:
            message.stats.totalAudioMs > 0
              ? (message.stats.totalDecodeMs + (sp ? sp.vadMs + sp.decodeMs : 0)) /
                message.stats.totalAudioMs
              : 0,
        });
        break;
      }
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

  /** The second-pass worker's messages. */
  const onSecondMessage = (event: MessageEvent<FromSecondPass>) => {
    if (stopped) return;
    const message = event.data;
    switch (message.type) {
      case 'progress':
        progress.second = message.progress.loadedBytes;
        reportProgress(message.progress.file);
        break;
      case 'ready':
        secondLoaded = true;
        resolveSecond(message.load);
        break;
      case 'hotwords-set':
        secondHotwordsWaiter?.();
        secondHotwordsWaiter = null;
        break;
      case 'refined': {
        const refined: RefinedEvent = {
          channel: message.channel,
          segmentId: message.segmentId,
          text: message.text,
          status: message.status,
          latencyMs: Math.round(deps.now() - message.speechEnd),
          speechMs: message.speechMs,
          vadMs: message.vadMs,
          decodeMs: message.decodeMs,
          queuedMs: message.queuedMs,
        };
        if (finalsSeen.has(message.segmentId)) deliverRefined(refined);
        else earlyRefined.set(message.segmentId, refined);
        break;
      }
      case 'stats':
        secondStats = message.stats;
        break;
      case 'error':
        // The first pass keeps working; the page shows the error.
        options.onError?.({ code: 'second-pass', message: `Second pass: ${message.message}` });
        if (!secondLoaded) resolveSecond(null);
        break;
    }
  };
  let secondHotwordsWaiter: (() => void) | null = null;

  const hotwords = formatHotwords(options.hotwords ?? '').buffer;
  // The two workers talk directly: utterance audio goes from the first to the second.
  const pipe = secondWorker ? new MessageChannel() : null;
  if (secondWorker && secondDownloads && secondPassModel && pipe) {
    secondWorker.onmessage = onSecondMessage;
    secondWorker.onerror = (event: ErrorEvent) => {
      options.onError?.({
        code: 'second-pass',
        message: `Second pass: ${event.message || 'worker failed to start'}`,
      });
      if (!secondLoaded) resolveSecond(null);
    };
    const message: ToSecondPass = {
      type: 'load',
      model: secondPassModel.id,
      runtime: secondDownloads.runtime,
      vad: secondDownloads.vad,
      files: secondDownloads.model,
      hotwords,
      jobs: pipe.port2,
    };
    secondWorker.postMessage(message, [pipe.port2]);
  }
  post(
    {
      type: 'load',
      model: model.id,
      runtime: downloads.runtime,
      files: downloads.model,
      hotwords,
      ...(pipe ? { secondPassPort: pipe.port1 } : {}),
    },
    pipe ? [pipe.port1] : [],
  );

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
      const load = await ready;
      const buffer = formatHotwords(text).buffer;
      const done = new Promise<void>((resolve) => {
        hotwordsWaiter = resolve;
      });
      const secondDone =
        secondWorker && load.secondPass
          ? new Promise<void>((resolve) => {
              secondHotwordsWaiter = resolve;
            })
          : Promise.resolve();
      post({ type: 'set-hotwords', hotwords: buffer });
      if (secondWorker && load.secondPass) {
        const message: ToSecondPass = { type: 'set-hotwords', hotwords: buffer };
        secondWorker.postMessage(message);
      }
      await Promise.all([done, secondDone]);
    },

    stop() {
      if (ending) return;
      ending = true;
      for (const channel of [...attached.keys()]) disconnect(channel);
      post({ type: 'stop' });
      const stopSecond: ToSecondPass = { type: 'stop' };
      secondWorker?.postMessage(stopSecond);
      void context?.close();
      // Give the workers a moment to send their last statistics and final lines, then end
      // them (ending the second worker also ends its runtime's own threads).
      setTimeout(() => {
        stopped = true;
        worker.terminate();
        secondWorker?.terminate();
      }, 300);
      if (!loaded)
        rejectReady(
          Object.assign(new Error('Stopped before loading finished'), { code: 'download-aborted' }),
        );
    },
  };
}
