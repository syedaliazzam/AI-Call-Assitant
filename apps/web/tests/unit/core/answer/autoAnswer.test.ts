/**
 * Tests for apps/web/src/core/answer/autoAnswer.ts (Day 6 Stage 4f; reworked in v1.4, ADR-0062), on
 * invented lines: isAutoQuestion() is right on at least 90% of 30 labelled examples (written as the
 * speech model writes, in capitals without punctuation, plus a few typed with "?") and never answers talk
 * about the call; autoAnswerDue() answers the whole question window, waits 1.2 s after a line that sounds
 * finished and 3.0 s after one that sounds cut off, waits up to 1.5 s more for the accurate engine, is
 * not stopped by the user's blips but is by a real reply, never fires while someone is speaking, when off,
 * while streaming, or for lines already answered, ignores another language, and asks again on the same
 * card when the other person goes on within 4 s (a rerun); continuationOf() finds those words.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCURATE_WAIT_MS,
  AUTO_MAX_AGE_MS,
  AUTO_PAUSE_MS,
  autoAnswerDue,
  continuationOf,
  isAutoQuestion,
  questionWindow,
  RERUN_WINDOW_MS,
  UNFINISHED_PAUSE_MS,
  type AnsweredQuestion,
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
 * @param extra   Other fields (final: false for a grey line; refining; nonEnglish; tStart).
 * @returns The line.
 */
const line = (
  id: string,
  speaker: 'you' | 'them',
  text: string,
  tEnd: number,
  extra: Partial<Utterance> = {},
): Utterance => ({ id, speaker, text, tStart: tEnd - 2_000, tEnd, final: true, ...extra });

/**
 * A state with auto-answer on, nothing streaming, nothing answered, and the given lines.
 *
 * @param lines The lines.
 * @param extra Fields to override.
 * @returns The state.
 */
const state = (lines: Utterance[], extra: Partial<AutoAnswerState> = {}): AutoAnswerState => ({
  enabled: true,
  streaming: false,
  lines,
  answeredLineIds: new Set(),
  last: null,
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

  it('never answers talk about the call (v1.4)', () => {
    for (const text of [
      'SORRY CAN YOU REPEAT THAT',
      'CAN YOU HEAR ME OKAY I THINK MY CONNECTION DROPPED FOR A SECOND',
      'CAN YOU GUYS HEAR ME',
      'IS MY AUDIO OKAY',
      'Could you repeat the question?',
      'YOU ARE BREAKING UP',
      'CAN YOU SEE MY SCREEN',
    ]) {
      expect(isAutoQuestion(text)).toBe(false);
    }
  });

  it('answers a request worded as a statement (v1.4)', () => {
    expect(isAutoQuestion("I'D LIKE TO HEAR ABOUT YOUR KUBERNETES WORK")).toBe(true);
  });
});

describe('autoAnswerDue: when', () => {
  it('waits 1.2 s after a question that sounds finished', () => {
    const lines = [line('a', 'them', QUESTION, T)];
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS - 1)).toBeNull();
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS)).toEqual({
      kind: 'answer',
      lineIds: ['a'],
      tEnd: T,
    });
  });

  it('waits 3.0 s after a line that sounds cut off (a thinking pause)', () => {
    const lines = [line('a', 'them', 'COULD YOU WALK ME THROUGH THE SYSTEM YOU BUILT AND', T)];
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS + 500)).toBeNull();
    expect(autoAnswerDue(state(lines), T + UNFINISHED_PAUSE_MS - 1)).toBeNull();
    expect(autoAnswerDue(state(lines), T + UNFINISHED_PAUSE_MS)?.kind).toBe('answer');
  });

  it('waits up to 1.5 s more while the accurate engine rewrites a line', () => {
    const lines = [line('a', 'them', QUESTION, T, { refining: true })];
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS)).toBeNull();
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS + ACCURATE_WAIT_MS)?.kind).toBe('answer');
    // Done earlier: no wait beyond the pause.
    expect(autoAnswerDue(state([line('a', 'them', QUESTION, T)]), T + AUTO_PAUSE_MS)?.kind).toBe(
      'answer',
    );
  });
});

