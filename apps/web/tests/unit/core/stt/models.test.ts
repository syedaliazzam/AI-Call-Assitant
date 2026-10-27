/**
 * Tests for apps/web/src/core/stt/models.ts:
 * the streaming list has 2023-06-21 (default) and model A (2023-06-26, grey text only); every
 * model file (streaming and second pass) is pinned to a Hugging Face commit URL with a SHA-256;
 * both runtimes and Silero VAD always come from our own origin; `local` and `remote` resolve to
 * the right URLs; the source setting picks remote in production and local in development unless
 * overridden; the Day 2 Stage 5 configurations have the measured download sizes (175.4 MB and
 * 262.4 MB) and the right budgets; the second pass is off by default.
 */
import { describe, expect, it } from 'vitest';
import {
  configurationBytes,
  DEFAULT_SECOND_PASS,
  DEFAULT_STT_MODEL,
  getSecondPassModel,
  getSttModel,
  modelDownloadBytes,
  MOONSHINE_V2_TINY_EN,
  pickModelSource,
  resolveDownloads,
  resolveSecondPassDownloads,
  RUNTIME_FILES,
  SECOND_PASS_MODELS,
  SECOND_PASS_RUNTIME_FILES,
  SILERO_VAD,
  STT_CONFIGURATIONS,
  STT_DOWNLOAD_BUDGET_BYTES,
  STT_DOWNLOAD_EXCEPTION_BYTES,
  STT_MODELS,
  TEST_RECORDINGS,
  testRecordingUrl,
  ZIPFORMER_EN_2023_06_21,
  ZIPFORMER_EN_2023_06_26,
  ZIPFORMER_GIGASPEECH_EN,
} from '@/core/stt/models';

/** A pinned Hugging Face URL: resolve/<40-hex commit>/… (never a branch like "main"). */
const PINNED_HF =
  /^https:\/\/huggingface\.co\/(csukuangfj|csukuangfj2|k2-fsa)\/[^/]+\/resolve\/[0-9a-f]{40}\//;

describe('STT_MODELS', () => {
  it('lists 2023-06-21 (the default) and model A 2023-06-26', () => {
    expect(STT_MODELS.map((model) => model.id)).toEqual([
      'zipformer-en-2023-06-21',
      'zipformer-en-2023-06-26',
    ]);
    expect(DEFAULT_STT_MODEL).toBe('zipformer-en-2023-06-21');
    expect(getSttModel('zipformer-en-2023-06-26').licence).toBe('Apache-2.0');
  });

  it('pins every model file and test recording to a commit, with a SHA-256', () => {
    const files = [
      ...STT_MODELS.flatMap((model) => Object.values(model.files)),
      ...SECOND_PASS_MODELS.flatMap((model) => Object.values(model.files)),
      ...TEST_RECORDINGS,
    ];
    for (const file of files) {
      expect(file.url).toMatch(PINNED_HF);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.bytes).toBeGreaterThan(0);
    }
  });

  it('keeps the streaming-only download at 204.5 MB (within 250 MB)', () => {
    const bytes = modelDownloadBytes(ZIPFORMER_EN_2023_06_21);
    expect(bytes).toBe(204_479_670);
    expect(bytes).toBeLessThan(STT_DOWNLOAD_BUDGET_BYTES);
  });

  it('rejects unknown model ids', () => {
    expect(() => getSttModel('nope' as never)).toThrow(/Unknown speech-to-text model/);
    expect(() => getSecondPassModel('nope' as never)).toThrow(/Unknown second-pass model/);
  });
});

describe('second pass', () => {
  it('is off by default and has the two candidates', () => {
    expect(DEFAULT_SECOND_PASS).toBe('off');
    expect(SECOND_PASS_MODELS.map((model) => model.id)).toEqual([
      'zipformer-gigaspeech-en-2023-12-12',
      'moonshine-v2-tiny-en',
    ]);
    expect(ZIPFORMER_GIGASPEECH_EN).toMatchObject({ kind: 'transducer', hotwords: true });
    expect(MOONSHINE_V2_TINY_EN).toMatchObject({ kind: 'moonshine-v2', hotwords: false });
    expect(MOONSHINE_V2_TINY_EN.licence).toBe('MIT');
  });

  it('pins the runtime files and Silero VAD with SHA-256s', () => {
    for (const file of [...Object.values(SECOND_PASS_RUNTIME_FILES), SILERO_VAD]) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(SECOND_PASS_RUNTIME_FILES.api.sha256).toBe(RUNTIME_FILES.api.sha256);
    expect(SILERO_VAD.url).toContain('/releases/download/asr-models/');
  });

  it('serves the runtime and VAD from our origin, model files from Hugging Face or local', () => {
    const remote = resolveSecondPassDownloads(
      ZIPFORMER_GIGASPEECH_EN,
      'remote',
      'https://k.example',
    );
    expect(remote.runtime.wasm.url).toBe(
      'https://k.example/stt-runtime/v1.13.2/sherpa-onnx-wasm-main-vad-asr.wasm',
    );
    expect(remote.vad.url).toBe('https://k.example/stt-runtime/v1.13.2/silero_vad.onnx');
    expect(remote.model.encoder!.url).toMatch(PINNED_HF);
    const local = resolveSecondPassDownloads(
      MOONSHINE_V2_TINY_EN,
      'local',
      'http://localhost:3000',
    );
    expect(local.model.mergedDecoder!.url).toBe(
      'http://localhost:3000/models/stt/moonshine-v2-tiny-en/decoder_model_merged.ort',
    );
    expect(local.model.tokens!.sha256).toBe(MOONSHINE_V2_TINY_EN.files.tokens.sha256);
  });
});

