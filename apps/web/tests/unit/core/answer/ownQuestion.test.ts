/**
 * Tests for apps/web/src/core/answer/ownQuestion.ts (ADR-0123, amended 27 Nov 2026): who Ctrl+Enter answers (the
 * other person while they have spoken within ON_CALL_WINDOW_MS and their audio is connected, otherwise the user),
 * and which of the user's words are their newest unanswered speech (every "You" line since the last answered
 * words, back to the other person's words, joined into one turn; greetings and small talk included; words
 * answered already are shown again, not asked twice). Invented words only.
 */
import { describe, expect, it } from 'vitest';
import {
  chooseOwnQuestion,
  lastThemSpeech,
  MAX_OWN_WORDS,
  ON_CALL_WINDOW_MS,
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

/** Nothing of the user's answered yet. */
const NONE = null;

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

describe('chooseOwnQuestion (ADR-0123, amended 27 Nov 2026)', () => {
  it('answers a greeting: on your own everything the user says is meant for the assistant', () => {
    expect(
      chooseOwnQuestion({ lines: [line('u1', 'you', 'Hey there.', 1, 2)], answeredUntil: NONE }),
    ).toEqual({ kind: 'answer', text: 'Hey there.', lineIds: ['u1'], grey: false, until: at(1) });
  });

  it('joins two lines in a row into one turn, however far apart (one answer covering both)', () => {
    const lines = [
      line('u1', 'you', 'Hi, how are you?', 1, 2),
      line('u2', 'you', 'Tell me about myself.', 30, 32),
    ];
    expect(chooseOwnQuestion({ lines, answeredUntil: NONE })).toEqual({
      kind: 'answer',
      text: 'Hi, how are you? Tell me about myself.',
      lineIds: ['u1', 'u2'],
      grey: false,
      until: at(30),
    });
  });

  it('starts after the last answered words, so an answered line is never asked again', () => {
    const lines = [
      line('u1', 'you', 'What is a monad?', 1, 2),
      line('u2', 'you', 'Okay, thanks.', 20, 21),
      line('u3', 'you', 'And a functor?', 22, 23),
    ];
    expect(chooseOwnQuestion({ lines, answeredUntil: at(1) })).toMatchObject({
      kind: 'answer',
      text: 'Okay, thanks. And a functor?',
      lineIds: ['u2', 'u3'],
    });
  });

  it('takes the new words that the transcript joined to an answered line (close lines merge)', () => {
    const joined: Utterance = {
      ...line('u1', 'you', 'What is a monad? Hey there.', 1, 6),
      segments: [
        { text: 'What is a monad?', tStart: at(1), tEnd: at(2) },
        { text: 'Hey there.', tStart: at(5), tEnd: at(6) },
      ],
    };
    expect(chooseOwnQuestion({ lines: [joined], answeredUntil: at(1) })).toEqual({
      kind: 'answer',
      text: 'Hey there.',
      lineIds: ['u1'],
      grey: false,
      until: at(5),
    });
  });

  it('answers the user’s newest words, never the other person’s, and stops at their words before mine', () => {
    const lines = [
      line('u1', 'you', 'I worked there for three years.', 1, 3),
      line('u2', 'them', 'What would you change in your last project?', 10, 14),
      line('u3', 'you', 'How long should my answer be?', 20, 22),
      line('u4', 'them', 'Take your time.', 23, 24),
    ];
    expect(chooseOwnQuestion({ lines, answeredUntil: NONE })).toEqual({
      kind: 'answer',
      text: 'How long should my answer be?',
      lineIds: ['u3'],
      grey: false,
      until: at(20),
    });
  });

  it('says the newest words were answered already instead of asking twice (also once a grey line finishes)', () => {
    const lines = [line('u1', 'you', 'Hello.', 1, 2), line('u2', 'you', 'What is a monad?', 3, 4)];
    expect(chooseOwnQuestion({ lines, answeredUntil: at(3) })).toEqual({
      kind: 'answered',
      lineIds: ['u2'],
    });
    // Answered while grey ("What is a"), finished later with more words: the same stretch, not new.
    expect(
      chooseOwnQuestion({
        lines: [line('u1', 'you', 'What is a monad?', 1, 4)],
        answeredUntil: at(1),
      }),
    ).toEqual({ kind: 'answered', lineIds: ['u1'] });
  });

  it('marks words still being spoken (grey), and sends only the newest words of a long turn', () => {
    expect(
      chooseOwnQuestion({
        lines: [line('u1', 'you', 'What is the best way to', 1, 2, false)],
        answeredUntil: NONE,
      }),
    ).toMatchObject({ kind: 'answer', grey: true });
    const long = `${'we moved the billing service to a new queue and '.repeat(30)}what do you think?`;
    const choice = chooseOwnQuestion({
      lines: [line('u1', 'you', long, 1, 60)],
      answeredUntil: NONE,
    });
    expect(choice.kind === 'answer' && choice.text.split(' ').length).toBe(MAX_OWN_WORDS);
    expect(choice.kind === 'answer' && choice.text.endsWith('what do you think?')).toBe(true);
  });

  it('finds nothing when the user said nothing (only the other person spoke, or empty lines)', () => {
    expect(
      chooseOwnQuestion({
        lines: [
          line('u1', 'them', 'What is your notice period?', 1, 2),
          line('u2', 'you', '  ', 3, 3),
        ],
        answeredUntil: NONE,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('leaves out speech in another language (a placeholder, not the user’s words)', () => {
    const lines: Utterance[] = [
      line('u1', 'you', 'Good morning.', 1, 2),
      { ...line('u2', 'you', '[non-English speech]', 3, 4), nonEnglish: true },
    ];
    expect(chooseOwnQuestion({ lines, answeredUntil: NONE })).toMatchObject({
      text: 'Good morning.',
      lineIds: ['u1'],
    });
  });
});
