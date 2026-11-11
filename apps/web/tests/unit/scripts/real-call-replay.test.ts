/**
 * Tests for apps/web/scripts/lib/real-call-replay.ts (1.5.2, ADR-0070), the real-call replay's scoring on
 * invented data: percentile() by nearest rank; truthOf() puts a span on the line it overlaps most (with the
 * engine's lag allowed for); expectedFor() takes the newest real question begun before a press, passing over
 * talk about the call; substringErrors() scores a line read from a longer text; readingWer() leaves out short
 * lines and lines inside the other side's speech, and does not count "next question".
 */
import { describe, expect, it } from 'vitest';
import {
  expectedFor,
  percentile,
  readingWer,
  substringErrors,
  truthOf,
  type TruthLine,
} from '../../../scripts/lib/real-call-replay';

const TRUTH: TruthLine[] = [
  { id: 'q1', kind: 'question', start: 10, end: 14 },
  { id: 'm1', kind: 'meta', start: 30, end: 31 },
  { id: 'q2', kind: 'question', start: 40, end: 45 },
];

describe('real-call replay scoring', () => {
  it('takes percentiles by nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it('puts a span on the line it overlaps most', () => {
    expect(truthOf(TRUTH, { start: 10.2, end: 15 })).toBe('q1');
    expect(truthOf(TRUTH, { start: 39.9, end: 45.5 })).toBe('q2');
    expect(truthOf(TRUTH, { start: 20, end: 22 })).toBeNull();
    expect(truthOf(TRUTH, null)).toBeNull();
  });

  it('expects a press to answer the newest real question begun before it', () => {
    expect(expectedFor(TRUTH, 15)).toBe('q1');
    expect(expectedFor(TRUTH, 32)).toBe('q1');
    expect(expectedFor(TRUTH, 42)).toBe('q2');
    expect(expectedFor(TRUTH, 5)).toBeNull();
  });

  it('scores a line read from a longer text against its best stretch', () => {
    const ref = 'yes we built a churn model that hit about seventy percent'.split(' ');
    expect(substringErrors('built a churn model'.split(' '), ref)).toEqual({
      errors: 0,
      refLength: 4,
    });
    expect(substringErrors('built a turn model'.split(' '), ref).errors).toBe(1);
  });

  it('scores reading aloud, leaving out short lines, overlapping lines and "next question"', () => {
    const reference = [
      { text: 'Yes, we built a churn model that hit about seventy percent.', at: 50 },
    ];
    const result = readingWer(
      [
        { text: 'yes we built a churn model next question', start: 52, end: 55 },
        { text: 'too short', start: 56, end: 57 },
        { text: 'yes we built a churn model that hit', start: 41, end: 44 },
      ],
      reference,
      TRUTH,
    );
    expect(result.lines).toBe(1);
    expect(result.wer).toBe(0);
  });
});
