/**
 * Tests for apps/web/src/core/answer/ownQuestion.ts (ADR-0123): who Ctrl+Enter answers (the other person while
 * they have spoken within ON_CALL_WINDOW_MS and their audio is connected, otherwise the user), and which of the
 * user's words are their newest question or request (a question or an instruction to the assistant, looked for
 * past ordinary talk; a turn answered already is shown again, not asked twice). Invented words only.
 */
import { describe, expect, it } from 'vitest';
import {
  chooseOwnQuestion,
  isOwnRequest,
  lastThemSpeech,
  MAX_OWN_WORDS,
  ON_CALL_WINDOW_MS,
  OWN_TURN_GAP_MS,
  pressTarget,
} from '@/core/answer/ownQuestion';
import type { Utterance } from '@/core/transcript/transcript';

/** The call's clock: second s of the call, as Unix ms. */
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

const NOTHING = new Set<string>();

describe('pressTarget (ADR-0123)', () => {
  const call = [
    line('u1', 'them', 'What would you change in your last project?', 10, 14),
    line('u2', 'you', 'How long should my answer be?', 20, 22),
  ];

  it('is the other person while they spoke within the window, even after the user asked aloud', () => {
    expect(pressTarget(call, at(14) + ON_CALL_WINDOW_MS - 1, true)).toBe('them');
  });

  it('is the user once the other side has been quiet for the whole window', () => {
    expect(pressTarget(call, at(14) + ON_CALL_WINDOW_MS, true)).toBe('you');
  });

  it('is the user with no other-side source, or when the other side has said nothing', () => {
    expect(pressTarget(call, at(15), false)).toBe('you');
    expect(pressTarget([line('u2', 'you', 'What is a monad?', 1, 2)], at(3), true)).toBe('you');
  });

  it('counts a grey line of theirs (they are speaking now) and ignores empty ones', () => {
    const lines = [
      line('u1', 'them', 'So tell me', 200, 201, false),
      line('u2', 'them', ' ', 300, 300),
    ];
    expect(lastThemSpeech(lines)).toBe(at(201));
    expect(pressTarget(lines, at(250), true)).toBe('them');
  });

  it('keeps the window at about two minutes (named constant)', () => {
    expect(ON_CALL_WINDOW_MS).toBe(120_000);
  });
});

describe('isOwnRequest (ADR-0123)', () => {
  it('takes questions and requests to the assistant', () => {
    expect(isOwnRequest('What is the capital of Australia?')).toBe(true);
    expect(isOwnRequest('how do I reverse a linked list')).toBe(true);
    expect(isOwnRequest('Explain the CAP theorem in two sentences.')).toBe(true);
    expect(isOwnRequest('Okay, write me a short thank-you email to Dana.')).toBe(true);
    expect(isOwnRequest('Tell me about the Professional plan.')).toBe(true);
    expect(isOwnRequest('I was thinking about it. Summarise what she said.')).toBe(true);
  });

  it('leaves out ordinary talk, greetings, talk about the call and noise', () => {
    expect(isOwnRequest('Yeah, that makes sense.')).toBe(false);
    expect(isOwnRequest('I worked there for three years.')).toBe(false);
    expect(isOwnRequest('Hi, good morning!')).toBe(false);
    expect(isOwnRequest('Can you hear me okay?')).toBe(false);
    expect(isOwnRequest('')).toBe(false);
    expect(isOwnRequest('zzzz zzzz zzzz zzzz zzzz')).toBe(false);
  });
});

describe('chooseOwnQuestion (ADR-0123)', () => {
  it('answers the user’s newest question, never the other person’s', () => {
    const lines = [
      line('u1', 'them', 'What would you change in your last project?', 10, 14),
      line('u2', 'you', 'What is a good way to answer that?', 20, 22),
    ];
    expect(chooseOwnQuestion({ lines, answeredLineIds: NOTHING })).toEqual({
      kind: 'answer',
      text: 'What is a good way to answer that?',
      lineIds: ['u2'],
      grey: false,
    });
  });

  it('looks back past ordinary talk to the newest question', () => {
    const lines = [
      line('u1', 'you', 'What does idempotent mean?', 1, 3),
      line('u2', 'you', 'Okay, thanks, that is clear.', 30, 32),
    ];
    expect(chooseOwnQuestion({ lines, answeredLineIds: NOTHING })).toMatchObject({
      kind: 'answer',
      lineIds: ['u1'],
    });
  });

  it('keeps one spoken question in two lines together, and splits turns on a pause or their words', () => {
    const lines = [
      line('u1', 'you', 'What is the difference between', 1, 2.5),
      line('u2', 'you', 'a process and a thread?', 3, 4),
      line('u3', 'them', 'Sure.', 5, 5.5),
      line('u4', 'you', 'Explain virtual memory.', 6, 7),
    ];
    expect(chooseOwnQuestion({ lines: lines.slice(0, 2), answeredLineIds: NOTHING })).toMatchObject(
      {
        text: 'What is the difference between a process and a thread?',
        lineIds: ['u1', 'u2'],
      },
    );
    expect(chooseOwnQuestion({ lines, answeredLineIds: NOTHING })).toMatchObject({
      lineIds: ['u4'],
    });
    const apart = [
      line('u1', 'you', 'What is a monad?', 1, 2),
      line('u2', 'you', 'Explain functors.', 2 + OWN_TURN_GAP_MS / 1_000 + 0.5, 6),
    ];
    expect(chooseOwnQuestion({ lines: apart, answeredLineIds: NOTHING })).toMatchObject({
      lineIds: ['u2'],
    });
  });

  it('says a turn was answered already instead of asking twice', () => {
    const lines = [line('u1', 'you', 'What is a monad?', 1, 2)];
    expect(chooseOwnQuestion({ lines, answeredLineIds: new Set(['u1']) })).toEqual({
      kind: 'answered',
      lineIds: ['u1'],
    });
  });

  it('marks a question still being spoken (grey), and sends only the newest words of a long turn', () => {
    expect(
      chooseOwnQuestion({
        lines: [line('u1', 'you', 'What is the best way to', 1, 2, false)],
        answeredLineIds: NOTHING,
      }),
    ).toMatchObject({ kind: 'answer', grey: true });
    // Ordinary words (one word repeated would read as noise), then the question.
    const long = `${'we moved the billing service to a new queue and '.repeat(30)}what do you think?`;
    const choice = chooseOwnQuestion({
      lines: [line('u1', 'you', long, 1, 60)],
      answeredLineIds: NOTHING,
    });
    expect(choice.kind === 'answer' && choice.text.split(' ').length).toBe(MAX_OWN_WORDS);
  });

  it('finds nothing when the user asked nothing (only remarks, or only the other person spoke)', () => {
    expect(
      chooseOwnQuestion({
        lines: [line('u1', 'you', 'I agree with that.', 1, 2)],
        answeredLineIds: NOTHING,
      }),
    ).toEqual({ kind: 'none' });
    expect(
      chooseOwnQuestion({
        lines: [line('u1', 'them', 'What is your notice period?', 1, 2)],
        answeredLineIds: NOTHING,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('leaves out speech in another language', () => {
    const lines: Utterance[] = [
      { ...line('u1', 'you', '[non-English speech]', 1, 2), nonEnglish: true },
    ];
    expect(chooseOwnQuestion({ lines, answeredLineIds: NOTHING })).toEqual({ kind: 'none' });
  });
});
