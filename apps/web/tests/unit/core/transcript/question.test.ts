/**
 * Tests for apps/web/src/core/transcript/question.ts, selectQuestion() and isQuestionLike(), on
 * invented transcripts in the recogniser's style (upper case, no punctuation): a question split
 * over two lines; the user interrupting (a backchannel does not end the question, a real turn
 * does); an echo line in between (left out by the transcript, so it never counts as the user
 * speaking); no "Them" speech yet; "Them" silent since the user spoke (their last line); a
 * still-grey question; trimming to the latest question-like run and to the word limit.
 * All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { MAX_QUESTION_WORDS, isQuestionLike, selectQuestion } from '@/core/transcript/question';
import { createTranscript, type Utterance } from '@/core/transcript/transcript';

/** Counter for invented line ids and times. */
let next = 0;

/**
 * An invented final line, later in time than the one before.
 *
 * @param speaker Who spoke.
 * @param text    What was said.
 * @param final   False for a partial (grey) line.
 * @returns The line.
 */
function say(speaker: 'you' | 'them', text: string, final = true): Utterance {
  next += 1;
  return {
    id: final ? `u${next}` : `partial-${speaker}`,
    speaker,
    text,
    tStart: next * 10_000,
    tEnd: next * 10_000 + 3_000,
    final,
  };
}

describe('isQuestionLike', () => {
  it('recognises question words, phrases, a leading helping verb and "?"', () => {
    expect(isQuestionLike('SO WHAT WOULD IT COST')).toBe(true);
    expect(isQuestionLike('COULD YOU WALK ME THROUGH THE ROLLOUT')).toBe(true);
    expect(isQuestionLike('AND IS THAT BILLED YEARLY')).toBe(true);
    expect(isQuestionLike('Any discount?')).toBe(true);
    expect(isQuestionLike('THAT IS A BIG CHANGE')).toBe(false);
    expect(isQuestionLike('OUR FINANCE LEAD PREFERS YEARLY BILLING')).toBe(false);
  });
});

describe('selectQuestion', () => {
  it('joins a question split over two lines', () => {
    const lines = [
      say('you', 'WE CAN GO THROUGH PRICING NOW'),
      say('them', 'THAT SOUNDS GOOD'),
      say('them', 'SO WHAT WOULD THE PROFESSIONAL PLAN'),
      say('them', 'COST FOR FORTY SEATS'),
    ];
    const question = selectQuestion(lines)!;
    expect(question.text).toBe('SO WHAT WOULD THE PROFESSIONAL PLAN COST FOR FORTY SEATS');
    expect(question.lineIds).toEqual([lines[2]!.id, lines[3]!.id]);
  });

  it('keeps the question when the user only says a short "right" in the middle', () => {
    const lines = [
      say('them', 'HOW LONG DOES THE ROLLOUT TAKE'),
      say('you', 'RIGHT'),
      say('them', 'FOR ALL FOUR DEPOTS'),
    ];
    expect(selectQuestion(lines)!.text).toBe('HOW LONG DOES THE ROLLOUT TAKE FOR ALL FOUR DEPOTS');
  });

  it('starts after the user’s last real turn when the user interrupts', () => {
    const lines = [
      say('them', 'WHAT DOES IT COST'),
      say('you', 'IT IS FIFTY TWO DOLLARS PER SEAT'),
      say('them', 'AND WHEN WOULD IT RENEW'),
    ];
    const question = selectQuestion(lines)!;
    expect(question.text).toBe('AND WHEN WOULD IT RENEW');
    expect(question.lineIds).toEqual([lines[2]!.id]);
  });

  it('ignores an echo line in between (the transcript leaves it out)', () => {
    let now = 0;
    const transcript = createTranscript(() => now, { schedule: () => () => undefined });
    const question = 'COULD YOU HOLD THAT SEAT PRICE FOR TWO YEARS';
    transcript.addFinal({ speaker: 'them', text: question, tStart: 1_000, tEnd: 4_000 });
    // The laptop speakers play the question back into the microphone.
    transcript.addFinal({ speaker: 'you', text: question, tStart: 1_200, tEnd: 4_300 });
    transcript.addFinal({
      speaker: 'them',
      text: 'FROM THE RENEWAL DATE',
      tStart: 7_000,
      tEnd: 8_000,
    });
    // Started 3 s after the question ended: beyond the merge gap, so it stays its own line.
    now = 9_000;
    expect(transcript.lines().map((line) => line.speaker)).toEqual(['them', 'them']);
    expect(selectQuestion(transcript.lines())!.text).toContain(question);
  });

  it('returns null when "Them" has not spoken yet', () => {
    expect(selectQuestion([])).toBeNull();
    expect(selectQuestion([say('you', 'HELLO CAN YOU HEAR ME OKAY')])).toBeNull();
  });

  it('answers the last "Them" line when they have not spoken since the user', () => {
    const lines = [
      say('them', 'WHAT ABOUT TRAINING'),
      say('you', 'TRAINING RUNS IN SMALL GROUPS WITH A PRACTICE DAY'),
    ];
    const question = selectQuestion(lines)!;
    expect(question.text).toBe('WHAT ABOUT TRAINING');
    expect(question.lineIds).toEqual([lines[0]!.id]);
  });

  it('includes a question still being heard (grey)', () => {
    const lines = [
      say('you', 'ANYTHING ELSE I CAN HELP WITH'),
      say('them', 'WHAT ABOUT SINGLE', false),
    ];
    expect(selectQuestion(lines)!.lineIds).toEqual(['partial-them']);
  });

  it('trims to the latest question-like run, and to the word limit', () => {
    const lines = [
      say('you', 'LET ME SHARE THE NUMBERS FROM THE PILOT'),
      say('them', 'WHAT WAS THE PLANNING TIME BEFORE'),
      say('them', 'THAT IS A BIG CHANGE FOR US'),
      say('them', 'HOW WOULD TRAINING WORK'),
    ];
    expect(selectQuestion(lines)!.text).toBe('HOW WOULD TRAINING WORK');
    const long = 'WORD '.repeat(MAX_QUESTION_WORDS + 20).trim();
    const statement = [say('you', 'LET ME EXPLAIN THE PLAN IN DETAIL'), say('them', long)];
    expect(selectQuestion(statement)!.text.split(' ')).toHaveLength(MAX_QUESTION_WORDS);
  });
});
