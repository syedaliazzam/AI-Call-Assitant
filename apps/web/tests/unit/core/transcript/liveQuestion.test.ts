/**
 * Tests for apps/web/src/core/transcript/liveQuestion.ts and questionSpan() in question.ts (v1.0.4,
 * ADR-0040): the latest question from the other person, on lines in the recogniser's style (capitals,
 * no punctuation): a question after a lead-in or in the middle of a line; statements that only hold a
 * question word; a question cut in two by a pause; "…" while it is still being heard; Clear; the user's
 * own speech. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { liveQuestion, LIVE_QUESTION_WORDS } from '@/core/transcript/liveQuestion';
import { groupLines, groupWords } from '@/core/transcript/group';
import { questionSpan } from '@/core/transcript/question';
import type { Utterance } from '@/core/transcript/transcript';

/**
 * Makes an invented line.
 *
 * @param speaker Who spoke.
 * @param text    What they said.
 * @param tStart  Start (ms).
 * @param final   False while it is still being heard.
 * @returns The line.
 */
function line(
  speaker: Utterance['speaker'],
  text: string,
  tStart: number,
  final = true,
): Utterance {
  return { id: `${speaker}-${tStart}`, speaker, text, final, tStart, tEnd: tStart + 1_000 };
}

/**
 * The words questionSpan() finds.
 *
 * @param text A line.
 * @returns The question, or null.
 */
function question(text: string): string | null {
  const span = questionSpan(text);
  return span ? text.slice(span.start, span.end) : null;
}

describe('questionSpan', () => {
  it('skips a lead-in', () => {
    expect(question('SO UM WHAT PRODUCTION GRADE APPLICATIONS HAVE YOU BUILT')).toBe(
      'WHAT PRODUCTION GRADE APPLICATIONS HAVE YOU BUILT',
    );
    expect(question('OKAY GREAT TELL ME ABOUT YOURSELF')).toBe('TELL ME ABOUT YOURSELF');
  });

  it('finds a question in the middle of a line', () => {
    expect(question('THAT IS REALLY GREAT SO HOW WOULD YOU DESIGN A VOICE AGENT')).toBe(
      'HOW WOULD YOU DESIGN A VOICE AGENT',
    );
    expect(question('THAT IS REALLY GREAT WHAT PRODUCTION GRADE APPS HAVE YOU BUILT')).toBe(
      'WHAT PRODUCTION GRADE APPS HAVE YOU BUILT',
    );
    expect(question('I SAW YOUR PROFILE CAN YOU WALK ME THROUGH IT')).toBe(
      'CAN YOU WALK ME THROUGH IT',
    );
  });

  it('leaves statements alone', () => {
    expect(question('I KNOW WHAT YOU MEAN')).toBeNull();
    expect(question('THE TEAM LIKED THE RESULTS')).toBeNull();
    expect(question('I EXPLAINED HOW THE SYSTEM WORKS')).toBeNull();
  });

  it('with punctuation: the last sentence with a question mark', () => {
    expect(question('Thanks for that. How would you design it? Take your time.')).toBe(
      'How would you design it?',
    );
  });

  it('needs at least three words', () => {
    expect(question('Sorry?')).toBeNull();
    expect(question('WHAT THEN')).toBeNull();
  });
});

