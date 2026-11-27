/**
 * Tests for the key-press window and the one update of a press made while the other person was speaking
 * (apps/web/src/core/answer/newestQuestion.ts pressWindow(), chooseNewest(), pressUpdateDue(); ADR-0132,
 * ADR-0133), and toPressContext() in apps/web/src/core/answer/context.ts. Covered: both sides since the last
 * answer, in time order, with the user's replies kept; listening sounds left out; grey words included and
 * marked; a long stretch that began before the window cut by time; the word and time caps; "still speaking";
 * the update: waits for their turn to end, updates once when they went on at once, stops when the user
 * speaks, when the new words start late, or after the watch runs out. All words are invented.
 */
import { MAX_PRESS_WINDOW_WORDS, PRESS_WINDOW_MS } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { toPressContext } from '@/core/answer/context';
import {
  chooseNewest,
  PRESS_UPDATE_MAX_MS,
  pressUpdateDue,
  pressWindow,
  type PressWatch,
} from '@/core/answer/newestQuestion';
import type { Utterance } from '@/core/transcript/transcript';

/** The call's clock: second s, as Unix ms. */
const T = 1_800_000_000_000;
const at = (seconds: number) => T + seconds * 1_000;

/**
 * A transcript line.
 *
 * @param id      Its id.
 * @param speaker Who spoke.
 * @param text    Its words.
 * @param start   Start, s.
 * @param end     End, s.
 * @param extra   More fields (final: false for a grey line).
 * @returns The line.
 */
function line(
  id: string,
  speaker: 'you' | 'them',
  text: string,
  start: number,
  end: number,
  extra: Partial<Utterance> = {},
): Utterance {
  return { id, speaker, text, tStart: at(start), tEnd: at(end), final: true, ...extra };
}

/** Ten invented words, a sentence of real speech (made-up tokens read as garbled speech). */
const SENTENCE = 'The northern depots ship every order before noon on weekdays. ';

describe('pressWindow (ADR-0133)', () => {
  it('holds both sides since the last answer, in time order, with the user reply kept', () => {
    const lines = [
      line('t0', 'them', 'How did the pilot go last month?', 1, 4),
      line('t1', 'them', 'Which depots joined the pilot?', 20, 23),
      line('y1', 'you', 'The two northern depots joined it in May.', 24, 28),
      line('t2', 'them', 'Mm-hm.', 28.5, 29),
      line('t3', 'them', 'And who signs off the next phase?', 30, 33),
    ];
    // The answer before covered speech up to 4 s: the window starts there.
    const window = pressWindow(lines, at(4), at(40));
    expect(window.stretches.map((s) => [s.speaker, s.text])).toEqual([
      ['them', 'Which depots joined the pilot?'],
      ['you', 'The two northern depots joined it in May.'],
      // "Mm-hm." is listening, not speech: left out, so their two stretches stay apart around the reply.
      ['them', 'And who signs off the next phase?'],
    ]);
    expect(window.themText).toBe(
      'Which depots joined the pilot? And who signs off the next phase?',
    );
    expect(window.themLineIds).toEqual(['t1', 't3']);
    expect(window.themSpan).toEqual({ start: at(20), end: at(33) });
    expect(window.speaking).toBe(false);
  });

  it('marks grey words and says the other side is still speaking', () => {
    const lines = [
      line('t1', 'them', 'So is doing that together part of', 10, 14, { final: false }),
    ];
    const window = pressWindow(lines, null, at(14.5));
    expect(window.grey).toBe(true);
    expect(window.speaking).toBe(true);
    expect(window.stretches[0]!.live).toBe(true);
    // Final words that ended under SPEAKING_GAP_MS ago count as still speaking too.
    expect(
      pressWindow([line('t1', 'them', 'We add two teams.', 10, 14)], null, at(15)).speaking,
    ).toBe(true);
    expect(
      pressWindow([line('t1', 'them', 'We add two teams.', 10, 14)], null, at(20)).speaking,
    ).toBe(false);
  });

  it('cuts a long stretch that began before the window by time, and drops one barely inside it', () => {
    const words = SENTENCE.repeat(10).trim();
    // 100 words over 100 s; the window starts at 50 s: the later half is sent.
    const window = pressWindow([line('t1', 'them', words, 0, 100)], at(50), at(101));
    expect(window.themText.startsWith('The northern depots')).toBe(true);
    expect(window.themWords).toBe(50);
    // Less than a second of it inside the window: nothing new.
    expect(pressWindow([line('t1', 'them', words, 0, 100)], at(99.5), at(101)).themSpan).toBeNull();
  });

  it('keeps at most PRESS_WINDOW_MS back and the newest MAX_PRESS_WINDOW_WORDS words', () => {
    const old = line('t0', 'them', 'An old question from long ago?', 0, 3);
    const many = SENTENCE.repeat(60).trim();
    const lines = [old, line('t1', 'them', many, 400, 560)];
    const window = pressWindow(lines, null, at(570));
    expect(window.from).toBe(at(570) - PRESS_WINDOW_MS);
    expect(window.stretches).toHaveLength(1);
    const sent = window.stretches[0]!.text.split(' ');
    expect(sent).toHaveLength(MAX_PRESS_WINDOW_WORDS);
    expect(sent.at(-1)).toBe('weekdays.');
  });

  it('becomes the request press context: still speaking, and questions left open', () => {
    const lines = [line('t1', 'them', 'Which depots joined', 20, 23, { final: false })];
    expect(toPressContext(pressWindow(lines, null, at(23.5)))).toEqual({ speaking: true });
    expect(toPressContext(pressWindow([], null, at(30)), ' Pricing and SSO ')).toEqual({
      speaking: false,
      stillOpen: 'Pricing and SSO',
    });
  });
});

