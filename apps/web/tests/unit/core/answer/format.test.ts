/**
 * Tests for apps/web/src/core/answer/format.ts: splitAnswer() takes the first line as the
 * headline and the rest as bullets, removing bullet and Markdown marks, and works on text that
 * is still streaming, and drops a "Headline:" label (Day 5); answerText() gives clean "- " bullets
 * for Copy. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { answerText, cardQuestion, splitAnswer } from '@/core/answer/format';

describe('splitAnswer', () => {
  it('splits the headline and bullets, removing marks', () => {
    const text =
      '**Forty seats cost 2,080 dollars a month.**\n\n- 52 dollars per seat\n• Billed yearly\n2. Fixed for two years';
    expect(splitAnswer(text)).toEqual({
      headline: 'Forty seats cost 2,080 dollars a month.',
      bullets: ['52 dollars per seat', 'Billed yearly', 'Fixed for two years'],
      code: [],
      say: '',
      tip: '',
      note: '',
    });
  });

  it('works while the answer is still streaming', () => {
    expect(splitAnswer('')).toEqual({
      headline: '',
      bullets: [],
      code: [],
      say: '',
      tip: '',
      note: '',
    });
    expect(splitAnswer('Forty seats')).toEqual({
      headline: 'Forty seats',
      bullets: [],
      code: [],
      say: '',
      tip: '',
      note: '',
    });
    expect(splitAnswer('# Forty seats\n- 52')).toEqual({
      headline: 'Forty seats',
      bullets: ['52'],
      code: [],
      say: '',
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
      code: [],
      say: '',
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

describe('the coding shape (ADR-0030)', () => {
  /** A coding answer. */
  const CODING = [
    'Use a dictionary to count.',
    '- Complexity: O(n) time',
    '```python',
    '- not a bullet',
    '',
    'x = 1',
    '```',
    'Say: I count, then scan.',
    'Note: check the version.',
  ].join('\n');

  it('takes out the code and what to say, and never reads code as bullets', () => {
    expect(splitAnswer(CODING)).toEqual({
      headline: 'Use a dictionary to count.',
      bullets: ['Complexity: O(n) time'],
      code: [{ language: 'python', text: '- not a bullet\n\nx = 1' }],
      say: 'I count, then scan.',
      tip: '',
      note: 'check the version.',
    });
  });

  it('shows a code block still arriving', () => {
    expect(splitAnswer('Approach\n```js\nconst a').code).toEqual([
      { language: 'js', text: 'const a' },
    ]);
  });

  it('copies the code and what to say, but not the private note', () => {
    const copied = answerText(CODING);
    expect(copied).toContain('x = 1');
    expect(copied).toContain('I count, then scan.');
    expect(copied).not.toContain('check the version');
  });
});

describe('v1.0.2 fail-safes and the card question (ADR-0037)', () => {
  it('never shows a hidden line, first or last', () => {
    const parts = splitAnswer(
      '[[concept|call|general]]\nIt resolves the host.\n- DNS.\n[[question|Wh',
    );
    expect(parts.headline).toBe('It resolves the host.');
    expect(parts.bullets).toEqual(['DNS.']);
  });

  it('shows a line about the other person as the Tip, never as a bullet', () => {
    const parts = splitAnswer(
      'I use Postgres.\n- Row-level locks.\nIf they want more depth, mention MVCC.\nYou could mention the WAL.',
    );
    expect(parts.bullets).toEqual(['Row-level locks.']);
    expect(parts.tip).toBe('If they want more depth, mention MVCC.');
  });

  it('cardQuestion: the clean question, else the raw words in sentence case, else the fallback', () => {
    expect(cardQuestion('WHAT DOES IT COST', 'What does it cost?')).toBe('What does it cost?');
    expect(cardQuestion('WHAT DOES IT COST', undefined)).toBe('What does it cost');
    expect(cardQuestion('', undefined)).toBe('The latest from Them');
    expect(cardQuestion('', '  ', [], 'What is on screen')).toBe('What is on screen');
  });
});

describe('the "Answer:" label (v1.0.3)', () => {
  it('drops a label the model wrote: the card adds its own bold "Answer:"', () => {
    expect(splitAnswer('**Answer:** I cut the latency to 250 ms.\n- Read replicas').headline).toBe(
      'I cut the latency to 250 ms.',
    );
  });
});
