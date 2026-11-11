/**
 * Tests for apps/web/src/core/answer/pressQuestion.ts (1.5.2, ADR-0070): what an Answer press answers, with
 * cases built from the real call of 11 Nov 2026 (its times, invented words). The newest question is
 * answered while still grey, never the one before it (the press at 54.4 s answered Q1 while Q2 was grey);
 * the user reading an answer aloud over the question does not hide it; a press while the other person has
 * only said "Next question" waits for the question, and stops waiting after PRESS_WAIT_MS; a press on
 * "can you repeat that last part?" looks back to the latest real question (182.7 s); an older unanswered
 * question never wins over the newest one; new plain words continue the card just answered; noise is
 * reported; nothing from the other person is 'none'.
 */
import { describe, expect, it } from 'vitest';
import type { AnsweredQuestion } from '@/core/answer/autoAnswer';
import { choosePress, PRESS_WAIT_MS } from '@/core/answer/pressQuestion';
import type { Utterance } from '@/core/transcript/transcript';

/** The call's clock: second s of the recording, as Unix ms. */
const T = 1_700_000_000_000;
const at = (seconds: number) => T + seconds * 1_000;

/**
 * A transcript line.
 *
 * @param id      Its id.
 * @param speaker Who spoke.
 * @param text    Its words.
 * @param start   Start, s.
 * @param end     End, s.
 * @param final   False for a grey line.
 * @returns The line.
 */
const line = (
  id: string,
  speaker: 'you' | 'them',
  text: string,
  start: number,
  end: number,
  final = true,
): Utterance => ({ id, speaker, text, tStart: at(start), tEnd: at(end), final });

const Q1 = 'NEXT QUESTION TELL ME BRIEFLY ABOUT YOUR COMPANY AND THE KIND OF WORK YOU DO';
const Q2 =
  'NEXT QUESTION OUR CUSTOMER CHATBOT GETS HUGE TRAFFIC AND WE KEEP HITTING RATE LIMITS HAVE YOU DEALT WITH THAT';
const READING = 'WE BUILD PRODUCTION AI AND DATA SYSTEMS THAT SOLVE REAL OPERATING PROBLEMS';

describe('choosePress', () => {
  it('answers the newest question while it is still grey, not the one before (54.4 s)', () => {
    const lines = [
      line('u2', 'them', Q1, 20.2, 25.3),
      line('u3', 'you', READING, 31.8, 38.5),
      line('u5', 'them', Q2, 46.5, 54.4, false),
    ];
    // Q1 was answered on its grey words: since 1.5.2 its final line kept that id.
    const choice = choosePress({
      lines,
      answeredLineIds: new Set(['u2']),
      last: { answerId: 'a1', lineIds: ['u2'], end: at(25.5), askedAt: at(25.8), auto: false },
      now: at(54.4),
    });
    expect(choice).toMatchObject({
      kind: 'answer',
      lineIds: ['u5'],
      grey: true,
      lookedBack: false,
    });
  });

  it('answers the question the user was reading an answer aloud over', () => {
    const lines = [
      line('u2', 'them', Q1, 20.2, 25.3),
      line('u4', 'you', READING, 40.4, 48.2),
      line('u5', 'them', Q2, 46.5, 53.8),
      // Began over the question (their words went on 4 s after it began): not a reply.
      line('u6', 'you', 'NEXT QUESTION OUR CUSTOMER CHAT', 49.3, 53.6),
    ];
    expect(
      choosePress({ lines, answeredLineIds: new Set(['u2']), last: null, now: at(54.4) }),
    ).toMatchObject({ kind: 'answer', lineIds: ['u5'] });
  });

  it('waits while they have only said "Next question", then gives up waiting after PRESS_WAIT_MS', () => {
    const lines = [
      line('u2', 'them', Q1, 20.2, 25.3),
      line('u5', 'them', 'NEXT QUESTION', 46.5, 47.4, false),
    ];
    const input = { lines, answeredLineIds: new Set(['u2']), last: null, now: at(47.5) };
    expect(choosePress(input)).toEqual({ kind: 'wait' });
    expect(choosePress({ ...input, waitingSince: at(47.5) - PRESS_WAIT_MS })).not.toEqual({
      kind: 'wait',
    });
  });

  it('looks back past "can you repeat that last part?" to the latest real question (182.7 s)', () => {
    const SUPPORT = 'HAVE YOU BUILT A SUPPORT COPILOT AND HOW DID YOU KEEP HUMANS IN THE LOOP';
    const lines = [
      line('u21', 'them', SUPPORT, 147.4, 153.9),
      line('u22', 'you', READING, 159.1, 173.7),
      line('u23', 'them', 'Sorry, can you repeat that last part?', 174.6, 176.2),
    ];
    const last: AnsweredQuestion = {
      answerId: 'a7',
      lineIds: ['u21'],
      end: at(153.9),
      askedAt: at(155.3),
      auto: false,
    };
    // Answered already: the repeat guard then shows that card instead of asking again.
    expect(
      choosePress({ lines, answeredLineIds: new Set(['u21']), last, now: at(182.7) }),
    ).toMatchObject({ kind: 'answer', lineIds: ['u21'], lookedBack: true });
  });

  it('never prefers an older unanswered question to the newest one', () => {
    const lines = [
      line('u11', 'them', 'HAVE YOU BUILT ANYTHING TO PREDICT CHURN', 73.8, 79.8),
      line('u16', 'you', READING, 107.6, 112.0),
      line('u17', 'them', 'COULD AI VOICE AGENTS HELP US CALL LEADS BACK FASTER', 113.4, 121.2),
    ];
    // The newest was answered (by auto-answer); the older one never was.
    expect(
      choosePress({ lines, answeredLineIds: new Set(['u17']), last: null, now: at(123) }),
    ).toMatchObject({ kind: 'answer', lineIds: ['u17'] });
  });

  it('asks new plain words that continue the question just answered again on its card', () => {
    const lines = [
      line('u5', 'them', 'WHAT DOES THE ANNUAL PLAN COST', 46.5, 49.0),
      line('u6', 'them', 'FOR FORTY SEATS', 50.5, 51.6),
    ];
    const last: AnsweredQuestion = {
      answerId: 'card',
      lineIds: ['u5'],
      end: at(49.0),
      askedAt: at(49.4),
      auto: false,
    };
    expect(
      choosePress({ lines, answeredLineIds: new Set(['u5']), last, now: at(52.5) }),
    ).toMatchObject({ kind: 'answer', lineIds: ['u5', 'u6'], replaces: 'card' });
  });

  it('reports noise, and nothing from the other person as none', () => {
    expect(
      choosePress({
        lines: [line('u1', 'them', 'BLAH BLAH BLAH BLAH', 1, 2)],
        answeredLineIds: new Set(),
        last: null,
        now: at(3),
      }).kind,
    ).toBe('garbled');
    expect(
      choosePress({
        lines: [line('u1', 'you', READING, 1, 4)],
        answeredLineIds: new Set(),
        last: null,
        now: at(5),
      }),
    ).toEqual({ kind: 'none' });
  });
});
