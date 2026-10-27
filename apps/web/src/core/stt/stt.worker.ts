/**
 * File: apps/web/src/core/stt/stt.worker.ts
 * Purpose: Web Worker that runs sherpa-onnx speech-to-text (official v1.13.7 WebAssembly
 *          runtime, unmodified) off the main thread. It loads a candidate model (ADR-0020),
 *          receives 16 kHz audio chunks from the audio worklet, and posts partial and final
 *          text plus timing statistics. Audio and text never leave the device; nothing is logged
 *          except timings and sizes.
 * Used by: src/core/stt/sttClient.ts (new Worker(new URL('./stt.worker.ts', import.meta.url)))
 * Depends on: /models/stt/** files (scripts/fetch-models.ts), src/core/stt/models.ts,
 *             src/core/stt/protocol.ts, src/core/stt/metrics.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2, §7.1 (core/stt); ADR-0020
 *
 * How a model is loaded (and why it depends on Emscripten internals):
 * the official runtime normally downloads its baked-in model package (.data, 191 MB). The
 * Emscripten hook Module.getPreloadedPackage is given an EMPTY buffer instead, so that package
 * is never fetched (its files become empty placeholders). The candidate's files are then
 * written into the runtime's in-memory file system with Module.FS_createDataFile and passed to
 * createOnlineRecognizer by path. Both hooks are Emscripten file-system APIs that a future
 * runtime build could change (recorded in ADR-0020).
 *
 * How an utterance ends (a "final" line), whichever comes first:
 * 1. the recognizer's endpoint rule 2: about 1 s of decoded silence after some text;
 * 2. the pause rule here: no new words for 1.2 s of audio while text is showing. It is a safety
 *    net: on Day 1 the 2023-06-21 model never ended an utterance with live microphone audio,
 *    which could not be reproduced with recordings. Each final line says which rule ended it.
 *    It watches the text, not the microphone level: a loudness threshold cut sentences in the
 *    middle when the voice was quiet (measured on Day 1), while words keep changing for as long
 *    as someone speaks. Day 2: Silero VAD replaces the pause rule.
 *
 * Spike code: the WAV-file integration test arrives on Day 2.
 */
import {
  getSttModel,
  RUNTIME_DIR,
  RUNTIME_FILES,
  RUNTIME_WASM_BYTES,
  type SttModel,
} from './models';
import { OnsetDetector, realTimeFactor } from './metrics';
import type { EndpointReason, FromWorker, LiveStats, ToWorker } from './protocol';
import { TARGET_SAMPLE_RATE } from '../audio/resample';

/** Cache Storage bucket for speech-to-text files (cleared from the test page). */
export const STT_CACHE_NAME = 'kite-stt-v1';

/** Endpoint rule 2: decoded silence (s) after some text that ends an utterance. */
const MODEL_PAUSE_SECONDS = 1.0;

/** Pause rule: audio (ms) with no new words, while text is showing, that ends an utterance. */
const PAUSE_END_MS = 1_200;

/** The parts of the official sherpa-onnx JS API (sherpa-onnx-asr.js) the worker uses. */
interface OnlineStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  inputFinished(): void;
  free(): void;
}
interface OnlineRecognizer {
  createStream(): OnlineStream;
  isReady(stream: OnlineStream): boolean;
  decode(stream: OnlineStream): void;
  isEndpoint(stream: OnlineStream): boolean;
  reset(stream: OnlineStream): void;
  getResult(stream: OnlineStream): { text: string };
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
}

/** The worker's global scope, as far as this file needs it. */
interface WorkerScope {
  Module?: EmscriptenModule;
  createOnlineRecognizer?: (runtime: EmscriptenModule, config: unknown) => OnlineRecognizer;
  importScripts?: (...urls: string[]) => void;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}

/** This worker's global object. */
const scope = globalThis as unknown as WorkerScope;

/** Sends a message to the page. */
function send(message: FromWorker): void {
  scope.postMessage(message);
}

