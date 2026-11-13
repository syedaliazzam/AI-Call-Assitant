/**
 * File: apps/web/src/core/stt/stt.worker.ts
 * Purpose: Web Worker that runs sherpa-onnx speech-to-text (official v1.13.7 WebAssembly
 *          runtime, unmodified) off the main thread: ONE recognizer, one stream per call channel
 *          ("you", "them"). It downloads and verifies the files (download.ts), starts the
 *          runtime, decodes 16 kHz chunks from each channel's audio worklet, and posts partial
 *          and final text plus statistics. Audio and text never leave the device; nothing is
 *          logged except timings and sizes.
 * Used by: src/core/stt/sttEngine.ts (new Worker(new URL('./stt.worker.ts', import.meta.url)))
 * Depends on: src/core/stt/download.ts, src/core/stt/channel.ts, src/core/stt/sentencepiece.ts,
 *             src/core/stt/models.ts, src/core/stt/protocol.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2, §7.1 (core/stt); ADR-0020
 *
 * How the model is loaded (and why it depends on Emscripten internals):
 * the official runtime normally downloads its baked-in model package (.data, 191 MB). The
 * Emscripten hook Module.getPreloadedPackage is given an EMPTY buffer instead, so that package
 * is never fetched. The model files are written into the runtime's in-memory file system with
 * Module.FS_createDataFile and passed to createOnlineRecognizer by path. Both are Emscripten
 * file-system APIs that a future runtime build could change (recorded in ADR-0020).
 *
 * Only verified code runs: the runtime scripts are executed from their verified bytes (through
 * Blob URLs), not fetched a second time by importScripts.
 */
import { BacklogController, DeferredAudio } from './backlog';
import { ChannelDecoder, type RecognizerLike } from './channel';
import { CouplingGate } from './coupling';
import { AEC_RATE, EchoCanceller, type Aec3Instance } from './echoCanceller';
import {
  clearSttCache,
  downloadModelFiles,
  ModelDownloadError,
  OLD_STT_CACHE_NAMES,
  sha256Hex,
} from './download';
import { BPE_VOCAB_NAME, BPE_VOCAB_SHA256, type DownloadFile } from './models';
import {
  DEFAULT_BEAM_WIDTH,
  type BacklogInfo,
  type BeamWidth,
  type ChannelId,
  type EngineStats,
  type FromWorker,
  type ToWorker,
} from './protocol';
import { sentencePieceVocab } from './sentencepiece';

/** Endpoint rule 2: decoded silence (s) after some text that ends an utterance. */
const MODEL_PAUSE_SECONDS = 1.0;

/** How often statistics are posted, in ms. */
const STATS_INTERVAL_MS = 1_000;

/** A sherpa-onnx OnlineRecognizer as the worker sees it. */
interface OnlineRecognizer extends RecognizerLike {
  /** Releases its WebAssembly memory. */
  free(): void;
}

/** The parts of the Emscripten `Module` object the worker sets or calls. */
interface EmscriptenModule {
  /** Turns a file name the runtime asks for into a URL (next to the verified .wasm). */
  locateFile?: (path: string) => string;
  /** The verified .wasm bytes, so the runtime does not fetch the file a second time. */
  wasmBinary?: ArrayBuffer;
  /**
   * Supplies the runtime's bundled data package. Kite returns an empty buffer, so the bundle's
   * 191 MB model is never downloaded (our pinned model files are written instead).
   */
  getPreloadedPackage?: (name: string, size: number) => ArrayBuffer;
  /** Called once the WebAssembly runtime has started. */
  onRuntimeInitialized?: () => void;
  /** Receives the runtime's console output (Kite drops it: model details, not timings). */
  print?: (text: string) => void;
  /** Receives the runtime's error output (dropped, like print). */
  printErr?: (text: string) => void;
  /**
   * Emscripten file system: creates a folder (the model folder /kite-model). Set by the runtime
   * once it has started.
   */
  FS_createPath?: (parent: string, path: string, canRead: boolean, canWrite: boolean) => void;
  /**
   * Emscripten file system: writes a file from bytes (each verified model file). Set by the
   * runtime once it has started.
   */
  FS_createDataFile?: (
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
    canOwn: boolean,
  ) => void;
  /** The WebAssembly heap as floats (its buffer's size = the worker's WebAssembly memory). */
  HEAPF32?: Float32Array;
}

