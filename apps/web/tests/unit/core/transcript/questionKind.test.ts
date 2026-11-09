/**
 * Tests for apps/web/src/core/transcript/questionKind.ts (v1.1.0, ADR-0043): a table of invented lines,
 * in the recogniser's style and with punctuation, each with the kind it must get; garbled words; and
 * pickQuestion(), which skips greetings and instructions to the last real question and reports garbled
 * words or nothing to answer. The worse mistake is refusing a real question, so the table leans there.
 */
import { describe, expect, it } from 'vitest';
import {
  isSkippedLine,
  lineKind,
  looksGarbled,
  pickQuestion,
  type LineKind,
} from '@/core/transcript/questionKind';
import type { Utterance } from '@/core/transcript/transcript';

/** Lines and what they are. */
const TABLE: ReadonlyArray<readonly [string, LineKind]> = [
  // Greetings and small talk.
  ['HI', 'greeting'],
  ['Hello!', 'greeting'],
  ['HEY THERE', 'greeting'],
  ['GOOD MORNING', 'greeting'],
  ['Good afternoon, Priya.', 'greeting'],
  ['NICE TO MEET YOU', 'greeting'],
  ['THANKS FOR JOINING', 'greeting'],
  ['THANK YOU SO MUCH', 'greeting'],
  ['HOW ARE YOU', 'greeting'],
  ['How are you doing today?', 'greeting'],
  ["HOW'S IT GOING", 'greeting'],
  ['HOW IS YOUR DAY GOING', 'greeting'],
  ['CAN YOU HEAR ME', 'meta'],
  ['Can you hear me okay?', 'meta'],
  ['CAN YOU SEE ME', 'meta'],
  ['ARE YOU THERE', 'greeting'],
  ['BYE', 'greeting'],
  ['TAKE CARE', 'greeting'],
  ['HAVE A GREAT WEEKEND', 'greeting'],
  // Instructions.
  ['SAY YES WHEN READY', 'instruction'],
  ['Say yes when you are ready.', 'instruction'],
  ['LET ME KNOW WHEN YOU ARE READY', 'instruction'],
  ['ARE YOU READY TO BEGIN', 'instruction'],
  ['SHALL WE GET STARTED', 'instruction'],
  ['PLEASE SHARE YOUR SCREEN', 'instruction'],
  ['YOU ARE ON MUTE', 'meta'],
  ['GIVE ME A SECOND', 'instruction'],
  ['HOLD ON', 'instruction'],
  ['JUST A MOMENT', 'instruction'],
  ['GO AHEAD', 'instruction'],
  ["LET'S BEGIN", 'instruction'],
  ['IS THIS A GOOD TIME', 'instruction'],
  // Real questions, including with a greeting or an instruction in the same line.
  ['WHAT DOES THE PLAN COST', 'question'],
  ['What does the plan cost?', 'question'],
  ['TELL ME ABOUT YOURSELF', 'question'],
  ['WALK ME THROUGH YOUR LAST PROJECT', 'question'],
  ['HOW WOULD YOU DESIGN A RATE LIMITER', 'question'],
  ['WHY DID YOU LEAVE YOUR LAST ROLE', 'question'],
  ['DO YOU HAVE EXPERIENCE WITH KUBERNETES', 'question'],
  ['CAN YOU EXPLAIN HOW THE EXPORT WORKS', 'question'],
  ['COULD YOU WALK ME THROUGH THE ROLLOUT', 'question'],
  ['HAVE YOU EVER LED A MIGRATION', 'question'],
  ['DESCRIBE A TIME YOU DISAGREED WITH A MANAGER', 'question'],
  ['SO UM WHAT PRODUCTION GRADE APPS HAVE YOU BUILT', 'question'],
  ['HI THANKS FOR JOINING SO TELL ME ABOUT YOURSELF', 'question'],
  ['GOOD MORNING WHAT DOES THE PLAN COST', 'question'],
  ['OKAY GO AHEAD AND TELL ME ABOUT YOUR LAST PROJECT', 'question'],
  ['Thanks. What was the hardest part?', 'question'],
  ['Hello, how long does onboarding take?', 'question'],
  ['And onboarding is included?', 'question'],
  // Plain statements.
  ['THE OPERATIONS TEAM LIKED THE RESULTS', 'statement'],
  // v1.4: a request worded as a statement asks for an answer.
  ['I WOULD LIKE TO HEAR ABOUT YOUR KUBERNETES WORK', 'question'],
  // v1.4 (ADR-0062): talk about the call itself.
  ['SORRY CAN YOU REPEAT THAT', 'meta'],
  ['Could you repeat the question?', 'meta'],
  ['Can you hear me okay? I think my connection dropped for a second.', 'meta'],
  ['CAN YOU GUYS HEAR ME', 'meta'],
  ['IS MY AUDIO OKAY', 'meta'],
  ['YOU ARE BREAKING UP', 'meta'],
  ['LET ME SHARE MY SCREEN', 'meta'],
  ["Sorry, I didn't catch that, what was your role there?", 'question'],
  ['CAN YOU HEAR ME OKAY SO HOW WOULD YOU DESIGN THE CACHE', 'question'],
  ['WE ARE LOOKING AT THE NUMBERS FOR THE QUARTER', 'statement'],
  ['It has been raining here all week.', 'statement'],
  ['OKAY', 'statement'],
  ['RIGHT', 'statement'],
  // Garbled.
  ['BLUE BLUE BLUE BLUE', 'garbled'],
  ['THE THE THE THE THE THE', 'garbled'],
  ['GRONK BLIMP SPROCKET WIBBLE FLANGE', 'garbled'],
  ['HMM BRR TSK PFFT SHH MM', 'garbled'],
];

