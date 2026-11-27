/**
 * Tests for apps/web/src/core/answer/newestQuestion.ts (ADR-0076, investigation E3) and the transcript
 * changes it relies on (apps/web/src/core/transcript/transcript.ts, merge.ts): every rule.
 * 1. One clock: grey lines carry the capture time they are given, not the page's arrival time.
 * 3. Newest by time: only speech after the newest answered speech, kept per segment even when lines join.
 * 4. No look-back: new speech is sent even when it reads as a statement; an old card is shown only when
 *    nothing new was said.
 * 5. A reply (a finished "You" line of more than two words that did not start over them) ends the window.
 * 6. Completeness: any new word within 2 s re-asks (once the turn is over). Batch D (P0-B): anchored on
 *    the original answer, at most once per card, the 2.5 s new-question rule, and with auto-answer off only
 *    a press on grey words (D1). P0-C: whether the re-ask only finishes the same sentence.
 * 7. Feedback is the caller's (useLiveAnswers.ts); here: the choice that drives it ('show-existing', 'none').
 *    Batch D (P1-G): speech a re-ask took in is answered when the caller passes the own-card end.
 * 8. Gaps: Batch D (P1-G): the newest words are answered with an audio-lost note; 'gap' only with no words.
 * 9. Auto-answer at the engine's own end of turn, once per question.
 */
import { describe, expect, it } from 'vitest';
import {
  autoNewestDue,
  chooseNewest,
  finishesSameSentence,
  REASK_WINDOW_MS,
  reaskSpeech,
  unansweredSpeech,
} from '@/core/answer/newestQuestion';
import type { AnsweredQuestion } from '@/core/answer/autoAnswer';

/** The press time in the chooseNewest tests: after every line below (capture clock, ms). */
const NOW = 20_000;
import { createTranscript, type Utterance } from '@/core/transcript/transcript';

/**
 * A transcript whose clock is far from the capture times, so arrival time and capture time differ.
 *
 * @returns The transcript.
 */
function transcriptAt() {
  // The page's clock: 9 s after the capture times below (a late message must not move a line's times).
  return createTranscript(() => 109_000, { schedule: () => () => undefined });
}

/**
 * A final line.
 *
 * @param id      Its id.
 * @param speaker Who.
 * @param text    Words.
 * @param tStart  Start.
 * @param tEnd    End.
 * @param extra   More fields.
 * @returns The line.
 */
function line(
  id: string,
  speaker: 'you' | 'them',
  text: string,
  tStart: number,
  tEnd: number,
  extra: Partial<Utterance> = {},
): Utterance {
  return { id, speaker, text, tStart, tEnd, final: true, ...extra };
}

describe('rule 1: one clock', () => {
  it('a grey line keeps the capture time it is given, whatever the page clock says', () => {
    const transcript = transcriptAt();
    transcript.addPartial('them', 'How would you', 100_000, 100_640);
    const grey = transcript.lines()[0]!;
    expect(grey.tStart).toBe(100_000);
    expect(grey.tEnd).toBe(100_640);
    // Without one (the on-device engine before ADR-0076) it is the page's clock, as before.
    transcript.addPartial('you', 'Sure', 100_100);
    expect(transcript.lines().find((item) => item.speaker === 'you')!.tEnd).toBe(109_000);
  });

  it('a final line ended by the engine is marked, and joined lines keep each segment', () => {
    const transcript = transcriptAt();
    transcript.addFinal({
      speaker: 'them',
      text: 'Tell me about yourself.',
      tStart: 100_000,
      tEnd: 102_000,
      endOfTurn: true,
    });
    expect(transcript.lines()[0]!.engineTurnEnd).toBe(true);
    transcript.addFinal({ speaker: 'them', text: 'And why us?', tStart: 102_800, tEnd: 104_000 });
    const joined = transcript.lines()[0]!;
    expect(joined.text).toBe('Tell me about yourself. And why us?');
    expect(joined.segments).toEqual([
      { text: 'Tell me about yourself.', tStart: 100_000, tEnd: 102_000 },
      { text: 'And why us?', tStart: 102_800, tEnd: 104_000 },
    ]);
    // The newest stretch did not end the turn.
    expect(joined.engineTurnEnd).toBeUndefined();
  });

  it('rule 8: a gap is a line of its own, never joined', () => {
    const transcript = transcriptAt();
    transcript.addFinal({ speaker: 'them', text: 'First part.', tStart: 100_000, tEnd: 101_000 });
    transcript.noteGap('them', 101_200, 104_000);
    transcript.addFinal({ speaker: 'them', text: 'second part', tStart: 104_100, tEnd: 105_000 });
    const lines = transcript.lines();
    expect(lines.map((item) => item.text)).toEqual(['First part.', '[audio gap]', 'second part']);
    expect(lines[1]!.gap).toBe(true);
  });
});