describe('chooseNewest with the window (ADR-0133)', () => {
  it('sends several questions of theirs together, with the window', () => {
    const lines = [
      line('t1', 'them', 'What does the judge step check?', 10, 13),
      line('t2', 'them', 'And are we on the same page about the rollout?', 14, 18),
    ];
    const choice = chooseNewest({ lines, answeredEnd: null, lastAnswerId: null, now: at(30) });
    expect(choice.kind).toBe('answer');
    if (choice.kind !== 'answer') return;
    expect(choice.text).toBe(
      'What does the judge step check? And are we on the same page about the rollout?',
    );
    expect(choice.window.stretches).toHaveLength(1);
  });
});

describe('pressUpdateDue (ADR-0132)', () => {
  /** A press at 14.5 s while they were saying a statement; the question was still being transcribed. */
  const asked = [line('t1', 'them', 'We will add two more customers next month.', 10, 14)];
  const watch: PressWatch = {
    answerId: 'card-1',
    pressedAt: at(14.5),
    from: at(0),
    themWords: 8,
    themEnd: at(14),
  };

  it('waits while nothing new came, and while their turn is not over', () => {
    expect(pressUpdateDue(watch, asked, at(15)).kind).toBe('wait');
    const going = [
      ...asked,
      line('t2', 'them', 'Is running one together part of', 14.3, 16, { final: false }),
    ];
    expect(pressUpdateDue(watch, going, at(16.2)).kind).toBe('wait');
  });

  it('updates once their turn is over, with the whole window', () => {
    const done = [
      ...asked,
      line('t2', 'them', 'Is running one together part of the next phase?', 14.3, 17),
    ];
    // The pause after a finished question (AUTO_PAUSE_MS) has not passed yet.
    expect(pressUpdateDue(watch, done, at(17.5)).kind).toBe('wait');
    const due = pressUpdateDue(watch, done, at(18.5));
    expect(due.kind).toBe('update');
    if (due.kind !== 'update') return;
    expect(due.window.themText).toContain('part of the next phase?');
    // At the engine's own end of turn there is no pause to wait for.
    const ended = [{ ...done[0]! }, { ...done[1]!, engineTurnEnd: true }];
    expect(pressUpdateDue(watch, ended, at(17.1)).kind).toBe('update');
  });

  it('never updates once the user speaks, when they start something new late, or after the watch ends', () => {
    const reading = [
      ...asked,
      line('t2', 'them', 'Is running one together part of the next phase?', 14.3, 17),
      line('y1', 'you', 'Yes, we can run the first one together.', 15, 18),
    ];
    expect(pressUpdateDue(watch, reading, at(19))).toEqual({ kind: 'stop', reason: 'user-spoke' });
    const late = [...asked, line('t2', 'them', 'Another thing about invoices?', 20, 22)];
    expect(pressUpdateDue(watch, late, at(22.3))).toEqual({ kind: 'stop', reason: 'late' });
    expect(pressUpdateDue(watch, asked, at(14.5) + PRESS_UPDATE_MAX_MS + 1)).toEqual({
      kind: 'stop',
      reason: 'expired',
    });
  });
});
