/**
 * File: apps/web/src/core/stt/models.ts
 * Purpose: The speech-to-text registry (ADR-0020): the two sherpa-onnx runtimes (streaming, and
 *          the second pass), the streaming models, the second-pass models and Silero VAD, with
 *          every file's pinned source URL, size and SHA-256; the configurations measured in Day 2
 *          Stage 5 and the download budget; and the setting that picks where the browser loads
 *          files from (`local` or `remote`). This file is the single
 *          source of truth: the browser download (download.ts) and the developer download
 *          (scripts/fetch-models.ts) both read it.
 * Used by: src/core/stt/sttEngine.ts, src/core/stt/stt.worker.ts, src/core/stt/secondPass.worker.ts,
 *          src/core/stt/secondPass.ts, src/features/dev/SttTest.tsx,
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
 * - Second-pass runtime (sherpa-onnx v1.13.2 "vad-asr" WebAssembly: loader, .wasm, ASR API, VAD
 *   API, 13.1 MB) and Silero VAD (0.6 MB): also from our own origin, /stt-runtime/v1.13.2/,
 *   unpacked at build time from the smallest official vad-asr archive (33 MB). v1.13.7 has no
 *   non-streaming English build, so this is an older official release (recorded in ADR-0020). It
 *   is a WebAssembly THREADS build: it needs a cross-origin-isolated page (COOP/COEP headers in
 *   next.config.ts, provisional) and starts 4 extra worker threads.
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

/** The streaming model ids. */
export type SttModelId = 'zipformer-en-2023-06-21' | 'zipformer-en-2023-06-26';

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
 * encoder, fp32 decoder and joiner).
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

/**
 * "Model A": streaming Zipformer English 2023-06-26 (LibriSpeech only, int8 encoder, fp32 decoder
 * and joiner). Rejected on Day 1 as the only model (too inaccurate); in Day 2 Stage 5 it makes
 * only the grey partial text, while the second pass makes the final text. Same tokenizer as
 * 2023-06-21 (identical tokens.txt and bpe.model).
 */