/**
 * Makes an invented line.
 *
 * @param id      Its id.
 * @param speaker Who spoke.
 * @param text    What they said.
 * @param tStart  Start (ms).
 * @returns The line.
 */
function line(id: string, speaker: Utterance['speaker'], text: string, tStart: number): Utterance {
  return { id, speaker, text, final: true, tStart, tEnd: tStart + 1_000 };
}

describe('lineKind', () => {
  it('has at least 60 lines in its table', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
  });

  it.each(TABLE)('%s is %s', (text, kind) => {
    expect(lineKind(text)).toBe(kind);
  });
});

describe('looksGarbled', () => {
  it('leaves short lines and ordinary speech alone', () => {
    expect(looksGarbled('NO NO NO')).toBe(false);
    expect(looksGarbled('WHAT DOES THE PLAN COST')).toBe(false);
    expect(looksGarbled('KUBERNETES TERRAFORM POSTGRES KAFKA')).toBe(false);
  });

  it('finds one word repeated, no common words, or mostly no vowels', () => {
    expect(looksGarbled('YES YES YES OKAY')).toBe(true);
    expect(looksGarbled('GRONK BLIMP SPROCKET WIBBLE FLANGE')).toBe(true);
    expect(looksGarbled('THE BRR TSK PFFT SHH')).toBe(true);
  });
});

describe('isSkippedLine', () => {
  it('skips greetings and instructions only', () => {
    expect(isSkippedLine('HOW ARE YOU')).toBe(true);
    expect(isSkippedLine('SAY YES WHEN READY')).toBe(true);
    expect(isSkippedLine('WHAT DOES THE PLAN COST')).toBe(false);
    expect(isSkippedLine('THE OPERATIONS TEAM LIKED THE RESULTS')).toBe(false);
    expect(isSkippedLine('GRONK BLIMP SPROCKET WIBBLE FLANGE')).toBe(false);
  });
});