describe('autoAnswerDue: what', () => {
  it('answers the whole window: every unanswered "Them" line since the user really spoke', () => {
    const lines = [
      line('o', 'them', 'HOW DID YOU TEST IT', T - 20_000),
      line('y', 'you', 'WE USED CONTRACT TESTS FOR EVERY SERVICE', T - 15_000),
      line('a', 'them', 'COULD YOU WALK ME THROUGH THE SYSTEM', T - 4_000),
      line('b', 'you', 'UM', T - 3_000),
      line('c', 'them', 'AND WHAT YOU WOULD CHANGE TODAY', T),
    ];
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS)).toEqual({
      kind: 'answer',
      lineIds: ['a', 'c'],
      tEnd: T,
    });
    expect(questionWindow(lines, new Set(['a'])).map((item) => item.id)).toEqual(['c']);
  });

  it('leaves the other side\'s own "mm-hm" out of their next question', () => {
    const lines = [
      line('y', 'you', 'WE MOVED THE EXPORT TO A QUEUE', T - 8_000),
      line('m', 'them', 'MM HM', T - 6_000),
      line('a', 'them', QUESTION, T),
    ];
    expect(autoAnswerDue(state(lines), T + AUTO_PAUSE_MS)).toMatchObject({ lineIds: ['a'] });
  });

  it('is not stopped by a blip after the question, but is by a real reply', () => {
    const later = T + 5_000;
    expect(
      autoAnswerDue(
        state([line('a', 'them', QUESTION, T), line('b', 'you', 'OKAY', T + 500)]),
        later,
      )?.kind,
    ).toBe('answer');
    expect(
      autoAnswerDue(
        state([
          line('a', 'them', QUESTION, T),
          line('b', 'you', 'IT COSTS ABOUT FORTY A SEAT', T + 900),
        ]),
        later,
      ),
    ).toBeNull();
  });

  it('waits while the other person is still speaking, not while the user is; never for a remark', () => {
    const later = T + 4_000;
    expect(
      autoAnswerDue(state([line('a', 'them', QUESTION, T, { final: false })]), later),
    ).toBeNull();
    // The user's grey words do not wait (ADR-0063: people start talking right after a question).
    expect(
      autoAnswerDue(
        state([
          line('a', 'them', QUESTION, T),
          line('b', 'you', 'SO WE STARTED WITH', T + 900, { final: false }),
        ]),
        later,
      )?.kind,
    ).toBe('answer');
    expect(autoAnswerDue(state([line('a', 'them', 'OKAY THAT SOUNDS GOOD', T)]), later)).toBeNull();
  });

  it('never fires when off, while streaming, for answered lines, or for another language', () => {
    const lines = [line('a', 'them', QUESTION, T)];
    const later = T + 5_000;
    expect(autoAnswerDue(state(lines, { enabled: false }), later)).toBeNull();
    expect(autoAnswerDue(state(lines, { streaming: true }), later)).toBeNull();
    expect(autoAnswerDue(state(lines, { answeredLineIds: new Set(['a']) }), later)).toBeNull();
    expect(
      autoAnswerDue(
        state([line('n', 'them', '[non-English speech]', T, { nonEnglish: true })]),
        later,
      ),
    ).toBeNull();
  });

  it('ignores a grey line unchanged for 5 s, and never answers a question older than 10 s', () => {
    const stuck = line('p', 'you', 'LET ME CHECK THE PRICE LIST', T - 6_000, { final: false });
    expect(
      autoAnswerDue(state([stuck, line('a', 'them', QUESTION, T)]), T + AUTO_PAUSE_MS)?.kind,
    ).toBe('answer');
    expect(
      autoAnswerDue(state([line('a', 'them', QUESTION, T)]), T + AUTO_MAX_AGE_MS + 1),
    ).toBeNull();
  });
});

