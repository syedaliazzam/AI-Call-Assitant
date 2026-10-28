/**
 * Tests for apps/web/src/core/stt/models.ts:
 * only the 2023-06-21 model is in the production list (model 2023-06-26 was rejected); every
 * model file is pinned to a Hugging Face commit URL with a SHA-256; the runtime always comes from
 * our own origin; `local` and `remote` resolve to the right URLs; the source setting picks
 * remote in production and local in development unless overridden; the download size fits the
 * 250 MB limit (ADR-0020).
 */
import { describe, expect, it } from 'vitest';
import {
  getSttModel,
  modelDownloadBytes,
  pickModelSource,
  resolveDownloads,
  RUNTIME_FILES,
  STT_MODELS,
  TEST_RECORDINGS,
  testRecordingUrl,
  ZIPFORMER_EN_2023_06_21,
} from '@/core/stt/models';

/** A pinned Hugging Face URL: resolve/<40-hex commit>/… (never a branch like "main"). */
const PINNED_HF = /^https:\/\/huggingface\.co\/csukuangfj\/[^/]+\/resolve\/[0-9a-f]{40}\//;

describe('STT_MODELS', () => {
  it('lists only the working 2023-06-21 model', () => {
    expect(STT_MODELS.map((model) => model.id)).toEqual(['zipformer-en-2023-06-21']);
    expect(getSttModel('zipformer-en-2023-06-21').licence).toBe('Apache-2.0');
  });

  it('pins every model file and test recording to a commit, with a SHA-256', () => {
    for (const file of [...Object.values(ZIPFORMER_EN_2023_06_21.files), ...TEST_RECORDINGS]) {
      expect(file.url).toMatch(PINNED_HF);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.bytes).toBeGreaterThan(0);
    }
  });

  it('fits the 250 MB limit (204.4 MB including the runtime and bpe.model)', () => {
    const bytes = modelDownloadBytes(ZIPFORMER_EN_2023_06_21);
    expect(bytes).toBe(204_479_670);
    expect(bytes).toBeLessThan(250 * 1_000_000);
  });

  it('rejects an unknown model id', () => {
    expect(() => getSttModel('nope' as never)).toThrow(/Unknown speech-to-text model/);
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
    const { model } = resolveDownloads(ZIPFORMER_EN_2023_06_21, 'local', 'http://localhost:3000');
    expect(model.tokens.url).toBe(
      'http://localhost:3000/models/stt/zipformer-en-2023-06-21/tokens.txt',
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