/** The worker's global scope, as far as this file needs it. */
interface WorkerScope {
  /** The Emscripten Module object; the worker sets it before running the loader script. */
  Module?: EmscriptenModule;
  /** Defined by sherpa-onnx's API script (sherpa-onnx-asr.js) once it has run. */
  createOnlineRecognizer?: (runtime: EmscriptenModule, config: unknown) => OnlineRecognizer;
  /** Runs scripts in this classic worker (used with Blob URLs of the verified bytes). */
  importScripts: (...urls: string[]) => void;
  /** Sends a message to the page. */
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  /** Handles messages from the page. */
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}

/** This worker's global object. */
const scope = globalThis as unknown as WorkerScope;

/**
 * Sends a message to the page.
 *
 * @param message The message (its transcript text is never logged).
 */
function send(message: FromWorker): void {
  // A final line's audio (v1.0.1, only with keepAudio) is moved, not copied.
  if (message.type === 'pause') {
    scope.postMessage(message, [message.recent.buffer]);
    return;
  }
  if (message.type === 'final' && (message.audio || message.recent)) {
    const moved = [message.audio?.buffer, message.recent?.buffer].filter(
      (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
    );
    scope.postMessage(message, moved);
    return;
  }
  scope.postMessage(message);
}

/** Paths of the model files inside the WebAssembly file system, once written. */
interface ModelPaths {
  /** Path of the encoder (.onnx) in the runtime's file system, for example /kite-model/… */
  encoder: string;
  /** Path of the decoder (.onnx). */
  decoder: string;
  /** Path of the joiner (.onnx). */
  joiner: string;
  /** Path of tokens.txt (the model's vocabulary). */
  tokens: string;
  /** Path of bpe.vocab, derived from bpe.model; needed to encode hotwords. */
  bpeVocab: string;
}

/** Worker state. */
let runtime: EmscriptenModule | null = null;
let recognizer: OnlineRecognizer | null = null;
let modelPaths: ModelPaths | null = null;
/** Beam width from 'load'; kept so 'set-hotwords' re-creates the recognizer with the same one. */
let beamWidth: BeamWidth = DEFAULT_BEAM_WIDTH;
/** v1.4 (ADR-0065): whether "them" final lines carry their recent audio (from 'load'). */
let turnAudio = false;
const channels = new Map<ChannelId, ChannelDecoder>();
/** Cancels a download in progress (on 'stop'). */
let loadAbort: AbortController | null = null;
/** 1.5.2 (ADR-0070): the echo canceller's WebAssembly module once loaded, or null. */
let aecModule: {
  AEC3: new (rate: number, render: number, capture: number) => Aec3Instance;
} | null = null;
/** 1.5.2: this call's echo canceller (a new one for each "Them" stream), or null. */
let echo: EchoCanceller | null = null;
/** 1.5.2: the echo canceller's state, for the statistics. */
let echoState: 'on' | 'off' | 'failed' = 'off';
let statsTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Runs a verified runtime script at the worker's global scope (classic worker), so its
 * top-level `var Module` and function declarations become globals.
 *
 * @param bytes Verified script bytes.
 * Called from: loadModel()
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
 * 1.5.2 (ADR-0070): downloads and checks the echo canceller's files (as the runtime's), and starts its
 * WebAssembly module from the checked bytes. Never throws: a failure leaves echo cancelling off.
 *
 * @param files The loader and the .wasm (models.ts aecDownloads).
 * Called from: loadModel()
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
      // The checked bytes: nothing is fetched by the loader itself.
      wasmBinary: bytes.get(files.wasm.name),
      print: () => {},
      printErr: () => {},
    });
    echoState = 'on';
  } catch {
    aecModule = null;
    echoState = 'failed';
  }
}

/**
 * 1.5.2: a fresh echo canceller for a new "Them" stream (the echo path is learnt again), or null.
 *
 * @returns The canceller, or null when there is none.
 */
function newEchoCanceller(): EchoCanceller | null {
  if (!aecModule) return null;
  try {
    return new EchoCanceller(new aecModule.AEC3(AEC_RATE, 1, 1));
  } catch {
    echoState = 'failed';
    return null;
  }
}

/**
 * 1.5.2: runs one echo canceller step; a failure turns echo cancelling off for the rest of the call and
 * hands the audio back unchanged (decoding never stops for it).
 *
 * @param step     The step.
 * @param fallback The audio to use when it fails.
 * @returns The step's result, or the fallback.
 */
function safeEcho(
  step: (canceller: EchoCanceller) => Float32Array,
  fallback: Float32Array,
): Float32Array {
  if (!echo) return fallback;
  try {
    return step(echo);
  } catch {
    echo = null;
    echoState = 'failed';
    return fallback;
  }
}

