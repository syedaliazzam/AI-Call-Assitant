/**
 * Tests: sourceLineOf() in apps/web/src/features/live/useLiveAnswers.ts (v1.3.2). An answer to speech
 * records the line its question ended on, so Review and the downloads put it after that turn: the
 * latest of the lines the question was picked from, or for "Answer this" the latest line of the other
 * person inside the bubble's span; none for a question with no lines. Invented data only.
 */
import { describe, expect, it } from 'vitest';
import { sourceLineOf } from '@/features/live/useLiveAnswers';

/** The call's invented lines (ids as the live transcript gives them). */
const LINES = [
  { id: 'u1', speaker: 'them', tStart: 1_000, tEnd: 2_000 },
  { id: 'u2', speaker: 'you', tStart: 3_000, tEnd: 4_000 },
  { id: 'u3', speaker: 'them', tStart: 5_000, tEnd: 6_000 },
  { id: 'u4', speaker: 'them', tStart: 6_500, tEnd: 8_000 },
];

describe('sourceLineOf', () => {
  it('takes the latest of the lines the question was picked from', () => {
    expect(sourceLineOf(LINES, ['u4', 'u3'])).toBe('u4');
    expect(sourceLineOf(LINES, ['u1'])).toBe('u1');
  });

  it("takes the other person's latest line inside an Answer this span", () => {
    expect(sourceLineOf(LINES, null, { start: 5_000, end: 8_000 })).toBe('u4');
    // "You" lines in the span are not the question.
    expect(sourceLineOf(LINES, [], { start: 2_500, end: 4_500 })).toBeUndefined();
  });

  it('knows none when nothing was picked', () => {
    expect(sourceLineOf(LINES, undefined)).toBeUndefined();
    expect(sourceLineOf([], ['u1'])).toBeUndefined();
  });
});
