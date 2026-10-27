/**
 * Tests for apps/web/src/core/stt/wer.ts:
 * normalisation ignores case and punctuation, and wordErrorRate() counts substitutions,
 * deletions and insertions with a correct word-by-word alignment, and counts a word heard
 * split ("to day") or two words heard joined ("northwind") as correct. Numbers written as digits
 * (money, times, thousands, decimals, percentages) are spelled out the way the test sentences
 * write them, so a model that writes "$52" and "9:30" scores the same as one that writes words.
 */
import { describe, expect, it } from 'vitest';
import { normalizeWords, numberWords, spellNumbers, wordErrorRate } from '@/core/stt/wer';

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

describe('numbers', () => {
  it('spells whole numbers the way the test sentences do', () => {
    expect(numberWords(0)).toBe('zero');
    expect(numberWords(52)).toBe('fifty two');
    expect(numberWords(150)).toBe('one hundred and fifty');
    expect(numberWords(1_500)).toBe('one thousand five hundred');
    expect(numberWords(2_005)).toBe('two thousand and five');
    expect(numberWords(3_000_000)).toBe('three million');
  });

  it('spells money, times, decimals, percentages and separators', () => {
    const words = (text: string) => normalizeWords(spellNumbers(text)).join(' ');
    expect(words('$52 per seat')).toBe('fifty two dollars per seat');
    expect(words('$1,500.25')).toBe('one thousand five hundred dollars and twenty five cents');
    expect(words('at 9:30')).toBe('at nine thirty');
    expect(words('at 9:05')).toBe('at nine oh five');
    expect(words('2.5 times')).toBe('two point five times');
    expect(words('20% off')).toBe('twenty percent off');
    expect(words('150 seats')).toBe('one hundred and fifty seats');
  });

  it('scores a Moonshine-style sentence with digits as perfect', () => {
    const reference =
      'The professional plan costs fifty two dollars per seat per month for one hundred and fifty seats.';
    const heard = 'The professional plan costs $52 per seat per month for 150 seats.';
    expect(wordErrorRate(reference, heard).wer).toBe(0);
    expect(
      wordErrorRate(
        'Bluefin Route sends the weekly delivery report to Northwind Logistics every Monday at nine thirty.',
        'Bluefin Route sends the weekly delivery report to Northwind Logistics every Monday at 9:30.',
      ).wer,
    ).toBe(0);
  });
});
