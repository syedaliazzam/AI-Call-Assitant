/**
 * File: apps/web/src/core/stt/models.ts
 * Purpose: The production speech-to-text registry (ADR-0020): the sherpa-onnx runtime and the
 *          model, with every file's pinned source URL, size and SHA-256, plus the setting that
 *          picks where the browser loads them from (`local` or `remote`). This file is the single
 *          source of truth: the browser download (download.ts) and the developer download
 *          (scripts/fetch-models.ts) both read it.
 * Used by: src/core/stt/sttEngine.ts, src/core/stt/stt.worker.ts, src/features/dev/SttTest.tsx,
 *          scripts/fetch-models.ts, scripts/check-stt-runtime.ts
 * Depends on: nothing (no browser or Node APIs, so both sides can import it)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt), §10; ADR-0020
 *
 * Where files come from:
 * - Runtime (sherpa-onnx v1.13.7 WebAssembly: loader .js, .wasm, API .js, 13.3 MB): always from
 *   our own origin, /stt-runtime/v1.13.7/. The official release ships them only inside a 175 MB
 *   .tar.bz2 that a browser cannot unpack, so `fetch-models --runtime-only` unpacks them at build
 *   time (on Vercel and on developer machines). v1.13.7 is the last release with official ASR
 *   WebAssembly builds.
 * - Model files: `remote` = the pinned Hugging Face `resolve/<commit>` URLs (CORS allowed,
 *   checked on Day 2); `local` = /models/stt/<model id>/ (downloaded by fetch-models, works
 *   offline). Every file is checked against its SHA-256 before use, whichever the source.
 */

/** One file with its pinned source and checksum. */
export interface PinnedFile {
  /** File name (in the local folder and in the WebAssembly file system). */
  name: string;
  /** Pinned remote URL (a Hugging Face commit or the GitHub release; never a moving branch). */
  url: string;
  /** Size in bytes. */
  bytes: number;
  /** Expected SHA-256, lower-case hex. */
  sha256: string;
}

/** Where the browser loads model files from. */
export type ModelSource = 'local' | 'remote';

/** The sherpa-onnx runtime version (the last release with official ASR WebAssembly builds). */
export const RUNTIME_VERSION = 'v1.13.7';

/** Public URL folder of the runtime on our own origin. */
export const RUNTIME_PUBLIC_PATH = `/stt-runtime/${RUNTIME_VERSION}`;

/** Public URL folder of locally downloaded model files (source `local`). */
export const LOCAL_MODELS_PATH = '/models/stt';

/** The official release archive the runtime files are unpacked from (build time only). */
export const RUNTIME_ARCHIVE = {
  /** GitHub release asset: the English streaming ASR WebAssembly bundle. */
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer.tar.bz2',
  /** SHA-256 of the archive. */
  sha256: '21559527d65f7674a45834870e4f51b0af14be27d4de1043aa6f576d9b426acc',
  /** Size in bytes (about 175 MB; most of it is the bundle's own model, which is not used). */
  bytes: 175_243_556,
  /** Top-level folder inside the archive. */
  folder: 'sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer',
} as const;

/** The three runtime files. `url` is the release archive (they are unpacked from it). */
export const RUNTIME_FILES = {
  /** Emscripten loader (defines the global `Module`). */
  loader: {
    name: 'sherpa-onnx-wasm-main-asr.js',
    url: RUNTIME_ARCHIVE.url,
    bytes: 82_688,
    sha256: 'fd9e40cb7f871a94132fd722bde8a18aeb41a7e8cb95eee81a55b510e621c20a',
  },
  /** The compiled sherpa-onnx + onnxruntime code. */
  wasm: {
    name: 'sherpa-onnx-wasm-main-asr.wasm',
    url: RUNTIME_ARCHIVE.url,
    bytes: 13_150_239,
    sha256: 'd0c15c3042fd61ca2a158a1eeb8b8c2099201f7580945efc8f729d2830cf746d',
  },
  /** sherpa-onnx's JavaScript API (createOnlineRecognizer, …). */
  api: {
    name: 'sherpa-onnx-asr.js',
    url: RUNTIME_ARCHIVE.url,
    bytes: 53_867,
    sha256: 'd51ae8e8b756ee5e53423ffada0c9702973f154f561aca7984fe0b12f4060178',
  },
} satisfies Record<string, PinnedFile>;

/** Hugging Face repository of the model, at the pinned commit. */
const MODEL_2023_06_21_BASE =
  'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21/resolve/9a65b6ea94c311ca770c2bf895b30f456a22d703';

/**
 * Hugging Face repository that ships the tokenizer model (bpe.model) for the same LibriSpeech
 * BPE-500 tokenizer (identical tokens.txt; the 2023-06-21 repository has no bpe.model).
 */