/**
 * Creates the recognizer with the given hotwords and the beam width set by 'load'.
 *
 * @param hotwords Hotwords buffer ('' for none).
 * @returns The recognizer.
 * Called from: loadModel(), the 'set-hotwords' handler
 */
function createRecognizer(hotwords: string): OnlineRecognizer {
  const paths = modelPaths!;
  return scope.createOnlineRecognizer!(runtime!, {
    modelConfig: {
      transducer: { encoder: paths.encoder, decoder: paths.decoder, joiner: paths.joiner },
      tokens: paths.tokens,
      // Single-threaded build: one thread is all there is.
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      // Hotwords are encoded with the model's BPE tokenizer (bpe.vocab).
      modelingUnit: 'bpe',
      bpeVocab: paths.bpeVocab,
    },
    // Hotwords need beam search; greedy search ignores them. 4 paths is sherpa-onnx's default
    // and what live sessions use; /dev/stt-test can ask for 8 (more CPU) to measure it.
    decodingMethod: 'modified_beam_search',
    maxActivePaths: beamWidth,
    hotwordsBuf: hotwords,
    // Byte length: the C side copies exactly this many bytes from the buffer.
    hotwordsBufSize: new TextEncoder().encode(hotwords).length,
    // Endpoint rules: 1: 2.4 s of silence with no text; 2: MODEL_PAUSE_SECONDS after text;
    // 3: cut at 20 s. channel.ts adds the pause rule as a safety net.
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: MODEL_PAUSE_SECONDS,
    rule3MinUtteranceLength: 20,
  });
}

/**
 * Downloads and verifies every file, starts the runtime, writes the model into its file
 * system, builds bpe.vocab and creates the recognizer.
 *
 * @param message The 'load' message.
 * @throws ModelDownloadError, or Error for runtime/vocabulary failures (reported by the caller).
 * Called from: the 'load' message handler
 */
async function loadModel(message: Extract<ToWorker, { type: 'load' }>): Promise<void> {
  const startedAt = performance.now();
  // Free the Day 1 spike's cache (about 290 MB) if it is still there. A blocked Cache Storage
  // is not an error here (download.ts then works without a cache).
  await clearSttCache(caches, OLD_STT_CACHE_NAMES).catch(() => false);

  // 1. Fetch (network or cache) and verify everything.
  loadAbort = new AbortController();
  const { runtime: runtimeFiles, files } = message;
  const order: DownloadFile[] = [
    runtimeFiles.wasm,
    runtimeFiles.loader,
    runtimeFiles.api,
    files.encoder,
    files.decoder,
    files.joiner,
    files.tokens,
    files.bpeModel,
  ];
  const { files: downloaded, cacheAvailable } = await downloadModelFiles(order, {
    signal: loadAbort.signal,
    onProgress: (progress) => send({ type: 'progress', progress }),
  });
  loadAbort = null;
  const byName = new Map(downloaded.map((file) => [file.name, file]));
  const bytesOf = (file: DownloadFile) => byName.get(file.name)!.bytes;
  const downloadedAt = performance.now();

  // 2. Start the Emscripten runtime with our hooks, and wait for it.
  try {
    const ready = new Promise<void>((resolve) => {
      scope.Module = {
        // Never used for the .wasm (wasmBinary is given); kept for any other runtime lookup.
        locateFile: (path) => new URL(path, runtimeFiles.wasm.url).href,
        wasmBinary: bytesOf(runtimeFiles.wasm),
        // An empty package means the baked-in 191 MB .data file is never fetched.
        getPreloadedPackage: () => new ArrayBuffer(0),
        onRuntimeInitialized: () => resolve(),
        // The runtime prints model details; drop them (they are not timings or sizes).
        print: () => {},
        printErr: () => {},
      };
    });
    runVerifiedScript(bytesOf(runtimeFiles.loader));
    await ready;
    runVerifiedScript(bytesOf(runtimeFiles.api));
  } catch (error) {
    throw new Error(`Speech runtime failed to start: ${(error as Error).message}`);
  }
  runtime = scope.Module!;
  const runtimeAt = performance.now();

  // 3. bpe.vocab from the verified bpe.model, checked against its own pinned SHA-256.
  const vocab = new TextEncoder().encode(
    sentencePieceVocab(new Uint8Array(bytesOf(files.bpeModel))),
  );
  if ((await sha256Hex(vocab, crypto.subtle)) !== BPE_VOCAB_SHA256) {
    throw Object.assign(new Error('bpe.vocab does not match its pinned SHA-256'), {
      code: 'vocab',
    });
  }

  // 4. Model files into the runtime's file system, then the recognizer.
  runtime.FS_createPath!('/', 'kite-model', true, true);
  const write = (name: string, data: Uint8Array) =>
    runtime!.FS_createDataFile!('/kite-model', name, data, true, false, true);
  for (const file of [files.encoder, files.decoder, files.joiner, files.tokens]) {
    write(file.name, new Uint8Array(bytesOf(file)));
  }
  write(BPE_VOCAB_NAME, vocab);
  const path = (name: string) => `/kite-model/${name}`;
  modelPaths = {
    encoder: path(files.encoder.name),
    decoder: path(files.decoder.name),
    joiner: path(files.joiner.name),
    tokens: path(files.tokens.name),
    bpeVocab: path(BPE_VOCAB_NAME),
  };
  beamWidth = message.beamWidth;
  turnAudio = message.turnAudio === true;
  recognizer = createRecognizer(message.hotwords);
  // 1.5.2 (ADR-0070): the echo canceller, when asked for. Any failure only turns it off.
  if (message.aec) await loadEchoCanceller(message.aec);
  const readyAt = performance.now();

  statsTimer = setInterval(sendStats, STATS_INTERVAL_MS);
  send({
    type: 'ready',
    load: {
      model: message.model,
      bytes: downloaded.reduce((sum, file) => sum + file.bytes.byteLength, 0),
      fromCache: downloaded.every((file) => file.fromCache),
      cacheAvailable,
      downloadMs: Math.round(downloadedAt - startedAt),
      runtimeInitMs: Math.round(runtimeAt - downloadedAt),
      modelInitMs: Math.round(readyAt - runtimeAt),
      totalMs: Math.round(readyAt - startedAt),
    },
  });
}