describe('pickQuestion', () => {
  it('uses the latest words when they are a question', () => {
    const picked = pickQuestion([line('a', 'them', 'WHAT DOES THE PLAN COST', 0)]);
    expect(picked).toMatchObject({ kind: 'question', lookedBack: false });
    if (picked.kind === 'question') expect(picked.selected.lineIds).toEqual(['a']);
  });

  it('goes back to the last real question past a greeting or an instruction', () => {
    const picked = pickQuestion([
      line('a', 'them', 'WHAT DOES THE PLAN COST', 0),
      line('b', 'you', 'LET ME CHECK', 2_000),
      line('c', 'them', 'SAY YES WHEN READY', 30_000),
    ]);
    expect(picked).toMatchObject({ kind: 'question', lookedBack: true });
    if (picked.kind === 'question') {
      expect(picked.selected.lineIds).toEqual(['a']);
      expect(picked.selected.text).toBe('WHAT DOES THE PLAN COST');
    }
  });

  it('joins the plain words right after a question a pause cut in two', () => {
    const picked = pickQuestion([
      line('a', 'them', 'WHAT WOULD THE PLAN COST', 0),
      line('b', 'them', 'FOR FORTY SEATS', 2_000),
      line('c', 'you', 'GOOD QUESTION', 4_000),
      line('d', 'them', 'THANK YOU SO MUCH', 30_000),
    ]);
    expect(picked).toMatchObject({ kind: 'question', lookedBack: true });
    if (picked.kind === 'question') {
      expect(picked.selected.text).toBe('WHAT WOULD THE PLAN COST FOR FORTY SEATS');
    }
  });

  it('leaves an instruction right after a question out of the question', () => {
    const picked = pickQuestion([
      line('a', 'them', 'WHAT DOES THE PLAN COST', 0),
      line('b', 'them', 'SAY YES WHEN READY', 2_000),
    ]);
    expect(picked).toMatchObject({ kind: 'question', lookedBack: true });
    if (picked.kind === 'question') {
      expect(picked.selected).toEqual({ text: 'WHAT DOES THE PLAN COST', lineIds: ['a'] });
    }
  });

  it('leaves noise right after a question out of the question', () => {
    const picked = pickQuestion([
      line('a', 'them', 'WHAT DOES THE PLAN COST', 0),
      line('b', 'them', 'GRONK BLIMP SPROCKET WIBBLE FLANGE', 2_000),
    ]);
    expect(picked).toMatchObject({ kind: 'question', lookedBack: true });
    if (picked.kind === 'question') {
      expect(picked.selected).toEqual({ text: 'WHAT DOES THE PLAN COST', lineIds: ['a'] });
    }
  });

  it('reports garbled latest words, without looking back', () => {
    expect(
      pickQuestion([
        line('a', 'them', 'WHAT DOES THE PLAN COST', 0),
        line('b', 'you', 'LET ME CHECK', 2_000),
        line('c', 'them', 'GRONK BLIMP SPROCKET WIBBLE FLANGE', 30_000),
      ]).kind,
    ).toBe('garbled');
  });

  it('has nothing to answer with only greetings, or with nothing from the other person', () => {
    expect(pickQuestion([line('a', 'them', 'GOOD MORNING', 0)]).kind).toBe('none');
    expect(pickQuestion([line('a', 'you', 'WHAT DOES THE PLAN COST', 0)]).kind).toBe('none');
    expect(pickQuestion([]).kind).toBe('none');
  });
});

describe('pickQuestion v1.4 (ADR-0062): remarks and another language', () => {
  it('looks back past a remark to the last real question, without adding the remark', () => {
    const lines = [
      line('a', 'them', 'WHAT IS YOUR BIGGEST WEAKNESS', 1_000),
      line('b', 'you', 'I TEND TO TAKE ON TOO MUCH AT ONCE', 3_000),
      line('c', 'them', 'STOP SMIRKING', 5_000),
    ];
    const picked = pickQuestion(lines);
    expect(picked).toMatchObject({ kind: 'question', lookedBack: true });
    expect(picked.kind === 'question' && picked.selected.lineIds).toEqual(['a']);
  });

  it('answers a lone remark only when there is no question to go back to (or reports none when asked)', () => {
    const lines = [line('c', 'them', 'I WOULD WANT A BIT MORE DETAIL ON THAT', 1_000)];
    expect(pickQuestion(lines)).toMatchObject({ kind: 'question', lookedBack: false });
    expect(pickQuestion(lines, { allowStatement: false })).toEqual({ kind: 'none' });
  });

  it('never takes another language as the question', () => {
    const lines = [
      line('a', 'them', 'HOW BIG IS THE TEAM', 1_000),
      { ...line('b', 'them', '[non-English speech]', 3_000), nonEnglish: true },
    ];
    const picked = pickQuestion(lines);
    expect(picked.kind === 'question' && picked.selected.lineIds).toEqual(['a']);
  });

  it('treats talk about the call like a greeting: skipped, back to the real question', () => {
    expect(isSkippedLine('SORRY CAN YOU REPEAT THAT')).toBe(true);
    const lines = [
      line('a', 'them', 'HOW WOULD YOU DESIGN THE CACHE', 1_000),
      line('b', 'them', 'CAN YOU HEAR ME OKAY', 5_000),
    ];
    expect(pickQuestion(lines)).toMatchObject({ kind: 'question', lookedBack: true });
  });
});