describe('chooseNewest (a press, after catching up)', () => {
  it('rule 3: answers only the speech after the newest answered speech', () => {
    const lines = [
      line('u1', 'them', 'What is your notice period?', 1_000, 3_000),
      line('u2', 'them', 'And how do you handle conflict?', 3_500, 6_000),
    ];
    const choice = chooseNewest({ lines, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW });
    expect(choice).toMatchObject({
      kind: 'answer',
      text: 'And how do you handle conflict?',
      lineIds: ['u2'],
      span: { start: 3_500, end: 6_000 },
      grey: false,
      words: 6,
    });
  });

  it('rule 3: finds the new question inside a line joined to an answered one', () => {
    const lines = [
      line('u1', 'them', 'What is your notice period? Why do you want to leave?', 1_000, 7_000, {
        segments: [
          { text: 'What is your notice period?', tStart: 1_000, tEnd: 3_000 },
          { text: 'Why do you want to leave?', tStart: 4_000, tEnd: 7_000 },
        ],
      }),
    ];
    const choice = chooseNewest({ lines, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW });
    expect(choice).toMatchObject({
      kind: 'answer',
      text: 'Why do you want to leave?',
      lineIds: ['u1'],
    });
  });

  it('rule 3: grey words of the newest question count, and are marked grey', () => {
    const lines = [
      {
        ...line('u3', 'them', 'How would you design a rate limiter', 10_000, 12_000),
        final: false,
      },
    ];
    expect(chooseNewest({ lines, answeredEnd: null, lastAnswerId: null, now: NOW })).toMatchObject({
      kind: 'answer',
      grey: true,
    });
  });

  it('rule 4: no look-back when newer speech exists, even if it reads as a statement', () => {
    const lines = [
      line('u1', 'them', 'How do you test your code?', 1_000, 3_000),
      line('u2', 'them', 'Our team ships every week.', 8_000, 10_000),
    ];
    const choice = chooseNewest({ lines, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW });
    expect(choice).toMatchObject({ kind: 'answer', text: 'Our team ships every week.' });
  });

  it('rule 4: nothing new since the last card shows that card; nothing at all is "none"', () => {
    const lines = [line('u1', 'them', 'How do you test your code?', 1_000, 3_000)];
    expect(chooseNewest({ lines, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW })).toEqual({
      kind: 'show-existing',
      answerId: 'a1',
    });
    expect(chooseNewest({ lines: [], answeredEnd: null, lastAnswerId: null, now: NOW })).toEqual({
      kind: 'none',
    });
  });

  it('rule 4: listening sounds after the answer are not new speech, but a short question is', () => {
    const okay = [
      line('u1', 'them', 'How do you test your code?', 1_000, 3_000),
      line('u2', 'them', 'Okay.', 9_000, 9_400),
    ];
    expect(
      chooseNewest({ lines: okay, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW }).kind,
    ).toBe('show-existing');
    const why = [...okay.slice(0, 1), line('u2', 'them', 'Why Go?', 9_000, 9_600)];
    expect(
      chooseNewest({ lines: why, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW }),
    ).toMatchObject({
      kind: 'answer',
      text: 'Why Go?',
    });
  });

  it('ADR-0133: a reply no longer ends the window: it goes with the press, for the model to weigh', () => {
    const replied = [
      line('u1', 'them', 'Tell me about your last project.', 1_000, 3_000),
      line('u2', 'you', 'I built a payments service for a bank.', 4_000, 8_000),
      line('u3', 'them', 'What was the hardest part?', 9_000, 11_000),
    ];
    const withReply = chooseNewest({
      lines: replied,
      answeredEnd: null,
      lastAnswerId: null,
      now: NOW,
    });
    expect(withReply).toMatchObject({
      kind: 'answer',
      text: 'Tell me about your last project. What was the hardest part?',
    });
    // Both sides, in time order: the model checks whether the user already answered a question out loud.
    expect(withReply.kind === 'answer' && withReply.window.stretches.map((s) => s.speaker)).toEqual(
      ['them', 'you', 'them'],
    );
    const backchannel = [replied[0]!, line('u2', 'you', 'Mm-hm.', 3_200, 3_500), replied[2]!];
    expect(
      chooseNewest({ lines: backchannel, answeredEnd: null, lastAnswerId: null, now: NOW }),
    ).toMatchObject({
      text: 'Tell me about your last project. What was the hardest part?',
    });
    const over = [
      line(
        'u1',
        'them',
        'Tell me about your last project and the team you led there.',
        1_000,
        6_000,
      ),
      line('u2', 'you', 'So the project was big', 2_000, 4_000),
    ];
    expect(
      chooseNewest({ lines: over, answeredEnd: null, lastAnswerId: null, now: NOW }),
    ).toMatchObject({
      kind: 'answer',
      lineIds: ['u1'],
    });
  });

  it('rule 8 (Batch D, P1-G): only lost audio since the last answer answers the newest words around it', () => {
    const lines = [
      line('u1', 'them', 'How do you test your code?', 1_000, 3_000),
      line('g1', 'them', '[audio gap]', 5_000, 9_000, { gap: true }),
    ];
    // Never notice-only: the words before the gap are answered, the card notes the lost audio, and the
    // span reaches the gap's end so a second press does not answer the same gap again.
    expect(chooseNewest({ lines, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW })).toMatchObject(
      {
        kind: 'answer',
        text: 'How do you test your code?',
        lineIds: ['u1'],
        span: { start: 1_000, end: 9_000 },
        grey: false,
        words: 6,
        segments: 1,
        audioLost: true,
      },
    );
    expect(chooseNewest({ lines, answeredEnd: 9_000, lastAnswerId: 'a2', now: NOW })).toEqual({
      kind: 'show-existing',
      answerId: 'a2',
    });
  });

  it('rule 8 (Batch D, P1-G): new words after a gap are answered with the note; no words at all says so', () => {
    const lines = [
      line('u1', 'them', 'How do you test your code?', 1_000, 3_000),
      line('g1', 'them', '[audio gap]', 5_000, 9_000, { gap: true }),
      line('u2', 'them', 'and in production', 9_000, 10_000),
    ];
    expect(chooseNewest({ lines, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW })).toMatchObject(
      {
        kind: 'answer',
        text: 'and in production',
        audioLost: true,
      },
    );
    // Their words ended long before the gap (more than GAP_CONTEXT_MS): nothing to answer around it.
    const old = [
      line('u1', 'them', 'How do you test your code?', 1_000, 3_000),
      line('g1', 'them', '[audio gap]', 20_000, 24_000, { gap: true }),
    ];
    expect(chooseNewest({ lines: old, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW })).toEqual({
      kind: 'gap',
    });
    // A gap before the user's reply is old news: the reply ended that exchange.
    const replied = [
      line('u1', 'them', 'How do you test your code?', 1_000, 3_000),
      line('g1', 'them', '[audio gap]', 3_000, 4_000, { gap: true }),
      line('y1', 'you', 'I write unit tests first.', 5_000, 7_000),
    ];
    expect(
      chooseNewest({ lines: replied, answeredEnd: 3_000, lastAnswerId: 'a1', now: NOW }),
    ).toEqual({
      kind: 'show-existing',
      answerId: 'a1',
    });
  });

  it('Batch D (P1-G): speech a re-ask took in is answered on its own card when the press passes the own-card end', () => {
    const lines = [
      line('u1', 'them', 'How would you scale it?', 1_000, 3_000),
      line('u2', 'them', 'And what about caching?', 3_800, 5_000),
    ];
    // The re-ask moved the answered end to 5.0 s; the cards of their own end at 3.0 s.
    expect(
      chooseNewest({ lines, answeredEnd: 5_000, lastAnswerId: 'card-1', now: NOW }),
    ).toMatchObject({
      kind: 'show-existing',
    });
    expect(
      chooseNewest({ lines, answeredEnd: 3_000, lastAnswerId: 'card-1', now: NOW }),
    ).toMatchObject({
      kind: 'answer',
      text: 'And what about caching?',
      lineIds: ['u2'],
    });
  });

  it('leaves out another language and the gap mark itself', () => {
    const lines = [
      line('u1', 'them', '[non-English speech]', 1_000, 3_000, { nonEnglish: true }),
      line('g1', 'them', '[audio gap]', 3_000, 4_000, { gap: true }),
    ];
    expect(unansweredSpeech(lines, null)).toEqual([]);
  });
});