describe('liveQuestion', () => {
  it('is null until the other person asks something', () => {
    expect(liveQuestion([])).toBeNull();
    expect(liveQuestion([line('them', 'THE TEAM LIKED THE RESULTS', 0)])).toBeNull();
  });

  it('never takes the user’s own question', () => {
    expect(liveQuestion([line('you', 'WHAT WOULD YOU LIKE TO KNOW', 0)])).toBeNull();
  });

  it('is the latest question, in sentence case with a question mark', () => {
    expect(
      liveQuestion([
        line('them', 'WHAT DOES THE PILOT COST', 0),
        line('you', 'IT COSTS TWENTY EIGHT DOLLARS', 5_000),
        line('them', 'THANKS HOW WOULD YOU DESIGN A VOICE AGENT', 10_000),
        line('you', 'LET ME THINK', 15_000),
      ]),
    ).toBe('How would you design a voice agent?');
  });

  it('leaves out hesitation sounds and restores the session’s spellings', () => {
    expect(
      liveQuestion(
        [line('them', 'UM WHAT WOULD THE UH PROFESSIONAL PLAN COST', 0)],
        ['Professional plan'],
      ),
    ).toBe('What would the Professional plan cost?');
  });

  it('joins a question cut in two by a pause', () => {
    expect(
      liveQuestion([
        line('them', 'SO WHAT WOULD THE PLAN COST', 0),
        line('them', 'FOR FORTY SEATS', 2_000),
      ]),
    ).toBe('What would the plan cost for forty seats?');
  });

  it('does not join speech after a long pause or after the user spoke', () => {
    expect(
      liveQuestion([
        line('them', 'WHAT WOULD THE PLAN COST', 0),
        line('them', 'THE TEAM IS WAITING', 20_000),
      ]),
    ).toBe('What would the plan cost?');
    expect(
      liveQuestion([
        line('them', 'WHAT WOULD THE PLAN COST', 0),
        line('you', 'GOOD QUESTION', 1_500),
        line('them', 'THE TEAM IS WAITING', 3_000),
      ]),
    ).toBe('What would the plan cost?');
  });

  it('updates live: words still being heard end in an ellipsis', () => {
    expect(liveQuestion([line('them', 'HOW WOULD YOU DESIGN', 0, false)])).toBe(
      'How would you design…',
    );
    expect(
      liveQuestion([
        line('them', 'HOW WOULD YOU DESIGN', 0),
        line('them', 'A VOICE', 1_500, false),
      ]),
    ).toBe('How would you design a voice…');
  });

  it('adds no question mark to a request', () => {
    expect(liveQuestion([line('them', 'TELL ME ABOUT YOURSELF', 0)])).toBe(
      'Tell me about yourself',
    );
  });

  it('keeps a question mark the engine wrote, and stops at it', () => {
    expect(liveQuestion([line('them', 'How would you test it? Take your time.', 0)])).toBe(
      'How would you test it?',
    );
  });

  it('forgets a question from before Clear, until a new one is asked', () => {
    const lines = [line('them', 'WHAT DOES THE PILOT COST', 0)];
    expect(liveQuestion(lines, [], 5_000)).toBeNull();
    expect(liveQuestion([...lines, line('them', 'HOW LONG DOES IT TAKE', 6_000)], [], 5_000)).toBe(
      'How long does it take?',
    );
  });

  it('cuts a very long question', () => {
    const words = Array.from({ length: LIVE_QUESTION_WORDS + 5 }, () => 'WORD').join(' ');
    const shown = liveQuestion([line('them', `WHAT IS ${words}`, 0)]);
    expect(shown?.endsWith('…')).toBe(true);
    expect(shown?.split(' ')).toHaveLength(LIVE_QUESTION_WORDS);
  });
});

describe('groupWords', () => {
  it('gives "Answer this" the words still being heard, not only the finished ones', () => {
    const [grey] = groupLines([line('them', 'HOW DO YOU KEEP IT', 0, false)]);
    expect(groupWords(grey!)).toBe('How do you keep it');
    const [both] = groupLines([
      line('them', 'HOW DO YOU', 0),
      line('them', 'KEEP IT LOW', 1_500, false),
    ]);
    expect(groupWords(both!)).toBe('How do you keep it low');
  });
});

describe('the transcript’s "?" mark agrees with the live question', () => {
  it('marks a question after a lead-in or in the middle of a line', () => {
    const groups = groupLines([
      line('them', 'THAT IS REALLY GREAT SO HOW WOULD YOU DESIGN IT', 0),
      line('you', 'SURE', 10_000),
      line('them', 'I KNOW WHAT YOU MEAN', 20_000),
    ]);
    expect(groups.map((group) => group.question)).toEqual([true, false, false]);
  });
});
