/**
 * Tests for apps/web/src/core/answer/history.ts (v1.0.4, ADR-0040; v1.1.0): one entry per question.
 * The same or near-identical words (at least 80% shared, the same topic) merge within 60 s of the same
 * call, and never across calls; the newest good answer is the one shown; a failure, a screenshot or an
 * empty question is never merged; the winner of each merged answer can be looked up. All text is
 * invented.
 */
import { describe, expect, it } from 'vitest';
import {
  mergeAnswers,
  nearQuestion,
  NEAR_WINDOW_MS,
  sameQuestion,
  stoppedEmpty,
  type HistoryAnswer,
} from '@/core/answer/history';

/** An invented answer asked at a time. */
type Row = HistoryAnswer & {
  /** When it was asked (ms). */
  at: number;
};

/**
 * Makes an invented answer.
 *
 * @param id       Its id.
 * @param at       When it was asked (ms).
 * @param question Its raw question.
 * @param fields   Anything else to set.
 * @returns The answer.
 */
function row(id: string, at: number, question: string, fields: Partial<Row> = {}): Row {
  return { id, at, mode: 'answer', question, text: `Answer ${id}.`, status: 'done', ...fields };
}

/**
 * The ids left after merging.
 *
 * @param answers The answers, oldest first.
 * @returns The ids shown.
 */
const shownIds = (answers: readonly Row[]) =>
  mergeAnswers(answers, (answer) => answer.at).list.map((answer) => answer.id);

describe('sameQuestion and nearQuestion', () => {
  it('sees the same words through case, punctuation and hesitation sounds', () => {
    expect(
      sameQuestion(
        'UM WHAT PRODUCTION GRADE APPLICATIONS HAVE YOU UH BUILT',
        'What production-grade applications have you built?',
      ),
    ).toBe(true);
    expect(sameQuestion('What is it?', 'What was it?')).toBe(false);
    expect(sameQuestion('', '')).toBe(false);
  });

  it('near-identical needs at least 80% of the longer one’s words', () => {
    expect(nearQuestion('How would you design a voice', 'How would you design a voice agent')).toBe(
      true,
    );
    expect(
      nearQuestion(
        'What production apps have you built',
        'What production grade apps have you built',
      ),
    ).toBe(true);
    expect(nearQuestion('How would you design a voice agent', 'How would you test it')).toBe(false);
  });

  it('keeps one-word differences apart when the word is what the question is about', () => {
    expect(
      nearQuestion('What is your experience with Python', 'What is your experience with Java'),
    ).toBe(false);
  });
});

describe('mergeAnswers', () => {
  it('merges the same question within a minute, and shows the newest answer', () => {
    const merged = mergeAnswers(
      [
        row('a', 0, 'TELL ME ABOUT YOURSELF', { cleanQuestion: 'Tell me about yourself.' }),
        row('b', 5_000, 'What does it cost?'),
        row('c', 40_000, 'Tell me about yourself?'),
      ],
      (answer) => answer.at,
    );
    expect(merged.list.map((answer) => answer.id)).toEqual(['b', 'c']);
    expect(merged.winnerOf.get('a')).toBe('c');
    expect(merged.winnerOf.has('b')).toBe(false);
  });

  it('keeps the same question apart when it is asked again later in the call', () => {
    expect(
      shownIds([
        row('a', 0, 'Tell me about yourself?'),
        row('b', 10 * 60_000, 'Tell me about yourself?'),
      ]),
    ).toEqual(['a', 'b']);
  });

  it('never merges across calls, however close in time (v1.0.4 merged them)', () => {
    expect(
      shownIds([
        row('a', 0, 'Tell me about yourself?', { callStartedAt: 1_000 }),
        row('b', 30_000, 'Tell me about yourself?', { callStartedAt: 2_000 }),
      ]),
    ).toEqual(['a', 'b']);
    expect(
      shownIds([
        row('a', 0, 'Tell me about yourself?', { callStartedAt: 1_000 }),
        row('b', 30_000, 'Tell me about yourself?', { callStartedAt: 1_000 }),
      ]),
    ).toEqual(['b']);
  });

  it('merges near-identical questions only within 60 s', () => {
    const question = 'How would you design a voice';
    const longer = 'How would you design a voice agent';
    expect(shownIds([row('a', 0, question), row('b', NEAR_WINDOW_MS, longer)])).toEqual(['b']);
    expect(shownIds([row('a', 0, question), row('b', NEAR_WINDOW_MS + 1, longer)])).toEqual([
      'a',
      'b',
    ]);
  });

  it('compares the cleaned question too, so different raw words can still merge', () => {
    expect(
      shownIds([
        row('a', 0, 'SO UM YEAH WHAT DOES THE PLAN COST', {
          cleanQuestion: 'What does the plan cost?',
        }),
        row('b', 1_000, 'AND THE PLAN HOW MUCH IS IT', {
          cleanQuestion: 'What does the plan cost?',
        }),
      ]),
    ).toEqual(['b']);
  });

  it('shows a new answer while it streams, even before its first word', () => {
    expect(
      shownIds([
        row('a', 0, 'What does it cost?'),
        row('b', 1_000, 'What does it cost?', { status: 'streaming', text: '' }),
      ]),
    ).toEqual(['b']);
  });

  it('prefers a finished answer to one stopped later', () => {
    expect(
      shownIds([
        row('a', 0, 'What does it cost?'),
        row('b', 1_000, 'What does it cost?', { status: 'cancelled', text: '' }),
        row('c', 2_000, 'What does it cost?', { status: 'cancelled', text: 'Part of an' }),
      ]),
    ).toEqual(['a']);
  });

  it('keeps a stopped answer when it is all there is', () => {
    const stopped = row('a', 0, 'What does it cost?', { status: 'cancelled', text: '' });
    expect(stoppedEmpty(stopped)).toBe(true);
    expect(shownIds([stopped])).toEqual(['a']);
  });

  it('never merges a failure, so it stays visible', () => {
    expect(
      shownIds([
        row('a', 0, 'What does it cost?'),
        row('b', 1_000, 'What does it cost?', { status: 'error', text: '' }),
      ]),
    ).toEqual(['a', 'b']);
  });

  it('never merges screenshots: each shows a different screen', () => {
    const shot = { mode: 'screenshot', cleanQuestion: 'What is on screen?' };
    expect(
      shownIds([row('a', 0, 'What is on screen?', shot), row('b', 1, 'What is on screen?', shot)]),
    ).toEqual(['a', 'b']);
  });

  it('never merges answers with no question', () => {
    expect(shownIds([row('a', 0, ''), row('b', 1, '')])).toEqual(['a', 'b']);
  });

  it('accepts saved answers, which have no status', () => {
    const { status: _a, ...first } = row('a', 0, 'What does it cost?');
    const { status: _b, ...second } = row('b', 1_000, 'What does it cost?');
    expect(shownIds([first, second])).toEqual(['b']);
  });
});