export const ZIPFORMER_EN_2023_06_26: SttModel = {
  id: 'zipformer-en-2023-06-26',
  label: 'Zipformer English 2023-06-26 ("model A", grey text only)',
  licence: 'Apache-2.0',
  files: {
    encoder: {
      name: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
      url: `${TOKENIZER_BASE}/encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx`,
      bytes: 71_083_163,
      sha256: '563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1',
    },
    decoder: {
      name: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
      url: `${TOKENIZER_BASE}/decoder-epoch-99-avg-1-chunk-16-left-128.onnx`,
      bytes: 2_092_621,
      sha256: '7bf787f90b194b307e5a4ad6a34fadb4e748304c35f78a8d66358a05b13ee6ef',
    },
    joiner: {
      name: 'joiner-epoch-99-avg-1-chunk-16-left-128.onnx',
      url: `${TOKENIZER_BASE}/joiner-epoch-99-avg-1-chunk-16-left-128.onnx`,
      bytes: 1_026_405,
      sha256: '210591f72b3c56b8364f85f345dca240bc2b4c00632848f4aa923630d5639d3b',
    },
    tokens: {
      name: 'tokens.txt',
      url: `${TOKENIZER_BASE}/tokens.txt`,
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

/** All streaming models, the default first. */
export const STT_MODELS: readonly SttModel[] = [ZIPFORMER_EN_2023_06_21, ZIPFORMER_EN_2023_06_26];

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

// ---------------------------------------------------------------------------------------------
// Second pass (Day 2 Stage 5): a non-streaming model re-decodes each finished utterance in a
// second worker, and its text replaces the first-pass line in place.
// ---------------------------------------------------------------------------------------------

/** The second-pass runtime version (the latest official non-streaming "vad-asr" builds). */
export const SECOND_PASS_RUNTIME_VERSION = 'v1.13.2';

/** Public URL folder of the second-pass runtime (and Silero VAD) on our own origin. */
export const SECOND_PASS_RUNTIME_PUBLIC_PATH = `/stt-runtime/${SECOND_PASS_RUNTIME_VERSION}`;

/**
 * The official archive the second-pass runtime files are unpacked from (build time only): the
 * smallest English vad-asr bundle. Its own model package (.data) is not used.
 */
export const SECOND_PASS_RUNTIME_ARCHIVE = {
  /** GitHub release asset. */
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2/sherpa-onnx-wasm-simd-1.13.2-vad-asr-moonshine-v2-tiny-en.tar.bz2',
  /** SHA-256 of the archive (matches the release's own digest). */
  sha256: 'e8d3b69f5d109fb399dabcab7c378314377c310589281a38c630b751a11aa31a',
  /** Size in bytes (about 33 MB). */
  bytes: 33_337_014,
  /** Top-level folder inside the archive. */
  folder: 'sherpa-onnx-wasm-simd-1.13.2-vad-asr-moonshine-v2-tiny-en',
} as const;

/** The four second-pass runtime files. `url` is the release archive (they are unpacked from it). */
export const SECOND_PASS_RUNTIME_FILES = {
  /** Emscripten loader (threads build: it also starts the runtime's 4 worker threads). */
  loader: {
    name: 'sherpa-onnx-wasm-main-vad-asr.js',
    url: SECOND_PASS_RUNTIME_ARCHIVE.url,
    bytes: 116_812,
    sha256: '6ad588100e1c2814114681c8e4988ba17da7eea047da0858a1f3e299f70a8624',
  },
  /** The compiled sherpa-onnx + onnxruntime code (non-streaming recognizer and VAD). */
  wasm: {
    name: 'sherpa-onnx-wasm-main-vad-asr.wasm',
    url: SECOND_PASS_RUNTIME_ARCHIVE.url,
    bytes: 12_898_602,
    sha256: 'a1f3fb15701fad8c556af45d785ddd17dcfe8e25272aa1a02ba0369c9f2ce828',
  },
  /** sherpa-onnx's ASR JavaScript API (OfflineRecognizer). Byte-identical to the v1.13.7 one. */
  api: {
    name: 'sherpa-onnx-asr.js',
    url: SECOND_PASS_RUNTIME_ARCHIVE.url,
    bytes: 53_867,
    sha256: 'd51ae8e8b756ee5e53423ffada0c9702973f154f561aca7984fe0b12f4060178',
  },
  /** sherpa-onnx's VAD JavaScript API (createVad). */
  vad: {
    name: 'sherpa-onnx-vad.js',
    url: SECOND_PASS_RUNTIME_ARCHIVE.url,
    bytes: 7_772,
    sha256: '893f01168d529add8318c0a6055cf725e788585fda9b81722564a8c3c3f60e34',
  },
} satisfies Record<string, PinnedFile>;

/**
 * Silero VAD (MIT), the official sherpa-onnx release asset; the same bytes are inside every
 * vad-asr bundle. fetch-models downloads it at build time and it is served from
 * SECOND_PASS_RUNTIME_PUBLIC_PATH (the browser never uses the GitHub download host).
 */
export const SILERO_VAD: PinnedFile = {
  name: 'silero_vad.onnx',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
  bytes: 643_854,
  sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
};

/** The second-pass model ids. */
export type SecondPassModelId = 'zipformer-gigaspeech-en-2023-12-12' | 'moonshine-v2-tiny-en';

/** The second-pass setting: off, or which model re-decodes each utterance. */
export type SecondPassSetting = 'off' | SecondPassModelId;

/** Fields every second-pass model has. */
interface SecondPassModelBase {
  /** Identifier; also the folder name under LOCAL_MODELS_PATH. */
  id: SecondPassModelId;
  /** Name shown in the UI. */
  label: string;
  /** Licence of the model files. */
  licence: string;
  /** True when the model uses hotwords (transducer with modified_beam_search). */
  hotwords: boolean;
}

/** Moonshine v2 (encoder + merged decoder, onnxruntime .ort files). */
export interface MoonshineV2Model extends SecondPassModelBase {
  /** Model family. */
  kind: 'moonshine-v2';
  /** The files, each pinned. */
  files: {
    /** Encoder. */
    encoder: PinnedFile;
    /** Merged decoder (first and later steps in one network). */
    mergedDecoder: PinnedFile;
    /** Token list. */
    tokens: PinnedFile;
  };
}

/** A non-streaming Zipformer transducer (encoder, decoder, joiner). */
export interface OfflineTransducerModel extends SecondPassModelBase {
  /** Model family. */
  kind: 'transducer';
  /** The files, each pinned. */
  files: {
    /** Encoder (int8). */
    encoder: PinnedFile;
    /** Decoder (int8). */
    decoder: PinnedFile;
    /** Joiner (int8). */
    joiner: PinnedFile;
    /** Token list. */
    tokens: PinnedFile;
    /** Tokenizer model; converted to bpe.vocab for hotwords. */
    bpeModel: PinnedFile;
  };
  /** Expected SHA-256 of the bpe.vocab derived from this model's bpe.model. */
  bpeVocabSha256: string;
}

/** Any second-pass model. */
export type SecondPassModel = MoonshineV2Model | OfflineTransducerModel;

/** Hugging Face repository of the GigaSpeech model, at the pinned commit. */
const GIGASPEECH_BASE =
  'https://huggingface.co/k2-fsa/sherpa-onnx-zipformer-gigaspeech-2023-12-12/resolve/1ef16b95ff8b50b201326d72f561b3213b9d10c0';

/** Hugging Face repository of Moonshine v2 tiny (English, quantized), at the pinned commit. */
const MOONSHINE_TINY_BASE =
  'https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27/resolve/d1e6c30921780b8508d04b492dfb3ce8a51605d4';

/**
 * Config 1's second pass: non-streaming Zipformer transducer trained on GigaSpeech (10,000 h of
 * podcasts, YouTube and audiobooks), int8. Supports hotwords. No input length limit (17 s
 * checked in Node on Day 2).
 */
export const ZIPFORMER_GIGASPEECH_EN: OfflineTransducerModel = {
  id: 'zipformer-gigaspeech-en-2023-12-12',
  label: 'Zipformer GigaSpeech (non-streaming, int8, hotwords)',
  licence: 'Apache-2.0',
  kind: 'transducer',
  hotwords: true,
  files: {
    encoder: {
      name: 'encoder-epoch-30-avg-1.int8.onnx',
      url: `${GIGASPEECH_BASE}/encoder-epoch-30-avg-1.int8.onnx`,
      bytes: 72_850_681,
      sha256: '60d83e92a412b137e89c369d7b99ab00effc3cfedb06bc678041cc4dc7e3d0d6',
    },
    decoder: {
      name: 'decoder-epoch-30-avg-1.int8.onnx',
      url: `${GIGASPEECH_BASE}/decoder-epoch-30-avg-1.int8.onnx`,
      bytes: 540_688,
      sha256: '2b0580feb757696fa929922670b7126aaee609630349a1809fd5a2aee926d56e',
    },
    joiner: {
      name: 'joiner-epoch-30-avg-1.int8.onnx',
      url: `${GIGASPEECH_BASE}/joiner-epoch-30-avg-1.int8.onnx`,
      bytes: 259_417,
      sha256: '80160e45cca71dd52f6b0a6d3d12be18126f5308b2d4ba03f001300fea377c64',
    },
    tokens: {
      name: 'tokens.txt',
      url: `${GIGASPEECH_BASE}/tokens.txt`,
      bytes: 5_020,
      sha256: '0ef7d736bf4de3ef947292e4b119ef13f6808cd5f3aec225a843a7135ac1c2ce',
    },
    bpeModel: {
      name: 'bpe.model',
      url: `${GIGASPEECH_BASE}/bpe.model`,
      bytes: 244_837,
      sha256: 'c8a2a0129c4ab8e463164c142f82d25649661b122c8cd0b7aab5c9e80b90ad24',
    },
  },
  bpeVocabSha256: '803718d32d9858e47a5f764ae58c538ea370ecb5db3d58e98a8cda0b31bf4111',
};

/**
 * Config 2's second pass: Moonshine v2 tiny, English (MIT; the non-English Moonshine models have
 * a different licence and are not used). No hotwords. This build fails on input longer than
 * about 9 s (checked in Node on Day 2), so secondPass.ts cuts the audio at pauses into pieces of
 * MOONSHINE_MAX_PIECE_MS or less.
 */
export const MOONSHINE_V2_TINY_EN: MoonshineV2Model = {
  id: 'moonshine-v2-tiny-en',
  label: 'Moonshine v2 tiny (English)',
  licence: 'MIT',
  kind: 'moonshine-v2',
  hotwords: false,
  files: {
    encoder: {
      name: 'encoder_model.ort',
      url: `${MOONSHINE_TINY_BASE}/encoder_model.ort`,
      bytes: 13_281_600,
      sha256: '94e90a4654fc45cdfedb77c4c08e1739f48862998e58fada384b25118134f221',
    },
    mergedDecoder: {
      name: 'decoder_model_merged.ort',
      url: `${MOONSHINE_TINY_BASE}/decoder_model_merged.ort`,
      bytes: 30_412_256,
      sha256: 'cf524c4862d36e9e5ab032eddc73637efd822d70e868ac575cf1a46e1e4708a0',
    },
    tokens: {
      name: 'tokens.txt',
      url: `${MOONSHINE_TINY_BASE}/tokens.txt`,
      bytes: 549_350,
      sha256: '2870d843e14c1e187bf1913a521562a63b53933814bd7f2145120468f494a049',
    },
  },
};

/** All second-pass models. */
export const SECOND_PASS_MODELS: readonly SecondPassModel[] = [
  ZIPFORMER_GIGASPEECH_EN,
  MOONSHINE_V2_TINY_EN,
];

/** The production second-pass setting: off until ADR-0020 adopts a configuration. */
export const DEFAULT_SECOND_PASS: SecondPassSetting = 'off';

/**
 * Looks up a second-pass model by id.
 *
 * @param id The model id.
 * @returns The model.
 * @throws Error('Unknown second-pass model: …') for an unknown id.
 * Called from: sttEngine.ts, configurationBytes(); tests
 */
export function getSecondPassModel(id: SecondPassModelId): SecondPassModel {
  const model = SECOND_PASS_MODELS.find((candidate) => candidate.id === id);
  if (!model) throw new Error(`Unknown second-pass model: ${id}`);
  return model;
}

/** Download budget for everything speech-to-text (ADR-0020), in bytes. */
export const STT_DOWNLOAD_BUDGET_BYTES = 250_000_000;

/**
 * Raised budget the developer accepted ONLY for config 2 (2023-06-21 + Moonshine v2 tiny,
 * 262.4 MB), and only if that configuration is the one adopted (Day 2 Stage 5).
 */
export const STT_DOWNLOAD_EXCEPTION_BYTES = 265_000_000;

/** One speech-to-text configuration: the streaming model plus the second-pass setting. */
export interface SttConfiguration {
  /** Identifier used on the test page and in results. */
  id: 'baseline' | 'config-1' | 'config-2';
  /** Name shown on the test page. */
  label: string;
  /** Streaming model (grey partial text, and the first-pass final line). */
  model: SttModelId;
  /** Second pass. */
  secondPass: SecondPassSetting;
  /** The budget this configuration is held to, in bytes. */
  budgetBytes: number;
}

/** The configurations measured in Day 2 Stage 5 (developer's decision, 2026-10-28). */
export const STT_CONFIGURATIONS: readonly SttConfiguration[] = [
  {
    id: 'baseline',
    label: 'Baseline: 2023-06-21 streaming only',
    model: 'zipformer-en-2023-06-21',
    secondPass: 'off',
    budgetBytes: STT_DOWNLOAD_BUDGET_BYTES,
  },
  {
    id: 'config-1',
    label: 'Config 1: model A (grey) + GigaSpeech second pass with hotwords',
    model: 'zipformer-en-2023-06-26',
    secondPass: 'zipformer-gigaspeech-en-2023-12-12',
    budgetBytes: STT_DOWNLOAD_BUDGET_BYTES,
  },
  {
    id: 'config-2',
    label: 'Config 2: 2023-06-21 (grey) + Moonshine v2 tiny second pass',
    model: 'zipformer-en-2023-06-21',
    secondPass: 'moonshine-v2-tiny-en',
    budgetBytes: STT_DOWNLOAD_EXCEPTION_BYTES,
  },
];

/**
 * Total download of a configuration in bytes: the streaming runtime and model and, with a
 * second pass, the second-pass runtime, Silero VAD and the second-pass model.
 *
 * @param model      The streaming model.
 * @param secondPass The second-pass setting.
 * @returns Bytes.
 * Called from: SttTest.tsx; tests
 */
export function configurationBytes(model: SttModel, secondPass: SecondPassSetting): number {
  const sum = (files: readonly PinnedFile[]) =>
    files.reduce((total, file) => total + file.bytes, 0);
  const streaming = modelDownloadBytes(model);
  if (secondPass === 'off') return streaming;
  return (
    streaming +
    sum(Object.values(SECOND_PASS_RUNTIME_FILES)) +
    SILERO_VAD.bytes +
    sum(Object.values(getSecondPassModel(secondPass).files))
  );
}

/** What the second-pass worker downloads. */
export interface SecondPassDownloads {
  /** Runtime files, from our own origin. */
  runtime: Record<keyof typeof SECOND_PASS_RUNTIME_FILES, DownloadFile>;
  /** Silero VAD, from our own origin. */
  vad: DownloadFile;
  /** Model files (local or remote), keyed as in the model's `files`. */
  model: Record<string, DownloadFile>;
}

/**
 * Resolves the absolute URLs the second-pass worker downloads: runtime and VAD from our origin,
 * model files from Hugging Face (`remote`) or from /models/stt/<id>/ (`local`).
 *
 * @param model  The second-pass model.
 * @param source Where model files come from.
 * @param origin The page's origin.
 * @returns The downloads.
 * Called from: sttEngine.ts; tests
 */
export function resolveSecondPassDownloads(
  model: SecondPassModel,
  source: ModelSource,
  origin: string,
): SecondPassDownloads {
  const ours = (file: PinnedFile): DownloadFile => ({
    ...file,
    url: `${origin}${SECOND_PASS_RUNTIME_PUBLIC_PATH}/${file.name}`,
  });
  const files: Record<string, DownloadFile> = {};
  for (const [key, file] of Object.entries(model.files) as [string, PinnedFile][]) {
    files[key] =
      source === 'remote'
        ? file
        : { ...file, url: `${origin}${LOCAL_MODELS_PATH}/${model.id}/${file.name}` };
  }
  return {
    runtime: {
      loader: ours(SECOND_PASS_RUNTIME_FILES.loader),
      wasm: ours(SECOND_PASS_RUNTIME_FILES.wasm),
      api: ours(SECOND_PASS_RUNTIME_FILES.api),
      vad: ours(SECOND_PASS_RUNTIME_FILES.vad),
    },
    vad: ours(SILERO_VAD),
    model: files,
  };
}
