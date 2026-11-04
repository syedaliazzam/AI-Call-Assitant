/**
 * Tests for apps/web/scripts/lib/answer-line.ts and answerLineWords() in core/answer/format.ts (v1.1.0,
 * item 16): what the paid evaluation counts as the answer line's length. A label is not counted; the
 * check only applies to the headline format, for the call. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { callAnswerLine } from '../../../scripts/lib/answer-line';
import { answerLineWords } from '@/core/answer/format';

describe('answerLineWords', () => {
  it('counts the words, not a label or Markdown marks', () => {
    expect(answerLineWords('Forty seats comes to 2,080 dollars a month.')).toBe(8);
    expect(answerLineWords('Answer: Forty seats comes to 2,080 dollars a month.')).toBe(8);
    expect(answerLineWords('**Headline:** Forty seats comes to 2,080 dollars a month.')).toBe(8);
    expect(answerLineWords('- Forty seats.')).toBe(2);
    expect(answerLineWords('')).toBe(0);
  });
});

describe('callAnswerLine', () => {
  const words13 = 'One two three four five six seven eight nine ten eleven twelve thirteen.';

  it('reports the first line of a headline answer for the call', () => {
    expect(callAnswerLine(`\n${words13}\n- A bullet.`, 'headline+bullets', null)).toEqual({
      answerLineWords: 13,
      shownLineWords: 13,
    });
    expect(callAnswerLine('Short line.', 'headline+bullets', { target: 'call' })).toEqual({
      answerLineWords: 2,
      shownLineWords: 2,
    });
  });

  it('also reports the line as the card shows it, after its cut at a clause', () => {
    const long =
      'We cut late deliveries by a third across the northern routes, mostly by rerouting at night';
    expect(callAnswerLine(`${long}\n- A bullet.`, 'headline+bullets', null)).toEqual({
      answerLineWords: 16,
      shownLineWords: 11,
    });
  });

  it('does not apply to other formats, private answers or an empty reply', () => {
    expect(callAnswerLine(words13, 'paragraph', null)).toBeNull();
    expect(callAnswerLine(words13, 'bullets', null)).toBeNull();
    expect(callAnswerLine(words13, 'headline+bullets', { target: 'kite' })).toBeNull();
    expect(callAnswerLine('  \n', 'headline+bullets', null)).toBeNull();
  });
});
