/**
 * File: apps/web/src/core/stt/secondPass.worker.ts
 * Purpose: Web Worker for the second pass (Day 2 Stage 5): runs the official sherpa-onnx v1.13.2
 *          "vad-asr" WebAssembly runtime (unmodified) with Silero VAD and one non-streaming
 *          recognizer (Zipformer GigaSpeech or Moonshine v2 tiny). The streaming worker sends
 *          each finished utterance's audio here over a MessagePort; this worker trims silence
 *          with the VAD, decodes the speech again and posts the new text to the page, which
 *          replaces the first-pass line in place. Nothing is logged except timings and sizes.
 * Used by: src/core/stt/sttEngine.ts (new Worker(new URL('./secondPass.worker.ts', …)))
 * Depends on: src/core/stt/download.ts, src/core/stt/secondPass.ts, src/core/stt/sentencepiece.ts,
 *             src/core/stt/models.ts, src/core/stt/protocol.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2, §7.1 (core/stt); ADR-0020
 *
 * Audio: jobs live in this worker's memory only, one at a time plus a short queue
 * (secondPass.ts: at most 8 jobs, none older than 6 s), and each job's samples are dropped as
 * soon as it is decoded. Audio is never stored, logged or sent anywhere.
 *
 * The runtime is a WebAssembly THREADS build: it needs a cross-origin-isolated page
 * (COOP/COEP, next.config.ts) and starts 4 worker threads of its own, which load the same
 * verified loader script (Module.mainScriptUrlOrBlob). As in stt.worker.ts, the bundled model
 * package (.data) is skipped with an empty Module.getPreloadedPackage, and the model files are
 * written into the runtime's file system with Module.FS_createDataFile (Emscripten internals,
 * recorded in ADR-0020).
 */
import { downloadModelFiles, ModelDownloadError, sha256Hex } from './download';
import {
  BPE_VOCAB_NAME,
  getSecondPassModel,
  type DownloadFile,
  type SecondPassModel,
} from './models';
import type {
  FromSecondPass,
  RefineStatus,
  SecondPassJob,
  SecondPassStats,
  ToSecondPass,
} from './protocol';
import {
  JobQueue,
  joinPieces,
  MOONSHINE_MAX_PIECE_MS,
  recognizerConfig,
  SECOND_PASS_SAMPLE_RATE,
  speechPieces,
  VAD_SETTINGS,
  type ModelPaths,
  type SpeechSegment,
} from './secondPass';
import { sentencePieceVocab } from './sentencepiece';

/** How often statistics are posted, in ms. */
const STATS_INTERVAL_MS = 1_000;

/** A sherpa-onnx OfflineStream (sherpa-onnx-asr.js). */
interface OfflineStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
}

/** A sherpa-onnx OfflineRecognizer (sherpa-onnx-asr.js). */
interface OfflineRecognizerInstance {
  createStream(): OfflineStream;
  decode(stream: OfflineStream): void;
  getResult(stream: OfflineStream): { text: string };
  free(): void;
}

/** A sherpa-onnx Vad (sherpa-onnx-vad.js). */
interface Vad {
  acceptWaveform(samples: Float32Array): void;
  flush(): void;
  isEmpty(): boolean;
  front(): { samples: Float32Array; start: number };
  pop(): void;
  reset(): void;
  free(): void;
}

/** The parts of the Emscripten `Module` object the worker sets or calls. */
interface EmscriptenModule {
  locateFile?: (path: string) => string;
  wasmBinary?: ArrayBuffer;
  mainScriptUrlOrBlob?: string;
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
  /** The WebAssembly heap as floats (its buffer = the shared memory of all runtime threads). */
  HEAPF32?: Float32Array;
}

/** The worker's global scope, as far as this file needs it. */
interface WorkerScope {
  Module?: EmscriptenModule;
  createVad?: (runtime: EmscriptenModule, config: unknown) => Vad;
  importScripts: (...urls: string[]) => void;
  postMessage(message: FromSecondPass): void;
  onmessage: ((event: MessageEvent<ToSecondPass>) => void) | null;
}

/**
 * sherpa-onnx-asr.js declares `class OfflineRecognizer` at the top level of a classic script.
 * A top-level class is a global binding but NOT a property of globalThis, so it is reached by
 * its bare name.
 */