describe('STT_CONFIGURATIONS', () => {
  it('are the baseline and the two configurations the developer chose', () => {
    expect(STT_CONFIGURATIONS.map((c) => [c.id, c.model, c.secondPass])).toEqual([
      ['baseline', 'zipformer-en-2023-06-21', 'off'],
      ['config-1', 'zipformer-en-2023-06-26', 'zipformer-gigaspeech-en-2023-12-12'],
      ['config-2', 'zipformer-en-2023-06-21', 'moonshine-v2-tiny-en'],
    ]);
  });

  it('have the planned sizes: config 1 fits 250 MB, config 2 only the 265 MB exception', () => {
    const bytes = (id: string) => {
      const config = STT_CONFIGURATIONS.find((c) => c.id === id)!;
      return { size: configurationBytes(getSttModel(config.model), config.secondPass), config };
    };
    const one = bytes('config-1');
    expect(one.size).toBe(175_360_446);
    expect(one.size).toBeLessThan(one.config.budgetBytes);
    expect(one.config.budgetBytes).toBe(STT_DOWNLOAD_BUDGET_BYTES);
    const two = bytes('config-2');
    expect(two.size).toBe(262_443_783);
    expect(two.size).toBeGreaterThan(STT_DOWNLOAD_BUDGET_BYTES);
    expect(two.size).toBeLessThan(STT_DOWNLOAD_EXCEPTION_BYTES);
    expect(two.config.budgetBytes).toBe(STT_DOWNLOAD_EXCEPTION_BYTES);
    expect(bytes('baseline').size).toBe(modelDownloadBytes(ZIPFORMER_EN_2023_06_21));
  });
});

describe('resolveDownloads', () => {
  it('serves the runtime from our origin and model files from Hugging Face when remote', () => {
    const { runtime, model } = resolveDownloads(
      ZIPFORMER_EN_2023_06_21,
      'remote',
      'https://kite.example',
    );
    expect(runtime.wasm.url).toBe(
      'https://kite.example/stt-runtime/v1.13.7/sherpa-onnx-wasm-main-asr.wasm',
    );
    expect(runtime.wasm.sha256).toBe(RUNTIME_FILES.wasm.sha256);
    expect(model.encoder.url).toMatch(PINNED_HF);
  });

  it('serves model files from /models/stt/<id>/ when local, with the same checksums', () => {
    const { model } = resolveDownloads(ZIPFORMER_EN_2023_06_26, 'local', 'http://localhost:3000');
    expect(model.tokens.url).toBe(
      'http://localhost:3000/models/stt/zipformer-en-2023-06-26/tokens.txt',
    );
    expect(model.tokens.sha256).toBe(ZIPFORMER_EN_2023_06_21.files.tokens.sha256);
  });

  it('resolves test recordings from the same source', () => {
    const [first] = TEST_RECORDINGS;
    expect(testRecordingUrl(first!, 'local', 'http://localhost:3000')).toBe(
      'http://localhost:3000/models/stt/test-wavs/0.wav',
    );
    expect(testRecordingUrl(first!, 'remote', 'http://localhost:3000')).toMatch(PINNED_HF);
  });
});

describe('pickModelSource', () => {
  it('uses remote in production builds and local in development', () => {
    expect(pickModelSource(undefined, 'production')).toBe('remote');
    expect(pickModelSource(undefined, 'development')).toBe('local');
  });

  it('lets NEXT_PUBLIC_STT_SOURCE override, and ignores other values', () => {
    expect(pickModelSource('local', 'production')).toBe('local');
    expect(pickModelSource('remote', 'development')).toBe('remote');
    expect(pickModelSource('cdn', 'production')).toBe('remote');
  });
});
