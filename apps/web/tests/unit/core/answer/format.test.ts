/**
 * Tests for apps/web/src/core/answer/format.ts: splitAnswer() takes the first line as the
 * headline and the rest as bullets, removing bullet and Markdown marks, and works on text that
 * is still streaming, and drops a "Headline:" label (Day 5); answerText() gives clean "- " bullets
 * for Copy. All text is invented.
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
      tip: '',
      note: '',
    });
  });

  it('works while the answer is still streaming', () => {
    expect(splitAnswer('')).toEqual({ headline: '', bullets: [], tip: '', note: '' });
    expect(splitAnswer('Forty seats')).toEqual({
      headline: 'Forty seats',
      bullets: [],
      tip: '',
      note: '',
    });
    expect(splitAnswer('# Forty seats\n- 52')).toEqual({
      headline: 'Forty seats',
      bullets: ['52'],
      tip: '',
      note: '',
    });
  });

  it('takes out the closing tip and the private note (ADR-0029)', () => {
    const text =
      'I can start next week.\n- We finished the pilot\nTip: mention the Lahore rollout.\nNote: check the date with finance.';
    expect(splitAnswer(text)).toEqual({
      headline: 'I can start next week.',
      bullets: ['We finished the pilot'],
      tip: 'mention the Lahore rollout.',
      note: 'check the date with finance.',
    });
    // Copy is what the user says: the tip is in, the private note is not.
    expect(answerText(text)).toBe(
      'I can start next week.\n- We finished the pilot\nmention the Lahore rollout.',
    );
  });
});

describe('answerText', () => {
  it('gives the headline and "- " bullets', () => {
    expect(answerText('**Yes.**\n* Fixed price\n* Two years')).toBe(
      'Yes.\n- Fixed price\n- Two years',
    );
  });
});

describe('the "Headline:" label (Day 5)', () => {
  it('is removed from any answer, in any case and with Markdown, and Copy leaves it out too', () => {
    expect(splitAnswer('Headline: Numbers match the slide.\n- 128 seats').headline).toBe(
      'Numbers match the slide.',
    );
    expect(splitAnswer('**HEADLINE :** Yes, it fits.').headline).toBe('Yes, it fits.');
    expect(answerText('headline: Ten dollars.\n- Per seat')).toBe('Ten dollars.\n- Per seat');
    // A headline that merely mentions the word keeps it.
    expect(splitAnswer('The headline figure is 6,656 dollars.').headline).toBe(
      'The headline figure is 6,656 dollars.',
    );
  });
});