describe('autoAnswerDue: rerun', () => {
  /** An auto-answer for line 'a' (ended at T), asked 1.2 s later. */
  const last: AnsweredQuestion = {
    answerId: 'answer-1',
    lineIds: ['a'],
    end: T,
    askedAt: T + AUTO_PAUSE_MS,
    auto: true,
  };
  const answered = { answeredLineIds: new Set(['a']), last };

  it('asks again with the whole question when they go on within 4 s, even while streaming', () => {
    const lines = [
      line('a', 'them', 'HOW BIG IS THE TEAM', T),
      line('b', 'them', 'AND WHAT DOES YOUR ON CALL ROTATION LOOK LIKE', T + 5_000, {
        tStart: T + 2_500,
      }),
    ];
    expect(
      autoAnswerDue(state(lines, { ...answered, streaming: true }), T + 5_000 + AUTO_PAUSE_MS),
    ).toEqual({
      kind: 'rerun',
      replaces: 'answer-1',
      lineIds: ['a', 'b'],
      tEnd: T + 5_000,
    });
  });

  it('also when the answered line itself grew (lines that follow each other merge under one id)', () => {
    const lines = [
      line('a', 'them', 'HOW BIG IS THE TEAM AND WHO IS YOUR MANAGER', T + 4_000, {
        tStart: T - 3_000,
      }),
    ];
    expect(autoAnswerDue(state(lines, answered), T + 4_000 + AUTO_PAUSE_MS)?.kind).toBe('rerun');
  });

  it('not after the user replied, not for new words starting after 4 s, nor for a manual answer', () => {
    const reply = [
      line('a', 'them', 'HOW BIG IS THE TEAM', T),
      line('y', 'you', 'ABOUT TWELVE PEOPLE IN TWO SQUADS', T + 2_000),
      line('b', 'them', 'AND WHO DO YOU REPORT TO', T + 4_000, { tStart: T + 2_500 }),
    ];
    expect(autoAnswerDue(state(reply, answered), T + 9_000)?.kind).not.toBe('rerun');
    const late = [
      line('a', 'them', 'HOW BIG IS THE TEAM', T),
      line('b', 'them', 'WHO DO YOU REPORT TO', T + 9_000, {
        tStart: T + AUTO_PAUSE_MS + RERUN_WINDOW_MS + 1,
      }),
    ];
    expect(autoAnswerDue(state(late, answered), T + 12_000)).toEqual({
      kind: 'answer',
      lineIds: ['b'],
      tEnd: T + 9_000,
    });
    const manual = { ...answered, last: { ...last, auto: false } };
    expect(
      autoAnswerDue(
        state(
          reply.filter((item) => item.id !== 'y'),
          manual,
        ),
        T + 9_000,
      )?.kind,
    ).toBe('answer');
  });
});

describe('continuationOf', () => {
  const last: AnsweredQuestion = {
    answerId: 'x',
    lineIds: ['a'],
    end: T,
    askedAt: T + 1_000,
    auto: false,
  };

  it('finds the plain words that go on after the answered question, within the window', () => {
    const lines = [
      line('a', 'them', 'WHAT DOES THE PLAN COST', T),
      line('b', 'them', 'FOR FORTY SEATS', T + 3_000, { tStart: T + 1_500 }),
    ];
    expect(continuationOf(lines, last, 8_000, T).map((item) => item.id)).toEqual(['b']);
    expect(continuationOf(lines, last, 1_000, T)).toEqual([]);
  });

  it('ignores the other person listening ("mm-hm") and stops while the user is answering', () => {
    const lines = [
      line('a', 'them', 'WHAT DOES THE PLAN COST', T),
      line('y', 'you', 'SO THE PLAN COSTS FORTY', T + 3_000, { final: false }),
      line('b', 'them', 'MM HM', T + 2_500, { tStart: T + 2_000 }),
    ];
    expect(continuationOf(lines, last, 8_000, T)).toEqual([]);
    expect(continuationOf([lines[0]!, lines[2]!], last, 8_000, T)).toEqual([]);
  });

  it('stops at a real reply and at talk about the call', () => {
    const reply = [
      line('a', 'them', 'WHAT DOES THE PLAN COST', T),
      line('y', 'you', 'IT IS FORTY A SEAT', T + 2_000),
      line('b', 'them', 'FOR FORTY SEATS', T + 4_000),
    ];
    expect(continuationOf(reply, last, 8_000, T)).toEqual([]);
    const meta = [
      line('a', 'them', 'WHAT DOES THE PLAN COST', T),
      line('b', 'them', 'CAN YOU HEAR ME', T + 3_000, { tStart: T + 1_500 }),
    ];
    expect(continuationOf(meta, last, 8_000, T)).toEqual([]);
  });
});