describe('autoNewestDue', () => {
  const base = { enabled: true, streaming: false, answeredEnd: null, last: null } as const;

  it("rule 9: answers at the engine's own end of turn, at once", () => {
    const lines = [
      line('u1', 'them', 'How would you scale the service?', 1_000, 3_000, { engineTurnEnd: true }),
    ];
    expect(autoNewestDue({ ...base, lines }, 3_050)).toMatchObject({
      kind: 'answer',
      text: 'How would you scale the service?',
      span: { start: 1_000, end: 3_000 },
    });
  });

  it("rule 9: without the engine's end of turn, waits for the pause; never while they still speak", () => {
    const lines = [line('u1', 'them', 'How would you scale the service?', 1_000, 3_000)];
    expect(autoNewestDue({ ...base, lines }, 3_500)).toBeNull();
    expect(autoNewestDue({ ...base, lines }, 4_300)).toMatchObject({ kind: 'answer' });
    const talking = [...lines, { ...line('u2', 'them', 'and also', 4_000, 4_200), final: false }];
    expect(autoNewestDue({ ...base, lines: talking }, 4_300)).toBeNull();
  });

  it('rule 9: answers questions only, once (after it is answered nothing is due)', () => {
    const statement = [
      line('u1', 'them', 'We ship every week.', 1_000, 3_000, { engineTurnEnd: true }),
    ];
    expect(autoNewestDue({ ...base, lines: statement }, 3_100)).toBeNull();
    const question = [
      line('u1', 'them', 'How would you scale it?', 1_000, 3_000, { engineTurnEnd: true }),
    ];
    expect(autoNewestDue({ ...base, lines: question, answeredEnd: 3_000 }, 3_100)).toBeNull();
    expect(autoNewestDue({ ...base, lines: question, enabled: false }, 3_100)).toBeNull();
    expect(autoNewestDue({ ...base, lines: question, streaming: true }, 3_100)).toBeNull();
  });

  /** The card asked for "How would you scale it?" (u1, 1.0–3.0 s, 5 words). */
  const asked: AnsweredQuestion = {
    answerId: 'card-1',
    lineIds: ['u1'],
    start: 1_000,
    end: 3_000,
    askedAt: 3_100,
    auto: true,
    words: 5,
  };

  it('rule 6: one new word in the same line re-asks, once the turn is over (auto-answer on)', () => {
    const grown = [
      line('u1', 'them', 'How would you scale it globally?', 1_000, 3_600, { engineTurnEnd: true }),
    ];
    expect(
      autoNewestDue({ ...base, lines: grown, answeredEnd: 3_000, last: asked }, 3_700),
    ).toMatchObject({
      kind: 'rerun',
      replaces: 'card-1',
      text: 'How would you scale it globally?',
      words: 6,
      reason: 'grew',
    });
  });

  it('rule 6: speech that goes on within 2 s (a new turn after an early end) re-asks with the whole question', () => {
    const lines = [
      line('u1', 'them', 'How would you scale it?', 1_000, 3_000, { engineTurnEnd: true }),
      line('u2', 'them', 'Say to ten million users?', 3_000 + REASK_WINDOW_MS - 500, 6_000, {
        engineTurnEnd: true,
      }),
    ];
    expect(autoNewestDue({ ...base, lines, answeredEnd: 3_000, last: asked }, 6_100)).toMatchObject(
      {
        kind: 'rerun',
        replaces: 'card-1',
        text: 'How would you scale it? Say to ten million users?',
        lineIds: ['u1', 'u2'],
      },
    );
    // While the continuation is still grey nothing is sent.
    const grey = [lines[0]!, { ...lines[1]!, final: false }];
    expect(
      autoNewestDue({ ...base, lines: grey, answeredEnd: 3_000, last: asked }, 6_100),
    ).toBeNull();
  });

  it('rule 6: a new question long after is its own card, and a reply in between ends the re-ask', () => {
    const later = [
      line('u1', 'them', 'How would you scale it?', 1_000, 3_000, { engineTurnEnd: true }),
      line('u2', 'them', 'What about caching?', 9_000, 10_500, { engineTurnEnd: true }),
    ];
    expect(
      autoNewestDue({ ...base, lines: later, answeredEnd: 3_000, last: asked }, 10_600),
    ).toMatchObject({
      kind: 'answer',
      text: 'What about caching?',
    });
    const replied = [
      later[0]!,
      line('u5', 'you', 'I would shard the database first.', 3_600, 5_000),
      line('u2', 'them', 'Okay and caching?', 5_200, 6_000, { engineTurnEnd: true }),
    ];
    expect(
      autoNewestDue(
        { ...base, enabled: false, lines: replied, answeredEnd: 3_000, last: asked },
        6_100,
      ),
    ).toBeNull();
  });
});

