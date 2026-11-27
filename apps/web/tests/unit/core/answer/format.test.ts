/**
 * Tests for apps/web/src/core/answer/format.ts: splitAnswer() takes the first line as the
 * headline and the rest as bullets, removing bullet and Markdown marks, and works on text that
 * is still streaming, and drops a "Headline:" label (Day 5); answerText() gives clean "- " bullets
 * for Copy. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import {
  answerText,
  cardQuestion,
  labelOf,
  splitAnswer,
  splitLongLine,
} from '@/core/answer/format';

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
      stillOpen: '',
      labelled: false,
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
      stillOpen: '',
      labelled: false,
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
      stillOpen: '',
      labelled: false,
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
      stillOpen: '',
      labelled: false,
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
      stillOpen: '',
      labelled: false,
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
      stillOpen: '',
      labelled: false,
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

  it('cardQuestion: a long raw question shows only its newest sentences, at most 20 words (ADR-0133)', () => {
    // About 45 seconds of talk (invented): the card shows the question, not the block.
    const talk =
      'We are putting more teams on the new planner next month. We will gather data from the depots and the drivers. Then we look at what we learn together. Is that part of the next phase? Okay.';
    expect(cardQuestion(talk, undefined)).toBe(
      'Then we look at what we learn together. Is that part of the next phase?',
    );
    // One sentence longer than the limit: its last 20 words.
    const long = `${'very '.repeat(30)}long question about the rollout?`;
    const shown = cardQuestion(long, undefined);
    expect(shown.startsWith('…')).toBe(true);
    expect(shown.slice(1).split(' ')).toHaveLength(20);
    expect(shown.endsWith('rollout?')).toBe(true);
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

describe('the 12-word answer line (ADR-0135; was v1.1.0, item 16)', () => {
  // Two sentences, the first within the limit: the card shows the first, the second becomes a bullet.
  const TWO =
    'We cut late deliveries by a third on the northern routes. Most of it came from rerouting at night.';

  it('leaves a line of up to 12 words alone', () => {
    const line = 'One two three four five six seven eight nine ten eleven twelve';
    expect(splitLongLine(line)).toEqual({ line, rest: '' });
  });

  it('cuts only between whole sentences', () => {
    expect(splitLongLine(TWO)).toEqual({
      line: 'We cut late deliveries by a third on the northern routes.',
      rest: 'Most of it came from rerouting at night.',
    });
  });

  it('never splits one sentence, however long, at a clause or a joining word', () => {
    // The 27 Nov 2026 card (invented words of the same shape): the old cut made "With you…" a bullet.
    const line = 'Let me confirm the delivery details with you before we move on to the next item.';
    expect(splitLongLine(line)).toEqual({ line, rest: '' });
    for (const one of [
      'We cut late deliveries by a third across the northern routes, mostly by rerouting at night',
      'I rebuilt the billing export in Go last year and it now finishes within ten minutes',
      'I run the nightly route planning jobs on Kubernetes for the whole freight team',
    ]) {
      expect(splitLongLine(one)).toEqual({ line: one, rest: '' });
      const parts = splitAnswer(`${one}\n- A bullet.`, true);
      expect(parts.headline).toBe(one);
      expect(parts.bullets).toEqual(['A bullet.']);
    }
  });

  it('does not take an abbreviation or a decimal for a sentence end', () => {
    for (const line of [
      'We use queues e.g. Kafka for the nightly jobs across all four regional teams.',
      'Dr. Patel signed off the plan for the northern routes and the weekend shifts.',
      'Version 2.5 cut the export time for the northern routes by a third this month.',
    ]) {
      expect(splitLongLine(line)).toEqual({ line, rest: '' });
    }
  });

  it('keeps the first sentence whole when it alone is over the limit', () => {
    const line =
      'We rebuilt the whole nightly export pipeline for the northern routes last spring. It runs daily.';
    expect(splitLongLine(line)).toEqual({
      line: 'We rebuilt the whole nightly export pipeline for the northern routes last spring.',
      rest: 'It runs daily.',
    });
  });

  it('puts the rest in front of the bullets when the answer has bullets', () => {
    const parts = splitAnswer(`${TWO}\n- A bullet.`);
    expect(parts.headline).toBe('We cut late deliveries by a third on the northern routes.');
    expect(parts.bullets).toEqual(['Most of it came from rerouting at night.', 'A bullet.']);
  });

  it('never cuts a line with nothing under it while it may still grow', () => {
    expect(splitAnswer(TWO).headline).toBe(TWO);
    expect(splitAnswer(TWO).bullets).toEqual([]);
  });

  it('cuts a finished one-line answer, but never a paragraph', () => {
    const cut = splitAnswer(TWO, true);
    expect(cut.headline).toBe('We cut late deliveries by a third on the northern routes.');
    expect(cut.bullets).toEqual(['Most of it came from rerouting at night.']);
    const paragraph = new Array(8)
      .fill('We cut late deliveries by a third, on most of the routes.')
      .join(' ');
    expect(splitAnswer(paragraph, true).headline).toBe(paragraph);
    expect(splitAnswer(paragraph, true).bullets).toEqual([]);
  });

  it('copies the same words that were shown', () => {
    const copied = answerText(`${TWO}\n- A bullet.`);
    expect(copied).toContain('- Most of it came from rerouting at night.');
  });
});

describe('a sentence is never split across lines (ADR-0135, streamed edge cases)', () => {
  const ANSWER =
    '[[sales|call|call]]\nLet me confirm the delivery details\nwith you before we move on.\n- We can start the pilot next week.\nTip: Ask which team joins first.';

  it('joins a line that goes on with the sentence above, at every point of the stream', () => {
    // Every prefix of the reply, as it streams: no prefix ever shows "with you…" as a bullet.
    for (let end = 1; end <= ANSWER.length; end += 1) {
      const parts = splitAnswer(ANSWER.slice(0, end), end === ANSWER.length);
      for (const bullet of parts.bullets) expect(bullet).not.toMatch(/^with\b/i);
    }
    const done = splitAnswer(ANSWER, true);
    expect(done.headline).toBe('Let me confirm the delivery details with you before we move on.');
    expect(done.bullets).toEqual(['We can start the pilot next week.']);
    expect(done.tip).toBe('Ask which team joins first.');
  });

  it('joins a lower-case bullet to a bullet that did not end its sentence', () => {
    const parts = splitAnswer(
      'Yes, we can.\n- The pilot covers the\n- northern routes only.',
      true,
    );
    expect(parts.bullets).toEqual(['The pilot covers the northern routes only.']);
  });

  it('keeps a new sentence on its own line, and never joins to a finished one', () => {
    const parts = splitAnswer('Yes, we can.\n- The pilot is ready.\n- next week we add two teams.');
    expect(parts.bullets).toEqual(['The pilot is ready.', 'next week we add two teams.']);
  });

  it('reads an en dash or em dash at the start of a line as a bullet mark', () => {
    const parts = splitAnswer('Yes, we can.\n– The pilot is ready.\n— Two teams join next week.');
    expect(parts.bullets).toEqual(['The pilot is ready.', 'Two teams join next week.']);
  });

  it('never joins into code or after a label line', () => {
    const parts = splitAnswer(
      'Use a queue.\nKey steps:\n- read the file\n```js\nconst a = 1;\n```',
    );
    expect(parts.keySteps).toBe(true);
    expect(parts.bullets).toEqual(['read the file']);
    expect(parts.code[0]!.text).toBe('const a = 1;');
  });
});

describe('several questions in one answer (ADR-0133)', () => {
  const THREE =
    'Timeline: We start the pilot next week.\nData hosting: I will confirm the region after the call.\nTeam size: Two engineers join from day one.\nStill open: pricing tiers and SSO.';

  it('reads labelled lines, never cuts them, and takes out the "Still open" line', () => {
    const parts = splitAnswer(THREE, true);
    expect(parts.labelled).toBe(true);
    expect(parts.headline).toBe('Timeline: We start the pilot next week.');
    expect(parts.bullets).toEqual([
      'Data hosting: I will confirm the region after the call.',
      'Team size: Two engineers join from day one.',
    ]);
    expect(parts.stillOpen).toBe('pricing tiers and SSO.');
    // Copy is what the user says: the "Still open" line is not.
    expect(answerText(THREE)).not.toContain('pricing tiers');
  });

  it('labelOf finds a short label, and only a short one', () => {
    expect(labelOf('Data hosting: in the EU region.')).toEqual({
      label: 'Data hosting',
      text: 'in the EU region.',
    });
    expect(labelOf('We start the pilot next week: it is ready.')).toBeNull();
    expect(labelOf('timeline: lower-case is not a label.')).toBeNull();
  });

  it('is not labelled when only the answer line has a label', () => {
    const parts = splitAnswer('Short answer: yes.\n- The pilot covers two depots.', true);
    expect(parts.labelled).toBe(false);
  });
});