const TOKENIZER_BASE =
  'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/672fbf1b30579d6585301139bb363f42a0ad4a24';

/**
 * Expected SHA-256 of bpe.vocab, the hotword vocabulary derived from bpe.model by
 * sentencePieceVocab() (sentencepiece.ts). Checked after the conversion, in the browser and in
 * fetch-models.
 */
export const BPE_VOCAB_SHA256 = 'f191a4935f668fa8cd8e607bcd378404f948321cd3134a5ea13d324ba921673d';

/** File name the derived vocabulary gets in the WebAssembly file system. */
export const BPE_VOCAB_NAME = 'bpe.vocab';

/** The production model ids (one today). */
export type SttModelId = 'zipformer-en-2023-06-21';

/** Everything needed to load one model. */
export interface SttModel {
  /** Identifier; also the folder name under LOCAL_MODELS_PATH. */
  id: SttModelId;
  /** Name shown in the UI. */
  label: string;
  /** Licence of the model files. */
  licence: string;
  /** The files, each pinned. */
  files: {
    /** Encoder network (int8, the large file). */
    encoder: PinnedFile;
    /** Decoder network (prediction network). */
    decoder: PinnedFile;
    /** Joiner network. */
    joiner: PinnedFile;
    /** Token list (id → BPE piece). */
    tokens: PinnedFile;
    /** Tokenizer model; converted to bpe.vocab for hotwords. */
    bpeModel: PinnedFile;
  };
}

/**
 * The working model (ADR-0020): sherpa-onnx streaming Zipformer English 2023-06-21, trained on
 * LibriSpeech + GigaSpeech. The same files as in the official v1.13.7 WebAssembly bundle (int8
 * encoder, fp32 decoder and joiner). Model 2023-06-26 was rejected on Day 1 and is not listed.
 */
export const ZIPFORMER_EN_2023_06_21: SttModel = {
  id: 'zipformer-en-2023-06-21',
  label: 'Zipformer English 2023-06-21 (streaming)',
  licence: 'Apache-2.0',
  files: {
    encoder: {
      name: 'encoder-epoch-99-avg-1.int8.onnx',
      url: `${MODEL_2023_06_21_BASE}/encoder-epoch-99-avg-1.int8.onnx`,
      bytes: 187_823_992,
      sha256: '32c98281c7bd8b63e3e142d007251b37f120572e8fdea9a4f5a79ce22b10ec4f',
    },
    decoder: {
      name: 'decoder-epoch-99-avg-1.onnx',
      url: `${MODEL_2023_06_21_BASE}/decoder-epoch-99-avg-1.onnx`,
      bytes: 2_092_566,
      sha256: '9da02b77cb08826756ec6a88635f35a40374e4164e7c6359121a9145958a6ceb',
    },
    joiner: {
      name: 'joiner-epoch-99-avg-1.onnx',
      url: `${MODEL_2023_06_21_BASE}/joiner-epoch-99-avg-1.onnx`,
      bytes: 1_026_405,
      sha256: 'bd5c26ad6a41cbd90c2cfa239c0b55b145af878ce1d79b4739d90f8be93359ba',
    },
    tokens: {
      name: 'tokens.txt',
      url: `${MODEL_2023_06_21_BASE}/tokens.txt`,
      bytes: 5_048,
      sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb',
    },
    bpeModel: {
      name: 'bpe.model',
      url: `${TOKENIZER_BASE}/bpe.model`,
      bytes: 244_865,
      sha256: 'c53433de083c4a6ad12d034550ef22de68cec62c4f58932a7b6b8b2f1e743fa5',
    },
  },
};

/** All production models, the default first. */
export const STT_MODELS: readonly SttModel[] = [ZIPFORMER_EN_2023_06_21];

/** The default model. */
export const DEFAULT_STT_MODEL: SttModelId = 'zipformer-en-2023-06-21';

/**
 * Official test recordings (LibriSpeech, from the model repository's test_wavs/, Apache-2.0),
 * used by /dev/stt-test as a repeatable "Them" source. Never the developer's voice.
 */
export const TEST_RECORDINGS: readonly (PinnedFile & { transcript: string })[] = [
  {
    name: '0.wav',
    url: `${MODEL_2023_06_21_BASE}/test_wavs/0.wav`,
    bytes: 212_044,
    sha256: '6bc58a4efdf20daac252b6b1502632601a71efe0308f6757dc1eda34891a7e4f',
    transcript:
      'AFTER EARLY NIGHTFALL THE YELLOW LAMPS WOULD LIGHT UP HERE AND THERE THE SQUALID QUARTER OF THE BROTHELS',
  },
  {
    name: '1.wav',
    url: `${MODEL_2023_06_21_BASE}/test_wavs/1.wav`,
    bytes: 534_924,
    sha256: '5143a6ba93c4b274e2c4ac22deb75c2c48936c853f0519add1de828b6c79cc5a',
    transcript:
      'GOD AS A DIRECT CONSEQUENCE OF THE SIN WHICH MAN THUS PUNISHED HAD GIVEN HER A LOVELY CHILD WHOSE PLACE WAS ON THAT SAME DISHONOURED BOSOM TO CONNECT HER PARENT FOR EVER WITH THE RACE AND DESCENT OF MORTALS AND TO BE FINALLY A BLESSED SOUL IN HEAVEN',
  },
];