/**
 * The decoder for a channel, created on first use.
 *
 * @param channel         Which channel.
 * @param inputSampleRate Rate of its AudioContext (statistics only).
 * @param keepAudio       v1.0.1: attach each final line's audio (accurate transcription).
 * @returns The decoder, or null before the recognizer is ready.
 */
function channelDecoder(
  channel: ChannelId,
  inputSampleRate?: number,
  keepAudio = false,
): ChannelDecoder | null {
  if (!recognizer) return null;
  let decoder = channels.get(channel);
  if (!decoder) {
    // v1.4 (ADR-0065): the other side's lines carry their recent audio for the end-of-turn model.
    const keepRecent = channel === 'them' && turnAudio;
    decoder = new ChannelDecoder(channel, recognizer, send, {
      inputSampleRate,
      keepAudio,
      keepRecent,
    });
    // ADR-0076: a decoder made after the call's clock arrived uses it too.
    if (pinnedOffsetMs !== null) decoder.pinClock(pinnedOffsetMs);
    channels.set(channel, decoder);
  }
  return decoder;
}

/**
 * Decodes a chunk, reporting failures without stopping the worker.
 *
 * @param channel Which channel.
 * @param samples 16 kHz samples.
 * @param endTime Capture time on the sender's audio clock (s).
 * @param replay  ADR-0076: audio replayed after a failover (never counted as backlog).
 */
function decodeChunk(
  channel: ChannelId,
  samples: Float32Array,
  endTime: number,
  replay = false,
): void {
  // 1.5.1 (ADR-0069): how long this chunk waited in the queue. Both channels come from one audio
  // clock, so the smallest (arrival − capture) seen is the transit time; anything above it is backlog.
  // ADR-0076: audio replayed after a failover arrives late by design; it never counts as backlog.
  const now = performance.now();
  const offset = now - endTime * 1000;
  if (!replay) clockOffsetMs = clockOffsetMs === null ? offset : Math.min(clockOffsetMs, offset);
  const lagMs = replay ? 0 : offset - (clockOffsetMs ?? offset);
  lastLagMs = lagMs;
  secondMaxLagMs = Math.max(secondMaxLagMs, lagMs);
  const before = backlog.state;
  const state = backlog.observe(lagMs, now);
  if (state !== before) {
    // The words heard so far become a line before the other side's audio is skipped.
    if (state === 'dropping') channels.get('them')?.flush();
    send({ type: 'backlog', backlog: backlogInfo() });
  }
  // v1.4 (ADR-0064): the coupling gate sees both channels. "Them" is its reference; a "You" chunk
  // waits (at most one step) for the "Them" sound up to its end, then may be silenced as echo.
  if (channel === 'them') {
    // 1.5.2 (ADR-0070): the echo canceller and the coupling gate always get the reference, even while its
    // decoding is skipped to catch up, so the user's audio is still cleaned.
    if (!echo) echo = newEchoCanceller();
    safeEcho((canceller) => {
      canceller.addReference(samples);
      return samples;
    }, samples);
    coupling.pushThem(samples, endTime);
    if (state === 'dropping') {
      droppedMs += (samples.length / 16_000) * 1000;
      releaseHeldYou(false);
      return;
    }
    decodeNow('them', samples, endTime);
    releaseHeldYou(false);
    return;
  }
  // 1.5.2: every "You" chunk is cleaned in time order (echo canceller, coupling gate) as its reference
  // arrives; only then is it decoded, or set aside while the worker is behind (1.5.1). Before, set-aside
  // audio skipped the gate, and the other side's words reached "You" exactly when the laptop was busiest.
  heldYou.push({ samples, endTime });
  releaseHeldYou(false);
  if (deferredYou.length > 0) drainDeferredYou(backlog.catchUp(lagMs));
}

