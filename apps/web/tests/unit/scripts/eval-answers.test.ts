/**
 * Tests for shapeChecks() in apps/web/scripts/eval-answers.ts, the two rubric checks made in
 * code: headline+bullets answers need a headline of at most 15 words and at most 5 bullets;
 * paragraph answers need no bullets and one paragraph. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { shapeChecks } from '../../../scripts/eval-answers';

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
