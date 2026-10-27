/**
 * File: apps/web/src/core/stt/models.ts
 * Purpose: The speech-to-text candidates for the Day 1 spike (ADR-0020): which files each one
 *          loads from /models/stt/ (downloaded by scripts/fetch-models.ts) and how big they are.
 * Used by: src/core/stt/stt.worker.ts (what to load), src/features/dev/SttTest.tsx (picker, sizes),
 *          scripts/fetch-models.ts (where to put the files)
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt); ADR-0020
 *
 * Both candidates run on the same official sherpa-onnx v1.13.7 WebAssembly runtime
 * (single-threaded SIMD build, unmodified). v1.13.7 is the last release with official ASR
 * WebAssembly builds. Each candidate's files are fetched separately and written into the
 * runtime's file system (see stt.worker.ts); the runtime's own baked-in .data package is
 * never downloaded.
 */

/** Public URL folder that holds every speech-to-text file. */
export const STT_BASE_URL = '/models/stt';

/** Folder (under STT_BASE_URL) with the official sherpa-onnx WebAssembly runtime. */
export const RUNTIME_DIR = 'runtime-v1.13.7';

/** Runtime files: Emscripten loader, WebAssembly binary and the sherpa-onnx JS API. */
export const RUNTIME_FILES = {
  /** Emscripten loader (defines the global `Module`). */
  loader: 'sherpa-onnx-wasm-main-asr.js',
  /** The compiled sherpa-onnx + onnxruntime code. */
  wasm: 'sherpa-onnx-wasm-main-asr.wasm',
  /** sherpa-onnx's JavaScript API (createOnlineRecognizer, …). */
  api: 'sherpa-onnx-asr.js',
} as const;

/** Size of the WebAssembly binary, in bytes (both candidates download it). */
export const RUNTIME_WASM_BYTES = 13_150_239;

/**
 * The tokenizer vocabulary used to encode hotwords (both candidates share the same LibriSpeech
 * BPE-500 tokenizer: identical tokens.txt). Derived from the official bpe.model by
 * scripts/fetch-models.ts and placed in each candidate's folder.
 */
export const BPE_VOCAB_FILE: ModelFile = { name: 'bpe.vocab', bytes: 12_590 };

/** The candidates. */
export type SttModelId = 'zipformer-en-2023-06-21' | 'zipformer-en-2023-06-26';

/** One file a candidate writes into the WebAssembly file system. */
export interface ModelFile {
  /** File name in its public folder (and in the WebAssembly file system). */
  name: string;
  /** Size in bytes (shown on the test page, used for progress). */
  bytes: number;
}

/** Everything the worker needs to load one candidate. */
export interface SttModel {
  /** Identifier (also its folder under STT_BASE_URL). */
  id: SttModelId;
  /** Label for the test page. */
  label: string;
  /** Explanation for the test page. */
  description: string;
  /** Model files, written into the WebAssembly file system before the recognizer is created. */
  files: {
    /** Encoder network (int8, the large file). */
    encoder: ModelFile;
    /** Decoder network (prediction network). */
    decoder: ModelFile;
    /** Joiner network. */
    joiner: ModelFile;
    /** Token list (id → BPE piece). */
    tokens: ModelFile;
    /** Tokenizer vocabulary for hotwords. */
    bpeVocab: ModelFile;
  };
  /** Total download, in bytes, including the WebAssembly binary. */
  downloadBytes: number;
}

/**
 * Sums a candidate's download: the WebAssembly binary plus its files.
 *
 * @param files The candidate's files.
 * @returns Bytes.
 */
function totalBytes(files: SttModel['files']): number {
  return Object.values(files).reduce((sum, file) => sum + file.bytes, RUNTIME_WASM_BYTES);
}

/** The chosen candidate: streaming Zipformer English 2023-06-21 (LibriSpeech + GigaSpeech). */
const ZIPFORMER_2023_06_21_FILES: SttModel['files'] = {
  encoder: { name: 'encoder-epoch-99-avg-1.int8.onnx', bytes: 187_823_992 },
  decoder: { name: 'decoder-epoch-99-avg-1.onnx', bytes: 2_092_566 },
  joiner: { name: 'joiner-epoch-99-avg-1.onnx', bytes: 1_026_405 },
  tokens: { name: 'tokens.txt', bytes: 5_048 },
  bpeVocab: BPE_VOCAB_FILE,
};
const ZIPFORMER_2023_06_21: SttModel = {
  id: 'zipformer-en-2023-06-21',
  label: 'Zipformer EN 2023-06-21 (int8 encoder, ~204 MB)',
  description:
    'sherpa-onnx streaming Zipformer English trained on LibriSpeech + GigaSpeech: the same model as the official v1.13.7 WebAssembly bundle, with its files loaded separately.',
  files: ZIPFORMER_2023_06_21_FILES,
  downloadBytes: totalBytes(ZIPFORMER_2023_06_21_FILES),
};

/** For comparison: streaming Zipformer English 2023-06-26 (LibriSpeech only), rejected on accuracy. */
const ZIPFORMER_2023_06_26_FILES: SttModel['files'] = {
  encoder: { name: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx', bytes: 71_083_163 },
  decoder: { name: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx', bytes: 2_092_621 },
  joiner: { name: 'joiner-epoch-99-avg-1-chunk-16-left-128.onnx', bytes: 1_026_405 },
  tokens: { name: 'tokens.txt', bytes: 5_048 },
  bpeVocab: BPE_VOCAB_FILE,
};
const ZIPFORMER_2023_06_26: SttModel = {
  id: 'zipformer-en-2023-06-26',
  label: 'Comparison: Zipformer EN 2023-06-26 (int8 encoder, ~87 MB)',
  description:
    'sherpa-onnx streaming Zipformer English trained on LibriSpeech only, 320 ms chunks. Smaller, but too inaccurate on our test sentences (ADR-0020).',
  files: ZIPFORMER_2023_06_26_FILES,
  downloadBytes: totalBytes(ZIPFORMER_2023_06_26_FILES),
};

/** All candidates, the chosen one first. */
export const STT_MODELS: readonly SttModel[] = [ZIPFORMER_2023_06_21, ZIPFORMER_2023_06_26];

/**
 * Looks up a candidate by id.
 *
 * @param id The candidate id.
 * @returns The candidate.
 * @throws Error('Unknown speech-to-text model: …') for an unknown id.
 * Called from: stt.worker.ts, SttTest.tsx
 */
export function getSttModel(id: SttModelId): SttModel {
  const model = STT_MODELS.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Unknown speech-to-text model: ${id}`);
  return model;
}