/** 1.5.1 (ADR-0069): the backlog rules (backlog.ts). */
const backlog = new BacklogController();
/** 1.5.1: the "You" audio set aside while the worker is behind. */
const deferredYou = new DeferredAudio();
/** 1.5.1: the smallest (arrival − capture) seen, ms: the transit time without queueing. */
let clockOffsetMs: number | null = null;
/** 1.5.1: the latest chunk's backlog, and the worst in the current second, ms. */
let lastLagMs = 0;
let secondMaxLagMs = 0;
/** 1.5.1: the other side's audio skipped to catch up, ms. */
let droppedMs = 0;
/** ADR-0076: the call's capture clock as worker ms minus audio-clock ms, once given ('clock'), or null. */
let pinnedOffsetMs: number | null = null;

/**
 * The backlog as the page sees it.
 *
 * @returns The numbers (no audio).
 */
function backlogInfo(): BacklogInfo {
  return {
    state: backlog.state,
    lagMs: Math.round(lastLagMs),
    maxLagMs: Math.round(secondMaxLagMs),
    deferredMs: Math.round(deferredYou.ms),
    deferredDroppedMs: Math.round(deferredYou.droppedMs),
    droppedMs: Math.round(droppedMs),
  };
}

/**
 * Decodes up to `count` set-aside "You" chunks, oldest first. 1.5.2 (ADR-0070): they were cleaned (echo
 * canceller, coupling gate) before they were set aside.
 *
 * @param count How many chunks (Infinity for all).
 */
function drainDeferredYou(count: number): void {
  for (let i = 0; i < count; i += 1) {
    const chunk = deferredYou.shift();
    if (!chunk) return;
    decodeNow('you', chunk.samples, chunk.endTime);
  }
}

/**
 * The coupling gate of this worker (core/stt/coupling.ts, ADR-0064): keeps the other side's voice,
 * heard again through the laptop's speakers, out of the "You" channel.
 */
let coupling = new CouplingGate();

/** "You" chunks waiting for the "Them" sound they may echo (one or two at most). */
const heldYou: { samples: Float32Array; endTime: number }[] = [];

/**
 * Decodes the "You" chunks that can be decided now: their reference has arrived, there is no "Them"
 * channel, or they have waited long enough (more than two waiting, or forced at detach and stop).
 *
 * @param force True to decode every waiting chunk.
 */
function releaseHeldYou(force: boolean): void {
  while (heldYou.length > 0) {
    const next = heldYou[0]!;
    const waiting =
      !force &&
      channels.has('them') &&
      heldYou.length <= 2 &&
      !coupling.hasReferenceFor(next.samples, next.endTime);
    if (waiting) return;
    heldYou.shift();
    const cleaned = coupling.processYou(
      safeEcho((canceller) => canceller.cancel(next.samples), next.samples),
      next.endTime,
    );
    // 1.5.1: while behind, or while set-aside audio is still waiting, "You" audio goes to the back of
    // the set-aside store (the stream must get its audio in order).
    if (backlog.state !== 'ok' || deferredYou.length > 0) {
      deferredYou.push({ samples: cleaned, endTime: next.endTime });
    } else {
      decodeNow('you', cleaned, next.endTime);
    }
  }
}