/** Recognizer state once loaded. */
let recognizer: OnlineRecognizer | null = null;
let stream: OnlineStream | null = null;

/**
 * Fetches a file, using Cache Storage so later loads skip the network.
 *
 * @param url      Absolute URL.
 * @param total    Expected size, for progress messages.
 * @param fileName Name shown in progress messages.
 * @returns The bytes and whether they came from the cache.
 * @throws Error when the file is missing (run `pnpm --filter web fetch-models`).
 * Called from: loadModel()
 */
async function fetchCached(
  url: string,
  total: number,
  fileName: string,
): Promise<{ bytes: ArrayBuffer; fromCache: boolean }> {
  const cache = await caches.open(STT_CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    send({ type: 'progress', file: fileName, loaded: total, total });
    return { bytes: await cached.arrayBuffer(), fromCache: true };
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `Missing model file ${fileName} (HTTP ${response.status}). Run: pnpm --filter web fetch-models`,
    );
  }
  // Read the body ourselves to report progress, then store a copy in the cache.
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    send({ type: 'progress', file: fileName, loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  await cache.put(url, new Response(bytes.slice().buffer));
  return { bytes: bytes.buffer, fromCache: false };
}

/**
 * Runs one of the official runtime scripts at the worker's global scope, so its top-level
 * `var Module` and function declarations become globals (as in a classic worker).
 * importScripts is used when available; module workers do not have it, so the script text
 * is then evaluated with an indirect eval, which also runs at global scope.
 *
 * @param url Absolute URL of the script (same origin).
 * Called from: loadModel()
 */
async function runGlobalScript(url: string): Promise<void> {
  if (typeof scope.importScripts === 'function') {
    try {
      scope.importScripts(url);
      return;
    } catch (error) {
      // "Module scripts don't support importScripts()": fall through to the eval path.
      if (!(error instanceof TypeError)) throw error;
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  // Indirect eval: (0, eval)(…) evaluates in the global scope, not this function's scope.
  (0, eval)(`${await response.text()}\n//# sourceURL=${url}`);
}

/**
 * Loads the runtime and a candidate model, then creates the recognizer.
 *
 * @param model    The candidate.
 * @param baseUrl  Absolute URL of the /models/stt folder.
 * @param hotwords Hotwords buffer from formatHotwords() ('' for none).
 * Called from: the 'init' message handler
 */
async function loadModel(model: SttModel, baseUrl: string, hotwords: string): Promise<void> {
  const startedAt = performance.now();
  const runtimeUrl = `${baseUrl}/${RUNTIME_DIR}`;

  // 1. Fetch everything (network the first time, Cache Storage afterwards).
  const wasm = await fetchCached(
    `${runtimeUrl}/${RUNTIME_FILES.wasm}`,
    RUNTIME_WASM_BYTES,
    RUNTIME_FILES.wasm,
  );
  const fetched: { name: string; bytes: ArrayBuffer; fromCache: boolean }[] = [];
  for (const file of Object.values(model.files)) {
    const result = await fetchCached(`${baseUrl}/${model.id}/${file.name}`, file.bytes, file.name);
    fetched.push({ name: file.name, ...result });
  }
  const downloadedAt = performance.now();

  // 2. Start the Emscripten runtime with our hooks, and wait for it.
  const runtimeReady = new Promise<void>((resolve) => {
    scope.Module = {
      locateFile: (path) => `${runtimeUrl}/${path}`,
      wasmBinary: wasm.bytes,
      // An empty package means the baked-in 191 MB .data file is never fetched.
      getPreloadedPackage: () => new ArrayBuffer(0),
      onRuntimeInitialized: () => resolve(),
      // The runtime prints model details; drop them (they are not timings or sizes).
      print: () => {},
      printErr: () => {},
    };
  });
  await runGlobalScript(`${runtimeUrl}/${RUNTIME_FILES.loader}`);
  await runtimeReady;
  await runGlobalScript(`${runtimeUrl}/${RUNTIME_FILES.api}`);
  const runtimeAt = performance.now();

  // 3. Write the model files into the runtime's file system, then create the recognizer.
  const runtime = scope.Module!;
  runtime.FS_createPath!('/', 'kite-model', true, true);
  for (const file of fetched) {
    runtime.FS_createDataFile!(
      '/kite-model',
      file.name,
      new Uint8Array(file.bytes),
      true,
      false,
      true,
    );
  }
  const path = (name: string) => `/kite-model/${name}`;
  const hotwordsBytes = new TextEncoder().encode(hotwords).length;
  recognizer = scope.createOnlineRecognizer!(runtime, {
    modelConfig: {
      transducer: {
        encoder: path(model.files.encoder.name),
        decoder: path(model.files.decoder.name),
        joiner: path(model.files.joiner.name),
      },
      tokens: path(model.files.tokens.name),
      // Single-threaded build: one thread is all there is.
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      // Hotwords are encoded with the model's BPE tokenizer (bpe.vocab, see fetch-models.ts).
      modelingUnit: 'bpe',
      bpeVocab: path(model.files.bpeVocab.name),
    },
    // Hotwords need beam search; greedy search ignores them. 4 paths is sherpa-onnx's default.
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
    hotwordsBuf: hotwords,
    // Byte length: the C side copies exactly this many bytes from the buffer.
    hotwordsBufSize: hotwordsBytes,
    // No VAD in the official streaming example; the recognizer's endpoint rules turn silence
    // into "final" lines (rule 1: 2.4 s of silence with no text; rule 2: MODEL_PAUSE_SECONDS
    // after text; rule 3: cut at 20 s). Silero VAD is added on Day 2.
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: MODEL_PAUSE_SECONDS,
    rule3MinUtteranceLength: 20,
  });
  stream = recognizer.createStream();
  const readyAt = performance.now();

  const all = [wasm, ...fetched];
  send({
    type: 'ready',
    load: {
      model: model.id,
      bytes: all.reduce((sum, file) => sum + file.bytes.byteLength, 0),
      fromCache: all.every((file) => file.fromCache),
      downloadMs: Math.round(downloadedAt - startedAt),
      runtimeInitMs: Math.round(runtimeAt - downloadedAt),
      modelInitMs: Math.round(readyAt - runtimeAt),
      totalMs: Math.round(readyAt - startedAt),
    },
  });
}

/** Running statistics for the current session. */
const stats: LiveStats = {
  audioMs: 0,
  decodeMs: 0,
  rtf: 0,
  chunkMsAvg: 0,
  chunkMsMax: 0,
  lagsMs: [],
  inputSampleRate: TARGET_SAMPLE_RATE,
  endpoints: { model: 0, pause: 0 },
};
let chunks = 0;
let lastStatsAt = 0;
/** performance.now() of the detected speech onset still waiting for its first partial text. */
let pendingOnsetAt: number | null = null;
let lastText = '';
/** Audio received (ms) since the text last changed (the pause rule's clock). */
let msSinceTextChange = 0;
const onsets = new OnsetDetector({ sampleRate: TARGET_SAMPLE_RATE });
/**
 * Offset from the audio clock (worklet `currentTime`, ms) to this worker's performance.now().
 * The smallest (arrival − capture) seen is used: that chunk waited least in transit, so the
 * offset is closest to the true clock difference, and queueing delays then show up as lag.
 */
let clockOffsetMs: number | null = null;

/**
 * Ends the current utterance: posts its final line and starts a fresh one.
 * For the pause rule the stream is first told that input has finished, so the decoder emits
 * the last words it was still holding back, then a new stream replaces it (a finished stream
 * cannot take more audio). After the model's own rule, reset() is enough.
 *
 * @param reason Which rule ended the utterance.
 * @returns The final text ('' if nothing was recognized).
 * Called from: handleChunk()
 */
function endUtterance(reason: EndpointReason): string {
  if (!recognizer || !stream) return '';
  let text: string;
  if (reason === 'pause') {
    stream.inputFinished();
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    text = recognizer.getResult(stream).text.trim();
    stream.free();
    stream = recognizer.createStream();
  } else {
    text = recognizer.getResult(stream).text.trim();
    recognizer.reset(stream);
  }
  if (text !== '') {
    stats.endpoints[reason] += 1;
    send({ type: 'final', text, reason });
  }
  lastText = '';
  msSinceTextChange = 0;
  pendingOnsetAt = null;
  send({ type: 'partial', text: '' });
  return text;
}

/**
 * Decodes one ~100 ms chunk: feeds it to the recognizer, measures the time taken, posts new
 * partial text, a final line when the utterance ends, and statistics about once a second.
 * Onset time = capture time of the chunk's end (audio clock mapped to this worker's clock),
 * minus the audio after the onset inside the chunk. Lag = first partial text − onset time.
 *
 * @param samples 16 kHz mono samples.
 * @param endTime Audio-clock time (seconds) when the chunk's last sample was captured.
 * Called from: the audio port's message handler
 */
function handleChunk(samples: Float32Array, endTime: number): void {
  if (!recognizer || !stream) return;
  const arrivedAt = performance.now();
  const offset = arrivedAt - endTime * 1000;
  clockOffsetMs = clockOffsetMs === null ? offset : Math.min(clockOffsetMs, offset);
  const capturedEndAt = endTime * 1000 + clockOffsetMs;
  const onsetIndex = onsets.push(samples);
  if (onsetIndex >= 0 && pendingOnsetAt === null && lastText === '') {
    pendingOnsetAt = capturedEndAt - ((samples.length - onsetIndex) / TARGET_SAMPLE_RATE) * 1000;
  }

  stream.acceptWaveform(TARGET_SAMPLE_RATE, samples);
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const text = recognizer.getResult(stream).text.trim();

  // Audio time, not wall-clock time: a slow chunk must not look like a pause.
  msSinceTextChange += (samples.length / TARGET_SAMPLE_RATE) * 1000;
  if (text !== lastText) {
    msSinceTextChange = 0;
    if (lastText === '' && text !== '' && pendingOnsetAt !== null) {
      stats.lagsMs.push(Math.round(performance.now() - pendingOnsetAt));
      pendingOnsetAt = null;
    }
    lastText = text;
    send({ type: 'partial', text });
  }
  if (recognizer.isEndpoint(stream)) endUtterance('model');
  else if (lastText !== '' && msSinceTextChange >= PAUSE_END_MS) endUtterance('pause');

  // Decoding time includes the end-of-utterance work, which is part of the real cost.
  const doneAt = performance.now();
  const chunkMs = doneAt - arrivedAt;
  chunks += 1;
  stats.audioMs += (samples.length / TARGET_SAMPLE_RATE) * 1000;
  stats.decodeMs += chunkMs;
  stats.rtf = realTimeFactor(stats.decodeMs, stats.audioMs);
  stats.chunkMsAvg = stats.decodeMs / chunks;
  stats.chunkMsMax = Math.max(stats.chunkMsMax, chunkMs);
  if (doneAt - lastStatsAt > 1000) {
    lastStatsAt = doneAt;
    sendStats();
  }
}

/** Posts a copy of the statistics. */
function sendStats(): void {
  send({
    type: 'stats',
    stats: { ...stats, lagsMs: [...stats.lagsMs], endpoints: { ...stats.endpoints } },
  });
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'init') {
    loadModel(getSttModel(message.model), message.baseUrl, message.hotwords).catch(
      (error: unknown) => {
        send({ type: 'error', message: error instanceof Error ? error.message : 'Loading failed' });
      },
    );
  } else if (message.type === 'audio-port') {
    stats.inputSampleRate = message.inputSampleRate;
    message.port.onmessage = (
      portEvent: MessageEvent<{ samples: Float32Array; endTime: number }>,
    ) => {
      try {
        handleChunk(portEvent.data.samples, portEvent.data.endTime);
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Decoding failed',
        });
      }
    };
  } else if (message.type === 'stop') {
    sendStats();
    stream?.free();
    recognizer?.free();
    stream = null;
    recognizer = null;
  }
};