describe('Batch D (P0-B): the re-ask is bounded', () => {
  const base = { streaming: false } as const;
  /** "How would you scale it?" grew by a word, its turn over. */
  const grown = [
    line('u1', 'them', 'How would you scale it globally?', 1_000, 3_600, { engineTurnEnd: true }),
  ];
  /** A press on "How would you scale it?" (final words), 1.0–3.0 s. */
  const press: AnsweredQuestion = {
    answerId: 'card-1',
    lineIds: ['u1'],
    start: 1_000,
    end: 3_000,
    askedAt: 3_100,
    auto: false,
    words: 5,
    anchorStart: 1_000,
    anchorEnd: 3_000,
    reasks: 0,
    askedText: 'How would you scale it?',
  };

  it('auto-answer OFF (D1 a): only a press on grey words is asked again', () => {
    const state = { ...base, enabled: false, lines: grown, answeredEnd: 3_000 };
    // A press on final words, or an auto-answer's card: never re-asked with auto-answer off.
    expect(autoNewestDue({ ...state, last: press }, 3_700)).toBeNull();
    expect(autoNewestDue({ ...state, last: { ...press, auto: true } }, 3_700)).toBeNull();
    // A press on words still being spoken (grey): asked again.
    expect(
      autoNewestDue(
        { ...state, last: { ...press, grey: true, askedText: 'How would you scale', words: 4 } },
        3_700,
      ),
    ).toMatchObject({ kind: 'rerun', replaces: 'card-1' });
  });

  it('auto-answer ON: presses and auto-answers alike are asked again', () => {
    const state = { ...base, enabled: true, lines: grown, answeredEnd: 3_000 };
    expect(autoNewestDue({ ...state, last: press }, 3_700)).toMatchObject({ kind: 'rerun' });
    expect(autoNewestDue({ ...state, last: { ...press, auto: true } }, 3_700)).toMatchObject({
      kind: 'rerun',
    });
  });

  it('at most once per card, with auto-answer on or off', () => {
    for (const enabled of [true, false]) {
      const last = { ...press, grey: true, reasks: 1 };
      expect(
        autoNewestDue({ ...base, enabled, lines: grown, answeredEnd: 3_600, last }, 3_700),
      ).toBeNull();
    }
  });

  it('the window is anchored on the original answer: a re-ask never moves it forward', () => {
    // The 14 Nov chain: the latest re-ask ended at 6.0 s, but the card's original answer ended at 3.0 s.
    const lines = [
      line('u1', 'them', 'How would you scale it?', 1_000, 3_000, { engineTurnEnd: true }),
      line('u2', 'them', 'Say to ten million users?', 4_000, 6_000, { engineTurnEnd: true }),
      line('u3', 'them', 'Next question, what about caching?', 6_500, 8_000, {
        engineTurnEnd: true,
      }),
    ];
    const reasked: AnsweredQuestion = { ...press, end: 6_000, words: 10, reasks: 0 };
    // u3 starts within 2 s of the re-ask's end (6.0 s) but not of the original's (3.0 s): not a re-ask.
    const due = autoNewestDue(
      { ...base, enabled: true, lines, answeredEnd: 6_000, last: reasked },
      8_100,
    );
    expect(due?.kind).not.toBe('rerun');
  });

  it('a question of its own after a 2.5 s pause is the next question (the legacy rule)', () => {
    const lines = [
      line('u1', 'them', 'How would you scale it?', 1_000, 3_000, { engineTurnEnd: true }),
      line('u2', 'them', 'What about caching?', 5_600, 7_000, { engineTurnEnd: true }),
    ];
    // A wider window would take u2 in; the 2.5 s rule still keeps it out.
    expect(reaskSpeech(lines, press, 5_000).map((item) => item.lineId)).toEqual(['u1']);
    // Not a question of its own (it finishes the sentence): kept.
    const finishing = [lines[0]!, line('u2', 'them', 'for ten million users.', 5_600, 7_000)];
    expect(reaskSpeech(finishing, press, 5_000).map((item) => item.lineId)).toEqual(['u1', 'u2']);
  });
});

