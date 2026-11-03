/**
 * Tests apps/web/src/core/answer/similar.ts: finding an earlier answer to a similar question, by the
 * questions' meaningful words. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { findSimilarAnswer, questionOverlap, questionWords } from '@/core/answer/similar';

/** Two earlier answers. */
const ANSWERS = [
  { id: 'a', question: 'What does onboarding cost?', text: '1,500 dollars.' },
  { id: 'b', question: 'How long does the training take?', text: 'Two days.' },
];

describe('questionWords', () => {
  it('keeps meaningful words, lower case, without a final s', () => {
    expect([...questionWords('Sorry, remind me what onboarding costs again?')]).toEqual([
      'onboarding',
      'cost',
    ]);
  });
});

describe('questionOverlap', () => {
  it('is 0 when either side is empty', () => {
    expect(questionOverlap(new Set(), new Set(['a']))).toBe(0);
  });
  it('is 1 for the same words', () => {
    expect(questionOverlap(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(1);
  });
});

describe('findSimilarAnswer', () => {
  it('finds the same question asked another way', () => {
    expect(findSimilarAnswer('Sorry, remind me what onboarding costs again?', ANSWERS)?.id).toBe(
      'a',
    );
  });
  it('finds nothing for a different question', () => {
    expect(findSimilarAnswer('Do you support single sign-on?', ANSWERS)).toBeNull();
  });
  it('prefers the latest of two equal matches, so a correction is what gets reused', () => {
    const answers = [
      ...ANSWERS,
      { id: 'c', question: 'What does onboarding cost?', text: '1,800.' },
    ];
    expect(findSimilarAnswer('What does onboarding cost?', answers)?.id).toBe('c');
  });
  it('skips an answer with no text', () => {
    expect(
      findSimilarAnswer('What does onboarding cost?', [
        { question: 'What does onboarding cost?', text: ' ' },
      ]),
    ).toBeNull();
  });
});
