/**
 * File: apps/web/src/core/punctuation/model.ts
 * Purpose: The pinned files of the offline punctuation pass (v1.1.0, ADR-0044): the small
 *          sherpa-onnx punctuation and casing model, and the ONNX Runtime WebAssembly build that runs
 *          it, with every file's size, source and SHA-256. Both are served from our own origin in
 *          every environment, so nothing about a call leaves the device for this. The build unpacks
 *          and checks them (scripts/fetch-models.ts).
 * Used by: src/core/punctuation/punct.worker.ts, scripts/fetch-models.ts, scripts/check-stt-runtime.ts
 * Depends on: src/core/stt/models.ts (the PinnedFile shape)
 * Architecture: docs/decisions/ADR-0044-transcript-auto-punctuation-cleanup.md
 *
 * Why these (measured on 4 Nov 2026, Intel i5-8350U, ONNX Runtime 1.30.0 on one thread): the runtime is
 * 14.2 MB (3.7 MB compressed), the model 7.5 MB (1.9 MB compressed), it loads in about 0.5 s and takes
 * 15 ms for a typical line (p95 36 ms). The sherpa-onnx WebAssembly build the speech engine uses has no
 * punctuation model support. ONNX Runtime 1.31.1 was under two weeks old at the time.
 */
import type { PinnedFile } from '../stt/models';

/** The ONNX Runtime version (npm package onnxruntime-web). */
export const PUNCT_RUNTIME_VERSION = '1.30.0';

/** Public URL folder of the punctuation files on our own origin. */
export const PUNCT_PUBLIC_PATH = '/punct';

/** Public URL folder of the runtime on our own origin. */
export const PUNCT_RUNTIME_PATH = `${PUNCT_PUBLIC_PATH}/runtime-${PUNCT_RUNTIME_VERSION}`;

/** Where the runtime files are pinned from. */
const RUNTIME_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${PUNCT_RUNTIME_VERSION}/dist`;

/** The runtime's three files. */
export const PUNCT_RUNTIME_FILES = {
  /** The loader a classic worker can import. */
  loader: {
    name: 'ort.wasm.min.js',
    url: `${RUNTIME_BASE}/ort.wasm.min.js`,
    bytes: 50_196,
    sha256: 'faece07e84faa9001f5104bbe4e5c70861d06cb2376a0dea1fa0ad33a67adc81',
  },
  /** What the loader imports to start the WebAssembly. */
  glue: {
    name: 'ort-wasm-simd-threaded.mjs',
    url: `${RUNTIME_BASE}/ort-wasm-simd-threaded.mjs`,
    bytes: 24_381,
    sha256: 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b',
  },
  /** The WebAssembly. It runs on one thread here: the pages are not cross-origin isolated. */
  wasm: {
    name: 'ort-wasm-simd-threaded.wasm',
    url: `${RUNTIME_BASE}/ort-wasm-simd-threaded.wasm`,
    bytes: 14_239_897,
    sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
  },
} as const satisfies Record<string, PinnedFile>;

/** The official release archive the model's files are unpacked from (build time only). */
export const PUNCT_ARCHIVE = {
  /** GitHub release asset: the English punctuation and casing model (Apache-2.0). */
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-online-punct-en-2024-08-06.tar.bz2',
  /** SHA-256 of the archive. */
  sha256: '9f5e5a72c7d2829635bd074fce92b6bbd5b78da8a52e7ad8ed1be933f366b99d',
  /** Size in bytes (about 31 MB; most of it is the larger model, which is not used). */
  bytes: 30_667_839,
  /** Top-level folder inside the archive. */
  folder: 'sherpa-onnx-online-punct-en-2024-08-06',
} as const;

/** The model's two files. `url` is the release archive (they are unpacked from it). */
export const PUNCT_MODEL_FILES = {
  /** The network (int8): a CNN and a BiLSTM over BPE tokens. */
  model: {
    name: 'model.int8.onnx',
    url: PUNCT_ARCHIVE.url,
    bytes: 7_490_500,
    sha256: '9d611f445fe4a46186080fe161be6059d87d72eb88d3a8cb00c1a06e83a6067e',
  },
  /** The tokenizer's pieces and scores. */
  vocab: {
    name: 'bpe.vocab',
    url: PUNCT_ARCHIVE.url,
    bytes: 149_430,
    sha256: 'e118b7ad88c54db562517df49e1cffd4836d166c34fb190fd311d7f34eb238f5',
  },
} as const satisfies Record<string, PinnedFile>;