describe('Batch D (P0-C): a new question gets a new card', () => {
  it('finishesSameSentence: only the end of a sentence left open', () => {
    expect(finishesSameSentence('How would you', 'How would you scale it?', 3)).toBe(true);
    expect(finishesSameSentence('How would you', 'How would you scale it', 3)).toBe(true);
    // The first request ended a sentence.
    expect(finishesSameSentence('How would you scale it?', 'How would you scale it? Why?', 5)).toBe(
      false,
    );
    // The added words hold a second sentence.
    expect(
      finishesSameSentence('How would you', 'How would you scale it? And what about caching?', 3),
    ).toBe(false);
    // Unknown first words: never the same sentence.
    expect(finishesSameSentence(undefined, 'anything', 0)).toBe(false);
  });

  it('autoNewestDue says whether the re-ask only finishes the sentence', () => {
    const asked: AnsweredQuestion = {
      answerId: 'card-1',
      lineIds: ['u1'],
      start: 1_000,
      end: 2_000,
      askedAt: 2_100,
      auto: false,
      grey: true,
      words: 3,
      anchorStart: 1_000,
      anchorEnd: 2_000,
      reasks: 0,
      askedText: 'How would you',
    };
    const finished = [
      line('u1', 'them', 'How would you scale it?', 1_000, 3_000, { engineTurnEnd: true }),
    ];
    expect(
      autoNewestDue(
        { enabled: false, streaming: false, lines: finished, answeredEnd: 2_000, last: asked },
        3_100,
      ),
    ).toMatchObject({ kind: 'rerun', sameSentence: true, reason: 'grew' });
    const newQuestion = [
      line('u1', 'them', 'How would you scale it?', 1_000, 2_000, { engineTurnEnd: true }),
      line('u2', 'them', 'And what about caching?', 2_800, 4_000, { engineTurnEnd: true }),
    ];
    expect(
      autoNewestDue(
        {
          enabled: true,
          streaming: false,
          lines: newQuestion,
          answeredEnd: 2_000,
          last: { ...asked, askedText: 'How would you scale it?', words: 5 },
        },
        4_100,
      ),
    ).toMatchObject({ kind: 'rerun', sameSentence: false, reason: 'went-on' });
  });
});
