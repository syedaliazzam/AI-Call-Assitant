/**
 * Tests for apps/web/src/core/stt/wer.ts:
 * normalisation ignores case and punctuation, and wordErrorRate() counts substitutions,
 * deletions and insertions with a correct word-by-word alignment, and counts a word heard
 * split ("to day") or two words heard joined ("northwind") as correct.
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
    // "route" heard as "rode": 1 substitution over 5 words. ("blue fin" for "bluefin" would be
    // a split word, counted as correct: see the split/joined test below.)
    const result = wordErrorRate('bluefin route sends the report', 'bluefin rode sends the report');
    expect(result).toMatchObject({
      substitutions: 1,
      insertions: 0,
      deletions: 0,
      referenceWords: 5,
    });
    expect(result.wer).toBeCloseTo(0.2);
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

  it('counts a word heard split or two words heard joined as correct', () => {
    const split = wordErrorRate(
      'thanks for joining the call today',
      'thanks for joining the call to day',
    );
    expect(split).toMatchObject({ wer: 0, substitutions: 0, insertions: 0 });
    expect(split.alignment.at(-1)).toEqual({ type: 'ok', ref: 'today', hyp: 'to day' });
    const joined = wordErrorRate('report to north wind logistics', 'report to northwind logistics');
    expect(joined).toMatchObject({ wer: 0, deletions: 0 });
    expect(joined.alignment[2]).toEqual({ type: 'ok', ref: 'north wind', hyp: 'northwind' });
  });

  it('still counts real errors next to a split word', () => {
    const result = wordErrorRate('call today renew', 'call to day review');
    expect(result).toMatchObject({ substitutions: 1, deletions: 0, insertions: 0 });
  });
});