declare const OfflineRecognizer: new (
  config: unknown,
  runtime: EmscriptenModule,
) => OfflineRecognizerInstance;

/** This worker's global object. */
const scope = globalThis as unknown as WorkerScope;

/** Sends a message to the page. */
function send(message: FromSecondPass): void {
  scope.postMessage(message);
}

/** Unix ms (the same clock the streaming worker stamps jobs with). */
function nowUnix(): number {
  return performance.timeOrigin + performance.now();
}

/** Worker state. */
let runtime: EmscriptenModule | null = null;
let model: SecondPassModel | null = null;
let recognizer: OfflineRecognizerInstance | null = null;
let vad: Vad | null = null;
let paths: ModelPaths = {};
let jobsPort: MessagePort | null = null;
/** Blob URL of the verified loader; the runtime's own threads load it, so it stays alive. */
let loaderUrl: string | null = null;
let loadAbort: AbortController | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
/** True while a job is being worked on (or the next one is scheduled). */
let busy = false;
/** Hotwords files written so far (each change gets a new file name). */
let hotwordsFiles = 0;
const queue = new JobQueue();
const stats: SecondPassStats = {
  jobs: 0,
  outcomes: { refined: 0, 'no-speech': 0, dropped: 0, failed: 0 },
  audioMs: 0,
  speechMs: 0,
  vadMs: 0,
  decodeMs: 0,
  queueMsMax: 0,
  wasmMemoryBytes: 0,
};

/**
 * Runs verified script bytes at the worker's global scope (classic worker), so their top-level
 * declarations become globals. (The loader is run separately: its Blob URL must stay alive.)
 *
 * @param bytes Verified script bytes.
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
 * Writes the hotwords into the file system and returns the path ('' for none). Each change
 * uses a new file name, because FS_createDataFile cannot overwrite a file.
 *
 * @param hotwords Hotwords buffer ('' for none). Never logged.
 * @returns The path, or ''.
 */
function writeHotwords(hotwords: string): string {
  if (!model?.hotwords || hotwords === '') return '';
  hotwordsFiles += 1;
  const name = `hotwords-${hotwordsFiles}.txt`;
  runtime!.FS_createDataFile!(
    '/kite-model',
    name,
    new TextEncoder().encode(hotwords),
    true,
    false,
    true,
  );
  return `/kite-model/${name}`;
}

/**
 * Downloads and verifies every file, starts the runtime (and its threads), writes the files
 * into its file system, and creates the VAD and the recognizer.
 *
 * @param message The 'load' message.
 * @throws ModelDownloadError, or Error for runtime/vocabulary failures (reported by the caller).
 */
