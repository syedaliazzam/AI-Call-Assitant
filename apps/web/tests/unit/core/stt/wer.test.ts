/**
 * Tests for apps/web/src/core/stt/wer.ts:
 * normalisation ignores case and punctuation, and wordErrorRate() counts substitutions,
 * deletions and insertions with a correct word-by-word alignment.
 */
import { describe, expect, it } from 'vitest';
import { normalizeWords, wordErrorRate } from '@/core/stt/wer';

describe('normalizeWords', () => {
  it('lower-cases and drops punctuation, keeping apostrophes inside words', () => {
    expect(normalizeWords("Thanks for joining, we're ready! 'Quoted'")).toEqual([
      'thanks',
      'for',
      'joining',
      "we're",
      'ready',
      'quoted',
    ]);
    expect(normalizeWords('fifty-two  DOLLARS')).toEqual(['fifty', 'two', 'dollars']);
  });
});

describe('wordErrorRate', () => {
  it('is 0 for a perfect match, ignoring case and punctuation', () => {
    const result = wordErrorRate(
      'The plan costs fifty two dollars.',
      'THE PLAN COSTS FIFTY TWO DOLLARS',
    );
    expect(result.wer).toBe(0);
    expect(result.alignment.every((step) => step.type === 'ok')).toBe(true);
  });

  it('counts a substitution', () => {
    const result = wordErrorRate(
      'bluefin route sends the report',
      'blue fin route sends the report',
    );
    // "bluefin" → "blue" plus an extra "fin": 1 substitution + 1 insertion over 5 words.
    expect(result).toMatchObject({
      substitutions: 1,
      insertions: 1,
      deletions: 0,
      referenceWords: 5,
    });
    expect(result.wer).toBeCloseTo(0.4);
  });

  it('counts a deletion and keeps the alignment in reading order', () => {
    const result = wordErrorRate('every monday at nine thirty', 'every monday nine thirty');
    expect(result).toMatchObject({ substitutions: 0, deletions: 1, insertions: 0 });
    expect(result.alignment.map((step) => step.type)).toEqual(['ok', 'ok', 'del', 'ok', 'ok']);
  });

  it('treats an empty hypothesis as all words missed', () => {
    const result = wordErrorRate('renew the contract', '');
    expect(result.wer).toBe(1);
    expect(result.deletions).toBe(3);
  });
});