/** Local folder (under LOCAL_MODELS_PATH) for the test recordings. */
export const TEST_RECORDINGS_DIR = 'test-wavs';

/**
 * Looks up a model by id.
 *
 * @param id The model id.
 * @returns The model.
 * @throws Error('Unknown speech-to-text model: …') for an unknown id.
 * Called from: sttEngine.ts, SttTest.tsx
 */
export function getSttModel(id: SttModelId): SttModel {
  const model = STT_MODELS.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Unknown speech-to-text model: ${id}`);
  return model;
}

/**
 * Total download of a model in bytes, including the runtime binary and loader scripts.
 *
 * @param model The model.
 * @returns Bytes.
 * Called from: SttTest.tsx; tests
 */
export function modelDownloadBytes(model: SttModel): number {
  const runtime = Object.values(RUNTIME_FILES).reduce((sum, file) => sum + file.bytes, 0);
  return Object.values(model.files).reduce((sum, file) => sum + file.bytes, runtime);
}

/**
 * Picks the model source: an explicit setting (NEXT_PUBLIC_STT_SOURCE = 'local' | 'remote') wins;
 * otherwise production builds use 'remote' and `pnpm dev` uses 'local' (works offline).
 *
 * @param setting  The value of NEXT_PUBLIC_STT_SOURCE (undefined when not set).
 * @param nodeEnv  process.env.NODE_ENV of the build.
 * @returns The source.
 * Called from: sttEngine.ts (with the build's values); tests
 */
export function pickModelSource(
  setting: string | undefined,
  nodeEnv: string | undefined,
): ModelSource {
  if (setting === 'local' || setting === 'remote') return setting;
  return nodeEnv === 'production' ? 'remote' : 'local';
}

/** A file the browser should download: where from, and what it must hash to. */
export interface DownloadFile {
  /** File name. */
  name: string;
  /** Absolute URL to fetch. */
  url: string;
  /** Size in bytes (for progress). */
  bytes: number;
  /** Expected SHA-256 (lower-case hex). */
  sha256: string;
}

/**
 * Resolves the absolute URLs the browser downloads for a model: runtime files from our origin,
 * model files from Hugging Face (`remote`) or from /models/stt/<id>/ (`local`).
 *
 * @param model  The model.
 * @param source Where model files come from.
 * @param origin The page's origin, for example 'http://localhost:3000'.
 * @returns Runtime files (loader, wasm, api) and model files, in download order.
 * Called from: sttEngine.ts (sends them to the worker); tests
 */
export function resolveDownloads(
  model: SttModel,
  source: ModelSource,
  origin: string,
): { runtime: Record<keyof typeof RUNTIME_FILES, DownloadFile>; model: SttModel['files'] } {
  const runtimeFile = (file: PinnedFile): DownloadFile => ({
    ...file,
    url: `${origin}${RUNTIME_PUBLIC_PATH}/${file.name}`,
  });
  const modelFile = (file: PinnedFile): PinnedFile =>
    source === 'remote'
      ? file
      : { ...file, url: `${origin}${LOCAL_MODELS_PATH}/${model.id}/${file.name}` };
  return {
    runtime: {
      loader: runtimeFile(RUNTIME_FILES.loader),
      wasm: runtimeFile(RUNTIME_FILES.wasm),
      api: runtimeFile(RUNTIME_FILES.api),
    },
    model: {
      encoder: modelFile(model.files.encoder),
      decoder: modelFile(model.files.decoder),
      joiner: modelFile(model.files.joiner),
      tokens: modelFile(model.files.tokens),
      bpeModel: modelFile(model.files.bpeModel),
    },
  };
}

/**
 * URL of an official test recording for the dev page, from the chosen source.
 *
 * @param file   The recording.
 * @param source Where files come from.
 * @param origin The page's origin.
 * @returns Absolute URL.
 * Called from: SttTest.tsx
 */
export function testRecordingUrl(file: PinnedFile, source: ModelSource, origin: string): string {
  return source === 'remote'
    ? file.url
    : `${origin}${LOCAL_MODELS_PATH}/${TEST_RECORDINGS_DIR}/${file.name}`;
}