async function load(message: Extract<ToSecondPass, { type: 'load' }>): Promise<void> {
  const startedAt = performance.now();
  model = getSecondPassModel(message.model);
  loadAbort = new AbortController();
  const fileList = Object.values(message.files);
  const order: DownloadFile[] = [
    message.runtime.wasm,
    message.runtime.loader,
    message.runtime.api,
    message.runtime.vad,
    message.vad,
    ...fileList,
  ];
  const { files: downloaded, cacheAvailable } = await downloadModelFiles(order, {
    signal: loadAbort.signal,
    onProgress: (progress) => send({ type: 'progress', progress }),
  });
  loadAbort = null;
  // Files are looked up by URL: two models both have a "tokens.txt".
  const byUrl = new Map(order.map((file, i) => [file.url, downloaded[i]!]));
  const bytesOf = (file: DownloadFile) => byUrl.get(file.url)!.bytes;
  const downloadedAt = performance.now();

  try {
    const ready = new Promise<void>((resolve) => {
      scope.Module = {
        locateFile: (path) => new URL(path, message.runtime.wasm.url).href,
        wasmBinary: bytesOf(message.runtime.wasm),
        // An empty package means the bundled 45 MB .data file is never fetched.
        getPreloadedPackage: () => new ArrayBuffer(0),
        onRuntimeInitialized: () => resolve(),
        print: () => {},
        printErr: () => {},
      };
    });
    // The loader's threads must run the same verified bytes: give them its Blob URL.
    const loaderBytes = bytesOf(message.runtime.loader);
    const url = URL.createObjectURL(new Blob([loaderBytes], { type: 'text/javascript' }));
    scope.Module!.mainScriptUrlOrBlob = url;
    loaderUrl = url;
    scope.importScripts(url);
    await ready;
    runVerifiedScript(bytesOf(message.runtime.api));
    runVerifiedScript(bytesOf(message.runtime.vad));
  } catch (error) {
    throw new Error(`Second-pass runtime failed to start: ${(error as Error).message}`);
  }
  runtime = scope.Module!;
  const runtimeAt = performance.now();

  // Files into the runtime's file system.
  runtime.FS_createPath!('/', 'kite-model', true, true);
  const write = (name: string, data: Uint8Array) =>
    runtime!.FS_createDataFile!('/kite-model', name, data, true, false, true);
  const path = (name: string) => `/kite-model/${name}`;
  write(message.vad.name, new Uint8Array(bytesOf(message.vad)));
  paths = {};
  for (const [key, file] of Object.entries(message.files)) {
    write(file.name, new Uint8Array(bytesOf(file)));
    paths[key] = path(file.name);
  }
  if (model.kind === 'transducer') {
    // bpe.vocab from the verified bpe.model, checked against its own pinned SHA-256.
    const vocab = new TextEncoder().encode(
      sentencePieceVocab(new Uint8Array(bytesOf(message.files.bpeModel!))),
    );
    if ((await sha256Hex(vocab, crypto.subtle)) !== model.bpeVocabSha256) {
      throw Object.assign(new Error('bpe.vocab does not match its pinned SHA-256'), {
        code: 'vocab',
      });
    }
    write(BPE_VOCAB_NAME, vocab);
    paths.bpeVocab = path(BPE_VOCAB_NAME);
  }

  vad = scope.createVad!(runtime, {
    sileroVad: { model: path(message.vad.name), ...VAD_SETTINGS },
    // Unused second VAD of the API (ten-vad); an empty model path turns it off.
    tenVad: {
      model: '',
      threshold: 0.5,
      minSilenceDuration: 0.5,
      minSpeechDuration: 0.25,
      maxSpeechDuration: 20,
      windowSize: 256,
    },
    sampleRate: SECOND_PASS_SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
    bufferSizeInSeconds: VAD_SETTINGS.maxSpeechDuration + 10,
  });
  recognizer = new OfflineRecognizer(
    recognizerConfig(model, paths, writeHotwords(message.hotwords)),
    runtime,
  );
  const readyAt = performance.now();

  jobsPort = message.jobs;
  jobsPort.onmessage = (event: MessageEvent<SecondPassJob>) => {
    stats.jobs += 1;
    for (const old of queue.push(event.data)) finish(old, 'dropped', '', 0, 0, 0);
    pump();
  };
  statsTimer = setInterval(sendStats, STATS_INTERVAL_MS);
  send({
    type: 'ready',
    load: {
      model: model.id,
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
 * Runs the VAD over a whole job.
 *
 * @param samples The job audio.
 * @returns The speech segments (sample indices into the job audio).
 */
function findSpeech(samples: Float32Array): SpeechSegment[] {
  const detector = vad!;
  // reset() also restarts the sample count, so segment starts are indices into this job.
  detector.reset();
  const window = VAD_SETTINGS.windowSize;
  for (let i = 0; i < samples.length; i += window) {
    let part = samples.subarray(i, i + window);
    if (part.length < window) {
      const padded = new Float32Array(window);
      padded.set(part);
      part = padded;
    }
    detector.acceptWaveform(part);
  }
  detector.flush();
  const segments: SpeechSegment[] = [];
  while (!detector.isEmpty()) {
    const segment = detector.front();
    segments.push({ start: segment.start, length: segment.samples.length });
    detector.pop();
  }
  return segments;
}

/**
 * Decodes one job and posts its result.
 *
 * @param job The job (its audio is dropped when this returns).
 */
function runJob(job: SecondPassJob): void {
  const queuedMs = Math.max(0, nowUnix() - job.sentAt);
  stats.queueMsMax = Math.max(stats.queueMsMax, queuedMs);
  let vadMs = 0;
  let decodeMs = 0;
  let speechSamples = 0;
  try {
    const vadStart = performance.now();
    const segments = findSpeech(job.samples);
    vadMs = performance.now() - vadStart;
    const limit =
      model!.kind === 'moonshine-v2'
        ? Math.round((MOONSHINE_MAX_PIECE_MS / 1000) * SECOND_PASS_SAMPLE_RATE)
        : null;
    const pieces = speechPieces(segments, job.samples.length, limit);
    const decodeStart = performance.now();
    const texts = pieces.map((piece) => {
      speechSamples += piece.to - piece.from;
      const stream = recognizer!.createStream();
      try {
        stream.acceptWaveform(SECOND_PASS_SAMPLE_RATE, job.samples.subarray(piece.from, piece.to));
        recognizer!.decode(stream);
        return recognizer!.getResult(stream).text;
      } finally {
        stream.free();
      }
    });
    decodeMs = performance.now() - decodeStart;
    const text = joinPieces(texts);
    finish(job, text ? 'refined' : 'no-speech', text, vadMs, decodeMs, speechSamples, queuedMs);
  } catch {
    finish(job, 'failed', '', vadMs, decodeMs, speechSamples, queuedMs);
  }
}

/**
 * Counts a job's outcome and posts it to the page.
 *
 * @param job           The job.
 * @param status        How it ended.
 * @param text          New text ('' unless refined). Never logged.
 * @param vadMs         VAD time.
 * @param decodeMs      Decode time.
 * @param speechSamples Samples decoded.
 * @param queuedMs      Time waited before it started (default: until now).
 */
function finish(
  job: SecondPassJob,
  status: RefineStatus,
  text: string,
  vadMs: number,
  decodeMs: number,
  speechSamples: number,
  queuedMs: number = Math.max(0, nowUnix() - job.sentAt),
): void {
  const audioMs = (job.samples.length / SECOND_PASS_SAMPLE_RATE) * 1000;
  const speechMs = (speechSamples / SECOND_PASS_SAMPLE_RATE) * 1000;
  stats.outcomes[status] += 1;
  stats.audioMs += audioMs;
  stats.speechMs += speechMs;
  stats.vadMs += vadMs;
  stats.decodeMs += decodeMs;
  send({
    type: 'refined',
    segmentId: job.segmentId,
    channel: job.channel,
    text,
    status,
    speechEnd: job.speechEnd,
    audioMs: Math.round(audioMs),
    speechMs: Math.round(speechMs),
    vadMs: Math.round(vadMs),
    decodeMs: Math.round(decodeMs),
    queuedMs: Math.round(queuedMs),
  });
}

/** Starts working through the queue unless already busy. */
function pump(): void {
  if (busy || !recognizer) return;
  busy = true;
  // A macrotask between jobs lets 'set-hotwords', 'stop' and new jobs arrive.
  setTimeout(next, 0);
}

/** Takes the next job (dropping stale ones), runs it, and schedules the one after. */
function next(): void {
  if (!recognizer) {
    busy = false;
    return;
  }
  const { job, dropped } = queue.take(nowUnix());
  for (const old of dropped) finish(old, 'dropped', '', 0, 0, 0);
  if (!job) {
    busy = false;
    return;
  }
  runJob(job);
  setTimeout(next, 0);
}

/** Posts the statistics. */
function sendStats(): void {
  stats.wasmMemoryBytes = runtime?.HEAPF32?.buffer.byteLength ?? 0;
  send({ type: 'stats', stats: { ...stats, outcomes: { ...stats.outcomes } } });
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

scope.onmessage = (event: MessageEvent<ToSecondPass>) => {
  const message = event.data;
  switch (message.type) {
    case 'load':
      load(message).catch(reportLoadError);
      break;
    case 'set-hotwords': {
      const startedAt = performance.now();
      if (recognizer && model?.hotwords) {
        const nextRecognizer = new OfflineRecognizer(
          recognizerConfig(model, paths, writeHotwords(message.hotwords)),
          runtime!,
        );
        recognizer.free();
        recognizer = nextRecognizer;
      }
      send({ type: 'hotwords-set', ms: Math.round(performance.now() - startedAt) });
      break;
    }
    case 'stop':
      loadAbort?.abort();
      if (statsTimer) clearInterval(statsTimer);
      if (recognizer) sendStats();
      queue.clear();
      jobsPort?.close();
      jobsPort = null;
      recognizer?.free();
      recognizer = null;
      vad?.free();
      vad = null;
      if (loaderUrl) URL.revokeObjectURL(loaderUrl);
      loaderUrl = null;
      break;
  }
};
