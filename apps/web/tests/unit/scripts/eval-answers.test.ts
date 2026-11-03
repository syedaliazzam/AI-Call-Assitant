/**
 * Tests for shapeChecks() in apps/web/scripts/eval-answers.ts, the two rubric checks made in
 * code: headline+bullets answers need a headline of at most 15 words and at most 5 bullets;
 * paragraph answers need no bullets and one paragraph. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { answerAgreement, hasMetaComment, shapeChecks } from '../../../scripts/eval-answers';

describe('shapeChecks', () => {
  it('checks the headline length and the number of bullets', () => {
    expect(
      shapeChecks('**Forty seats cost 2,080 dollars a month.**\n- 52 per seat', 'headline+bullets'),
    ).toEqual({
      headline: 1,
      bullets: 1,
    });
    const long =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    const six = ['- a', '- b', '- c', '- d', '- e', '- f'].join('\n');
    expect(shapeChecks(`${long}\n${six}`, 'headline+bullets')).toEqual({ headline: 0, bullets: 0 });
  });

  it('checks a paragraph answer has no bullets and one paragraph', () => {
    expect(shapeChecks('The pilot cut late deliveries by a third.', 'paragraph')).toEqual({
      headline: 1,
      bullets: 1,
    });
    expect(shapeChecks('First.\n\n- a bullet', 'paragraph')).toEqual({ headline: 0, bullets: 0 });
  });
});

describe('shapeChecks with the hidden line (ADR-0030)', () => {
  it('leaves a private answer free in shape', () => {
    const long = Array.from({ length: 30 }, () => 'word').join(' ');
    expect(shapeChecks(long, 'headline+bullets', { type: 'concept', target: 'kite' })).toEqual({
      headline: 1,
      bullets: 1,
    });
  });

  it('wants code, and allows more bullets, in a coding answer', () => {
    const bullets = Array.from({ length: 7 }, (_, i) => `- step ${i}`).join('\n');
    const meta = { type: 'coding', target: 'call' } as const;
    expect(shapeChecks(`Approach\n${bullets}`, 'paragraph', meta).bullets).toBe(0);
    expect(shapeChecks(`Approach\n${bullets}\n\`\`\`py\nx\n\`\`\``, 'paragraph', meta)).toEqual({
      headline: 1,
      bullets: 1,
    });
  });
});

describe('hasMetaComment', () => {
  it('finds a comment on what Kite was given', () => {
    expect(hasMetaComment('That is not in your notes.')).toBe(true);
    expect(hasMetaComment('It is not mentioned in the CV.')).toBe(true);
    expect(hasMetaComment("The CV doesn't record an outage.")).toBe(true);
    expect(hasMetaComment('From what I have here, no.')).toBe(true);
  });

  it('allows a private note to name what to check, and ordinary speech', () => {
    expect(hasMetaComment('I will confirm that.\nNote: not in your notes, check it.')).toBe(false);
    expect(hasMetaComment('I built that at Lantern Freight.')).toBe(false);
  });
});

describe('answerAgreement', () => {
  it('compares numbers and words', () => {
    expect(answerAgreement('It is 1,500 dollars.', 'It is 1500 dollars.').numbers).toBe(true);
    expect(answerAgreement('It is 1,500 dollars.', 'It is 1,800 dollars.').numbers).toBe(false);
    expect(answerAgreement('same words', 'same words').words).toBe(1);
  });
});
