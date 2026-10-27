/**
 * Tests for apps/web/src/core/stt/models.ts:
 * the chosen 2023-06-21 model is listed first and the 2023-06-26 comparison model second;
 * each download size is the WebAssembly binary plus the model's files (including the hotword
 * vocabulary); only the comparison model is under ADR-0020's 150 MB limit (the chosen one is
 * over it, recorded in ADR-0020); getSttModel() rejects unknown ids.
 */
import { describe, expect, it } from 'vitest';
import { getSttModel, RUNTIME_WASM_BYTES, STT_MODELS } from '@/core/stt/models';

/** ADR-0020 download limit. */
const LIMIT_BYTES = 150 * 1_000_000;

describe('STT_MODELS', () => {
  it('lists the chosen model first and the comparison model second', () => {
    expect(STT_MODELS.map((model) => model.id)).toEqual([
      'zipformer-en-2023-06-21',
      'zipformer-en-2023-06-26',
    ]);
  });

  it('counts the WebAssembly binary and every file, including bpe.vocab', () => {
    for (const model of STT_MODELS) {
      const fileBytes = Object.values(model.files).reduce((sum, file) => sum + file.bytes, 0);
      expect(model.downloadBytes).toBe(RUNTIME_WASM_BYTES + fileBytes);
      expect(model.files.bpeVocab.name).toBe('bpe.vocab');
    }
  });

  it('records the sizes against the 150 MB limit', () => {
    expect(getSttModel('zipformer-en-2023-06-21').downloadBytes).toBe(204_110_840);
    expect(getSttModel('zipformer-en-2023-06-21').downloadBytes).toBeGreaterThan(LIMIT_BYTES);
    expect(getSttModel('zipformer-en-2023-06-26').downloadBytes).toBeLessThan(LIMIT_BYTES);
  });

  it('rejects an unknown model id', () => {
    expect(() => getSttModel('nope' as never)).toThrow(/Unknown speech-to-text model/);
  });
});