/**
 * Feeds one chunk to a channel's decoder, reporting a failure.
 *
 * @param channel Which channel.
 * @param samples 16 kHz samples.
 * @param endTime Capture time of the last sample (audio clock, seconds).
 */
function decodeNow(channel: ChannelId, samples: Float32Array, endTime: number): void {
  try {
    channelDecoder(channel)?.accept(samples, endTime);
  } catch (error) {
    send({
      type: 'error',
      code: 'decode',
      message: error instanceof Error ? error.message : 'Decoding failed',
    });
  }
}

/** Posts the statistics of every channel plus the combined numbers. */
function sendStats(): void {
  const stats: EngineStats = {
    channels: {},
    combinedRtf: 0,
    totalDecodeMs: 0,
    totalAudioMs: 0,
    wasmMemoryBytes: runtime?.HEAPF32?.buffer.byteLength ?? 0,
  };
  for (const [id, decoder] of channels) {
    const snapshot = decoder.snapshot();
    stats.channels[id] = snapshot;
    stats.totalDecodeMs += snapshot.decodeMs;
    stats.totalAudioMs = Math.max(stats.totalAudioMs, snapshot.audioMs);
  }
  stats.combinedRtf = stats.totalAudioMs > 0 ? stats.totalDecodeMs / stats.totalAudioMs : 0;
  // 1.5.1: the backlog, and a fresh "worst in this second".
  stats.backlog = backlogInfo();
  stats.echoCancel = echoState;
  secondMaxLagMs = 0;
  send({ type: 'stats', stats });
}

/**
 * Removes a channel: posts its current text as a final line, then frees its stream.
 *
 * @param channel Which channel.
 */
function detachChannel(channel: ChannelId): void {
  // Waiting "You" chunks are decoded first: no more reference is coming, or the channel is ending.
  // 1.5.1 (ADR-0069): set-aside "You" audio goes after them, so the user's lines are filled in at End.
  releaseHeldYou(true);
  if (channel === 'you' && deferredYou.length > 0) drainDeferredYou(Infinity);
  // A new "Them" stream (a new share) is a new path: the coupling (1.5.2: and the echo) is learnt again.
  if (channel === 'them') {
    coupling = new CouplingGate();
    echo = null;
  }
  const decoder = channels.get(channel);
  if (!decoder) return;
  decoder.flush();
  decoder.free();
  channels.delete(channel);
}

/**
 * Reports a loading failure with a typed code.
 *
 * @param error What was thrown.
 */
function reportLoadError(error: unknown): void {
  if (error instanceof ModelDownloadError) {
    send({ type: 'error', code: `download-${error.kind}`, message: error.message });
    return;
  }
  const code = (error as { code?: string }).code === 'vocab' ? 'vocab' : 'runtime';
  send({ type: 'error', code, message: error instanceof Error ? error.message : 'Loading failed' });
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'load':
      loadModel(message).catch(reportLoadError);
      break;
    case 'attach': {
      detachChannel(message.channel);
      channelDecoder(message.channel, message.inputSampleRate, message.keepAudio === true);
      const channel = message.channel;
      message.port.onmessage = (port: MessageEvent<{ samples: Float32Array; endTime: number }>) =>
        decodeChunk(channel, port.data.samples, port.data.endTime);
      break;
    }
    case 'accept':
      decodeChunk(message.channel, message.samples, message.endTime, message.replay === true);
      break;
    case 'clock':
      // ADR-0076: Unix ms − audio ms becomes this worker's ms − audio ms.
      pinnedOffsetMs = message.unixMinusAudioMs - performance.timeOrigin;
      for (const decoder of channels.values()) decoder.pinClock(pinnedOffsetMs);
      break;
    case 'reset':
      channels.get(message.channel)?.reset();
      break;
    case 'detach':
      detachChannel(message.channel);
      break;
    case 'set-hotwords': {
      if (!recognizer) break;
      const startedAt = performance.now();
      const next = createRecognizer(message.hotwords);
      for (const decoder of channels.values()) decoder.useRecognizer(next);
      recognizer.free();
      recognizer = next;
      send({ type: 'hotwords-set', ms: Math.round(performance.now() - startedAt) });
      break;
    }
    case 'ping':
      send({ type: 'pong', id: message.id });
      break;
    case 'stop':
      loadAbort?.abort();
      if (statsTimer) clearInterval(statsTimer);
      // Last statistics first, while the channels still exist; then flush and free them.
      if (recognizer) sendStats();
      for (const id of [...channels.keys()]) detachChannel(id);
      recognizer?.free();
      recognizer = null;
      break;
  }
};
