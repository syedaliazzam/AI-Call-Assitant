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
import { ChannelDecoder, type RecognizerLike } from './channel';
import {
  clearSttCache,
  downloadModelFiles,
  ModelDownloadError,
  OLD_STT_CACHE_NAMES,
  sha256Hex,
} from './download';
import { BPE_VOCAB_NAME, BPE_VOCAB_SHA256, type DownloadFile } from './models';
import type { ChannelId, EngineStats, FromWorker, ToWorker } from './protocol';
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
  locateFile?: (path: string) => string;
  wasmBinary?: ArrayBuffer;
  getPreloadedPackage?: (name: string, size: number) => ArrayBuffer;
  onRuntimeInitialized?: () => void;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  FS_createPath?: (parent: string, path: string, canRead: boolean, canWrite: boolean) => void;
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
  Module?: EmscriptenModule;
  createOnlineRecognizer?: (runtime: EmscriptenModule, config: unknown) => OnlineRecognizer;
  importScripts: (...urls: string[]) => void;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
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
  scope.postMessage(message);
}

/** Paths of the model files inside the WebAssembly file system, once written. */
interface ModelPaths {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
  bpeVocab: string;
}

/** Worker state. */
let runtime: EmscriptenModule | null = null;
let recognizer: OnlineRecognizer | null = null;
let modelPaths: ModelPaths | null = null;
const channels = new Map<ChannelId, ChannelDecoder>();
/** Cancels a download in progress (on 'stop'). */
let loadAbort: AbortController | null = null;
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
 * Creates the recognizer with the given hotwords.
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
    // Hotwords need beam search; greedy search ignores them. 4 paths is sherpa-onnx's default.
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
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
  recognizer = createRecognizer(message.hotwords);
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
 * @returns The decoder, or null before the recognizer is ready.
 */
function channelDecoder(channel: ChannelId, inputSampleRate?: number): ChannelDecoder | null {
  if (!recognizer) return null;
  let decoder = channels.get(channel);
  if (!decoder) {
    decoder = new ChannelDecoder(channel, recognizer, send, { inputSampleRate });
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
 */
function decodeChunk(channel: ChannelId, samples: Float32Array, endTime: number): void {
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
  send({ type: 'stats', stats });
}

/**
 * Removes a channel: posts its current text as a final line, then frees its stream.
 *
 * @param channel Which channel.
 */
function detachChannel(channel: ChannelId): void {
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
      channelDecoder(message.channel, message.inputSampleRate);
      const channel = message.channel;
      message.port.onmessage = (port: MessageEvent<{ samples: Float32Array; endTime: number }>) =>
        decodeChunk(channel, port.data.samples, port.data.endTime);
      break;
    }
    case 'accept':
      decodeChunk(message.channel, message.samples, message.endTime);
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
