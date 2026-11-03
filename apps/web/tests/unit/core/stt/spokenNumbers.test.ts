/**
 * Tests for apps/web/src/core/stt/spokenNumbers.ts (ADR-0027): a key term with digits becomes the
 * spoken-word forms the recognizer would write, so it can be a hotword and be mapped back for
 * display. numberToWords() reads cardinals, digitsToWords() reads digit by digit, and
 * spokenVariants() gives at most two readings per term (a bare four-digit year paired first). Every
 * term here is invented or a public product/standard name.
 */
import { describe, expect, it } from 'vitest';
import {
  digitsToWords,
  MAX_SPOKEN_VARIANTS,
  numberToWords,
  spokenVariants,
} from '@/core/stt/spokenNumbers';

describe('numberToWords', () => {
  it('reads cardinals up to 9999', () => {
    expect(numberToWords(0)).toBe('ZERO');
    expect(numberToWords(4)).toBe('FOUR');
    expect(numberToWords(25)).toBe('TWENTY FIVE');
    expect(numberToWords(100)).toBe('ONE HUNDRED');
    expect(numberToWords(250)).toBe('TWO HUNDRED FIFTY');
    expect(numberToWords(2026)).toBe('TWO THOUSAND TWENTY SIX');
  });
});

describe('digitsToWords', () => {
  it('reads each digit', () => {
    expect(digitsToWords('100')).toBe('ONE ZERO ZERO');
    expect(digitsToWords('25')).toBe('TWO FIVE');
  });
});

describe('spokenVariants', () => {
  it('returns [] for a term with no digit', () => {
    expect(spokenVariants('Bluefin Route')).toEqual([]);
  });

  it('spells a number after a letter prefix, cardinal then digit by digit', () => {
    expect(spokenVariants('BM25')).toEqual(['BM TWENTY FIVE', 'BM TWO FIVE']);
    expect(spokenVariants('H100')).toEqual(['H ONE HUNDRED', 'H ONE ZERO ZERO']);
  });

  it('reads a bare four-digit year in pairs first, then as a full cardinal', () => {
    expect(spokenVariants('2026')).toEqual(['TWENTY TWENTY SIX', 'TWO THOUSAND TWENTY SIX']);
  });

  it('gives one variant when both readings are the same (a single digit)', () => {
    expect(spokenVariants('GPT-4')).toEqual(['GPT FOUR']);
    expect(spokenVariants('S3')).toEqual(['S THREE']);
  });

  it('never gives more than MAX_SPOKEN_VARIANTS', () => {
    expect(spokenVariants('H100').length).toBeLessThanOrEqual(MAX_SPOKEN_VARIANTS);
    expect(spokenVariants('2026').length).toBeLessThanOrEqual(MAX_SPOKEN_VARIANTS);
  });
});
