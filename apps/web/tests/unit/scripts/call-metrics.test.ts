/**
 * Tests for apps/web/scripts/lib/call-metrics.ts (v1.4, ADR-0063) on a tiny invented call: words heard on
 * the wrong channel lower the right-channel share and count a line from the other side; hidden lines are
 * not scored; a one-word noise line counts as a fragment and a real "okay" does not; a question shown in
 * two lines or turns counts as split; answers are scored as whole, duplicate or for a non-question, with
 * the delay from the question's end; another language is counted caught or wrongly marked.
 */
import { describe, expect, it } from 'vitest';
import {
  computeCallMetrics,
  exactLcs,
  percentileOf,
  type MeasuredLine,
  type TimedScriptLine,
} from '../../../scripts/lib/call-metrics';

/**
 * A script line with times.
 *
 * @param id      Its id.
 * @param speaker Who.
 * @param text    Words.
 * @param start   Start (ms).
 * @param end     End (ms).
 * @param extra   Role and question.
 * @returns The line.
 */
const ref = (
  id: string,
  speaker: 'you' | 'them',
  text: string,
  start: number,
  end: number,
  extra: Partial<TimedScriptLine> = {},
): TimedScriptLine => ({
  id,
  speaker,
  text,
  role: 'answer',
  start,
  end,
  startMs: start,
  endMs: end,
  ...extra,
});

/**
 * A transcript line.
 *
 * @param id      Its id.
 * @param speaker Who.
 * @param text    Words.
 * @param tStart  Start.
 * @param tEnd    End.
 * @param extra   Hidden or another language.
 * @returns The line.
 */
const line = (
  id: string,
  speaker: 'you' | 'them',
  text: string,
  tStart: number,
  tEnd: number,
  extra: Partial<MeasuredLine> = {},
): MeasuredLine => ({
  id,
  speaker,
  text,
  tStart,
  tEnd,
  hidden: false,
  nonEnglish: false,
  ...extra,
});

const SCRIPT = [
  ref('t1', 'them', 'How big is the team', 0, 2_000, { role: 'question', question: 'q1' }),
  ref('t2', 'them', 'and who do you report to', 4_000, 6_000, { role: 'question', question: 'q1' }),
  ref('y1', 'you', 'Okay', 2_500, 2_800, { role: 'backchannel' }),
  ref('y2', 'you', 'The team is twelve people', 8_000, 10_000),
  ref('t3', 'them', 'Can you hear me', 12_000, 13_000, { role: 'meta' }),
  ref('t4', 'them', 'mera naam hai', 15_000, 17_000, { role: 'other-language' }),
];
const QUESTIONS = [{ id: 'q1', lineIds: ['t1', 't2'] }];

describe('call-metrics', () => {
  it('helpers: exact LCS and percentiles', () => {
    expect(exactLcs(['a', 'b', 'c'], ['a', 'c'])).toBe(2);
    expect(percentileOf([1, 2, 3, 4], 50)).toBe(2);
    expect(Number.isNaN(percentileOf([], 50))).toBe(true);
  });

  it('scores attribution, noise, splits, answers and another language', () => {
    const metrics = computeCallMetrics({
      script: SCRIPT,
      questions: QUESTIONS,
      lines: [
        line('l1', 'them', 'HOW BIG IS THE TEAM', 0, 2_000),
        line('l2', 'you', 'OKAY', 2_500, 2_800),
        line('l3', 'them', 'AND WHO DO YOU REPORT TO', 4_000, 6_000),
        line('l4', 'you', 'WHO DO YOU REPORT TO', 4_100, 6_100), // the other side, through the speakers
        line('l5', 'you', 'THE TEAM IS TWELVE PEOPLE', 8_000, 10_000),
        line('l6', 'you', 'A', 11_000, 11_100), // noise
        line('l7', 'you', 'THE TEAM IS TWELVE', 8_000, 10_000, { hidden: true }),
        line('l8', 'them', '[non-English speech]', 15_000, 17_000, { nonEnglish: true }),
        line('l9', 'them', '[non-English speech]', 20_000, 21_000, { nonEnglish: true }),
      ],
      turns: [
        { start: 0, end: 2_000 },
        { start: 4_000, end: 6_000 },
      ],
      answers: [
        { id: 'a1', sentAt: 7_300, lineIds: ['l1', 'l3'], reruns: 1 },
        { id: 'a2', sentAt: 7_500, lineIds: ['l3'], reruns: 0 },
        { id: 'a3', sentAt: 14_000, lineIds: ['l9'], reruns: 0 },
      ],
      totalMs: 600_000,
    });
    expect(metrics.crossLines).toEqual({ you: 1, them: 0 });
    expect(metrics.rightChannel.you).toBeLessThan(1);
    expect(metrics.rightChannel.them).toBe(1);
    expect(metrics.fragmentsPer10Min).toBeCloseTo(1);
    expect(metrics.splitLines).toEqual({ count: 1, of: 1 });
    expect(metrics.splitTurns).toEqual({ count: 1, of: 1 });
    expect(metrics.answered).toEqual({ count: 1, of: 1 });
    expect(metrics.whole).toEqual({ count: 1, of: 1 });
    expect(metrics.duplicates).toBe(1);
    expect(metrics.nonQuestionAnswers).toBe(1);
    expect(metrics.sendDelayMs.p50).toBe(1_300);
    expect(metrics.otherLanguage).toEqual({ caught: 1, of: 1 });
    expect(metrics.falseOtherLanguage).toBe(1);
  });
});
