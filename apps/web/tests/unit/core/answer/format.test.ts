/**
 * Tests for apps/web/src/core/answer/format.ts: splitAnswer() takes the first line as the
 * headline and the rest as bullets, removing bullet and Markdown marks, and works on text that
 * is still streaming; answerText() gives clean "- " bullets for Copy. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { answerText, splitAnswer } from '@/core/answer/format';

describe('splitAnswer', () => {
  it('splits the headline and bullets, removing marks', () => {
    const text =
      '**Forty seats cost 2,080 dollars a month.**\n\n- 52 dollars per seat\n• Billed yearly\n2. Fixed for two years';
    expect(splitAnswer(text)).toEqual({
      headline: 'Forty seats cost 2,080 dollars a month.',
      bullets: ['52 dollars per seat', 'Billed yearly', 'Fixed for two years'],
    });
  });

  it('works while the answer is still streaming', () => {
    expect(splitAnswer('')).toEqual({ headline: '', bullets: [] });
    expect(splitAnswer('Forty seats')).toEqual({ headline: 'Forty seats', bullets: [] });
    expect(splitAnswer('# Forty seats\n- 52')).toEqual({
      headline: 'Forty seats',
      bullets: ['52'],
    });
  });
});

describe('answerText', () => {
  it('gives the headline and "- " bullets', () => {
    expect(answerText('**Yes.**\n* Fixed price\n* Two years')).toBe(
      'Yes.\n- Fixed price\n- Two years',
    );
  });
});
