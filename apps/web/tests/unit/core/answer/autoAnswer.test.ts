/**
 * Tests for apps/web/src/core/answer/autoAnswer.ts (Day 6 Stage 4f), on invented lines:
 * isAutoQuestion() is right on at least 90% of 30 labelled examples (written as the speech
 * model writes, in capitals without punctuation, plus a few typed with "?"); autoAnswerDue()
 * waits for the 1.2 s pause, needs a finished "Them" line, fires once per line, never while
 * an answer streams, never when off, at most once per 15 s, and answers a line again only after
 * it grew (merged lines keep their id).
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_MIN_GAP_MS,
  AUTO_PAUSE_MS,
  autoAnswerDue,
  isAutoQuestion,
  type AutoAnswerState,
} from '@/core/answer/autoAnswer';
import type { Utterance } from '@/core/transcript/transcript';

/** 30 invented "Them" lines: [text, should Kite answer it by itself?]. */
const EXAMPLES: readonly [string, boolean][] = [
  ['WHAT DOES THE ANNUAL PLAN COST FOR FORTY SEATS', true],
  ['HOW LONG DOES THE ROLLOUT TAKE', true],
  ['CAN YOU WALK ME THROUGH THE ONBOARDING', true],
  ['DO YOU SUPPORT SINGLE SIGN ON', true],
  ['WHY DID THE LAST DEPLOYMENT FAIL', true],
  ['WHEN CAN YOUR TEAM START', true],
  ['WHO WOULD BE OUR MAIN CONTACT', true],
  ['IS THERE A DISCOUNT FOR TWO YEARS', true],
  ['COULD YOU EXPLAIN HOW THE PRICING WORKS', true],
  ['TELL ME ABOUT A TIME YOU LED A PROJECT', true],
  ['WHICH REGIONS DO YOU HOST DATA IN', true],
  ['ARE THERE ANY LIMITS ON USERS', true],
  ['WHAT IS RETRIEVAL AUGMENTED GENERATION', true],
  ['HOW WOULD YOU REDUCE LATENCY IN THE API', true],
  ['So the price includes support?', true],
  ['And that works offline too?', true],
  ['WALK ME THROUGH YOUR LAST ROLE', true],
  ['DESCRIBE HOW YOU WOULD TEST THIS', true],
  ['SHOULD WE START WITH THE PILOT', true],
  ['HAVE YOU WORKED WITH VECTOR DATABASES', true],
  ['OKAY THAT SOUNDS GOOD', false],
  ['WE RAN THE PILOT IN LAHORE LAST MONTH', false],
  ['I KNOW WHAT YOU MEAN', false],
  ['THANKS FOR SENDING THE DECK', false],
  ['LET ME SHARE MY SCREEN', false],
  ['SORRY', false],
  ['WHAT', false],
  ['RIGHT RIGHT', false],
  ['THE TEAM LIKED HOW FAST IT WAS', false],
  ['OUR BUDGET IS AROUND TEN THOUSAND', false],
];

/**
 * A transcript line (times in Unix ms).
 *
 * @param id      Line id.
 * @param speaker Who spoke.
 * @param text    The words, as the engine writes them.
 * @param tEnd    When it ended.
 * @param final   False for a grey line still being heard.
 * @returns The line.
 */
const line = (id: string, speaker: 'you' | 'them', text: string, tEnd: number, final = true) =>
  ({ id, speaker, text, tStart: tEnd - 2_000, tEnd, final }) as Utterance;

/**
 * A state with auto-answer on, nothing streaming, and the given lines.
 *
 * @param lines The lines.
 * @param extra Fields to override.
 * @returns The state.
 */
const state = (lines: Utterance[], extra: Partial<AutoAnswerState> = {}): AutoAnswerState => ({
  enabled: true,
  streaming: false,
  lines,
  lastAutoAt: null,
  lastAutoLineEnd: null,
  ...extra,
});

const T = 1_700_000_000_000;
const QUESTION = 'WHAT DOES THE ANNUAL PLAN COST';

describe('isAutoQuestion', () => {
  it('is right on at least 90% of the 30 invented examples', () => {
    const wrong = EXAMPLES.filter(([text, expected]) => isAutoQuestion(text) !== expected);
    expect(EXAMPLES).toHaveLength(30);
    expect((EXAMPLES.length - wrong.length) / EXAMPLES.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('autoAnswerDue', () => {
  it('waits for the pause after a finished "Them" question', () => {
    const lines = [line('a', 'them', QUESTION, T)];
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS - 1)).toBeNull();
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS)).toEqual({ id: 'a', tEnd: T });
  });

  it('does nothing while the line is still grey, after the user spoke, or for a statement', () => {
    const later = T + 5_000;
    expect(autoAnswerDue(state([line('a', 'them', QUESTION, T, false)]), later)).toBeNull();
    expect(
      autoAnswerDue(
        state([line('a', 'them', QUESTION, T), line('b', 'you', 'SURE', T + 500)]),
        later,
      ),
    ).toBeNull();
    expect(autoAnswerDue(state([line('a', 'them', 'OKAY THAT SOUNDS GOOD', T)]), later)).toBeNull();
  });

  it('never fires when off, while streaming, or twice for the same line', () => {
    const lines = [line('a', 'them', QUESTION, T)];
    const later = T + 5_000;
    expect(autoAnswerDue(state(lines, { enabled: false }), later)).toBeNull();
    expect(autoAnswerDue(state(lines, { streaming: true }), later)).toBeNull();
    expect(
      autoAnswerDue(state(lines, { lastAutoLineEnd: T, lastAutoAt: T - 60_000 }), later),
    ).toBeNull();
  });

  it('fires at most once per 15 s', () => {
    const lines = [line('b', 'them', 'HOW LONG DOES THE ROLLOUT TAKE', T + 3_000)];
    const first = T;
    expect(
      autoAnswerDue(
        state(lines, { lastAutoAt: first, lastAutoLineEnd: T - 10_000 }),
        first + AUTO_MIN_GAP_MS - 1,
      ),
    ).toBeNull();
    expect(
      autoAnswerDue(
        state(lines, { lastAutoAt: first, lastAutoLineEnd: T - 10_000 }),
        first + AUTO_MIN_GAP_MS,
      ),
    ).toEqual({ id: 'b', tEnd: T + 3_000 });
  });

  it('answers a line that grew under the same id after the last auto-answer', () => {
    const grown = [
      line('a', 'them', 'WHAT DOES IT COST HOW LONG DOES THE ROLLOUT TAKE', T + 20_000),
    ];
    expect(autoAnswerDue(state(grown, { lastAutoAt: T, lastAutoLineEnd: T }), T + 22_000)).toEqual({
      id: 'a',
      tEnd: T + 20_000,
    });
  });
});
