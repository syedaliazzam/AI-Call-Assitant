/**
 * Tests for apps/web/src/core/answer/format.ts: splitAnswer() takes the first line as the
 * headline and the rest as bullets, removing bullet and Markdown marks, and works on text that
 * is still streaming, and drops a "Headline:" label (Day 5); answerText() gives clean "- " bullets
 * for Copy. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { answerText, cardQuestion, splitAnswer, splitLongLine } from '@/core/answer/format';

describe('splitAnswer', () => {
  it('splits the headline and bullets, removing marks', () => {
    const text =
      '**Forty seats cost 2,080 dollars a month.**\n\n- 52 dollars per seat\n• Billed yearly\n2. Fixed for two years';
    expect(splitAnswer(text)).toEqual({
      headline: 'Forty seats cost 2,080 dollars a month.',
      bullets: ['52 dollars per seat', 'Billed yearly', 'Fixed for two years'],
      keySteps: false,
      code: [],
      complexity: '',
      say: '',
      tip: '',
      note: '',
    });
  });

  it('works while the answer is still streaming', () => {
    expect(splitAnswer('')).toEqual({
      headline: '',
      bullets: [],
      keySteps: false,
      code: [],
      complexity: '',
      say: '',
      tip: '',
      note: '',
    });
    expect(splitAnswer('Forty seats')).toEqual({
      headline: 'Forty seats',
      bullets: [],
      keySteps: false,
      code: [],
      complexity: '',
      say: '',
      tip: '',
      note: '',
    });
    expect(splitAnswer('# Forty seats\n- 52')).toEqual({
      headline: 'Forty seats',
      bullets: ['52'],
      keySteps: false,
      code: [],
      complexity: '',
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
      keySteps: false,
      code: [],
      complexity: '',
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
      bullets: [],
      keySteps: false,
      code: [{ language: 'python', text: '- not a bullet\n\nx = 1' }],
      complexity: 'O(n) time',
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

  it('cardQuestion: an answer with no clean question stops at the last question mark (v1.0.4)', () => {
    expect(cardQuestion('What does it cost? So anyway we were thinking', undefined)).toBe(
      'What does it cost?',
    );
    expect(cardQuestion('What does it cost? And for how long? Okay then', undefined)).toBe(
      'What does it cost? And for how long?',
    );
    expect(cardQuestion('UM TELL ME ABOUT YOURSELF? UH OKAY', undefined)).toBe(
      'Tell me about yourself?',
    );
    // The clean question is never cut.
    expect(cardQuestion('Raw words?', 'Is this clean? Yes.')).toBe('Is this clean? Yes.');
  });
});

describe('the "Answer:" label (v1.0.3)', () => {
  it('drops a label the model wrote: the card adds its own bold "Answer:"', () => {
    expect(splitAnswer('**Answer:** I cut the latency to 250 ms.\n- Read replicas').headline).toBe(
      'I cut the latency to 250 ms.',
    );
  });
});

describe('the coding shape (v1.1.0, item 7)', () => {
  const ANSWER = [
    'Count the vowels with one pass over the lower-cased text.',
    'Key steps:',
    '- Lower-case the text.',
    '- Count the characters in a set of vowels.',
    '```python',
    'def count_vowels(text):',
    '    return sum(c in "aeiou" for c in text.lower())',
    '```',
    'Complexity: O(n) time, O(1) space.',
    'Say: I walk the string once and count what is in the vowel set.',
  ].join('\n');

  it('splits the answer line, key steps, code, complexity and what to say', () => {
    const parts = splitAnswer(ANSWER);
    expect(parts.headline).toBe('Count the vowels with one pass over the lower-cased text.');
    expect(parts.keySteps).toBe(true);
    expect(parts.bullets).toEqual([
      'Lower-case the text.',
      'Count the characters in a set of vowels.',
    ]);
    expect(parts.code).toHaveLength(1);
    expect(parts.code[0]?.language).toBe('python');
    expect(parts.complexity).toBe('O(n) time, O(1) space.');
    expect(parts.say).toBe('I walk the string once and count what is in the vowel set.');
  });

  it('copies every part, with the complexity labelled', () => {
    const copied = answerText(ANSWER);
    expect(copied).toContain('Complexity: O(n) time, O(1) space.');
    expect(copied).toContain('def count_vowels(text):');
    expect(copied).not.toContain('Key steps');
  });

  it('leaves an answer of the old shape as it was', () => {
    const parts = splitAnswer('Use a queue.\n- Workers pull jobs.\n- Retries back off.');
    expect(parts.keySteps).toBe(false);
    expect(parts.complexity).toBe('');
    expect(parts.bullets).toHaveLength(2);
  });

  it('reads "Time complexity:" as the complexity line', () => {
    expect(splitAnswer('Approach.\nTime complexity: O(n).').complexity).toBe('O(n).');
  });
});

describe('the 12-word answer line (v1.1.0, item 16)', () => {
  const LONG =
    'We cut late deliveries by a third across the northern routes, mostly by rerouting at night';

  it('leaves a line of up to 12 words alone', () => {
    const line = 'One two three four five six seven eight nine ten eleven twelve';
    expect(splitLongLine(line)).toEqual({ line, rest: '' });
  });

  it('cuts at the last clause break within the limit, with the rest capitalised', () => {
    expect(splitLongLine(LONG)).toEqual({
      line: 'We cut late deliveries by a third across the northern routes.',
      rest: 'Mostly by rerouting at night',
    });
  });

  it('cuts before a joining word too', () => {
    const { line, rest } = splitLongLine(
      'I rebuilt the billing export in Go last year and it now finishes within ten minutes',
    );
    expect(line).toBe('I rebuilt the billing export in Go last year.');
    expect(rest).toBe('And it now finishes within ten minutes');
  });

  it('cuts before a word that starts a phrase, when there is no clause', () => {
    const { line, rest } = splitLongLine(
      'I run the nightly route planning jobs on Kubernetes for the whole freight team',
    );
    expect(line).toBe('I run the nightly route planning jobs on Kubernetes.');
    expect(rest).toBe('For the whole freight team');
  });

  it('keeps the line whole when no break leaves at least three words within the limit', () => {
    const line =
      'One two, three four five six seven eight nine ten eleven twelve thirteen fourteen';
    expect(splitLongLine(line)).toEqual({ line, rest: '' });
  });

  it('puts the rest in front of the bullets when the answer has bullets', () => {
    const parts = splitAnswer(`${LONG}\n- A bullet.`);
    expect(parts.headline).toBe('We cut late deliveries by a third across the northern routes.');
    expect(parts.bullets).toEqual(['Mostly by rerouting at night', 'A bullet.']);
  });

  it('never cuts a line with nothing under it while it may still grow', () => {
    expect(splitAnswer(LONG).headline).toBe(LONG);
    expect(splitAnswer(LONG).bullets).toEqual([]);
  });

  it('cuts a finished one-line answer, but never a paragraph', () => {
    const cut = splitAnswer(LONG, true);
    expect(cut.headline).toBe('We cut late deliveries by a third across the northern routes.');
    expect(cut.bullets).toEqual(['Mostly by rerouting at night']);
    const paragraph = new Array(8)
      .fill('We cut late deliveries by a third, on most of the routes.')
      .join(' ');
    expect(splitAnswer(paragraph, true).headline).toBe(paragraph);
    expect(splitAnswer(paragraph, true).bullets).toEqual([]);
  });

  it('copies the same words that were shown', () => {
    const copied = answerText(`${LONG}\n- A bullet.`);
    expect(copied).toContain('- Mostly by rerouting at night');
  });
});
