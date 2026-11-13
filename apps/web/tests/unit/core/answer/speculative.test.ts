/**
 * Tests apps/web/src/core/answer/speculative.ts (Batch C, P1-1): a speculative auto-answer is held hidden for
 * 400 ms; it is shown when the hold ends with nothing new said; it is cancelled silently (never shown) when
 * the other person goes on within the hold; a press shows it at once; a newer hold cancels the older one;
 * every step reaches the trace. themWentOn() tells new speech after the asked lines (a new turn, or an asked
 * line that grew) from what does not count (listening sounds, the user, lost audio, the asked lines as they
 * were).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createSpeculativeHold,
  SPECULATIVE_HOLD_MS,
  themWentOn,
  type HoldTimers,
} from '@/core/answer/speculative';
import type { Utterance } from '@/core/transcript/transcript';

/**
 * Fake timers driven by hand.
 *
 * @returns The timers, a clock and a way to move time on.
 */
function manualTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const timers: HoldTimers = {
    set: (run, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, run });
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...pending]) {
      if (timer.at <= now) {
        pending.delete(id);
        timer.run();
      }
    }
  };
  return { timers, advance, clock: () => now };
}

/**
 * A hold with spies.
 *
 * @returns The hold, its spies and the time controls.
 */
function setup() {
  const time = manualTimers();
  const onShow = vi.fn();
  const onCancel = vi.fn();
  const onTrace = vi.fn();
  const hold = createSpeculativeHold({ timers: time.timers, now: time.clock, onTrace });
  /**
   * Starts holding an answer, reporting to the spies with its id.
   *
   * @param answerId The answer.
   * @returns Nothing.
   */
  const start = (answerId: string) =>
    hold.start(answerId, {
      onShow: () => onShow(answerId),
      onCancel: () => onCancel(answerId),
    });
  return { hold, start, onShow, onCancel, onTrace, ...time };
}

describe('createSpeculativeHold', () => {
  it('holds for 400 ms, then shows the card', () => {
    const { hold, start, onShow, onCancel, advance } = setup();
    start('a1');
    expect(hold.holding('a1')).toBe(true);
    advance(SPECULATIVE_HOLD_MS - 1);
    expect(onShow).not.toHaveBeenCalled();
    advance(1);
    expect(onShow).toHaveBeenCalledWith('a1');
    expect(onCancel).not.toHaveBeenCalled();
    expect(hold.holding()).toBe(false);
  });

  it('cancels silently when the other person goes on within the hold', () => {
    const { hold, start, onShow, onCancel, advance } = setup();
    start('a1');
    advance(250);
    expect(hold.activity()).toBe(true);
    expect(onCancel).toHaveBeenCalledWith('a1');
    // The timer is gone: the card is never shown.
    advance(1_000);
    expect(onShow).not.toHaveBeenCalled();
  });

  it('ignores activity after the card was shown (the re-ask rule takes over then)', () => {
    const { hold, start, onCancel, advance } = setup();
    start('a1');
    advance(SPECULATIVE_HOLD_MS);
    expect(hold.activity()).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows the card at once when the user presses Answer during the hold', () => {
    const { hold, start, onShow, advance } = setup();
    start('a1');
    advance(100);
    expect(hold.release()).toBe(true);
    expect(onShow).toHaveBeenCalledTimes(1);
    advance(1_000);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(hold.release()).toBe(false);
  });

  it('cancels an older hold when a newer one starts', () => {
    const { start, onCancel, onShow, advance } = setup();
    start('a1');
    advance(100);
    start('a2');
    expect(onCancel).toHaveBeenCalledWith('a1');
    advance(SPECULATIVE_HOLD_MS);
    expect(onShow).toHaveBeenCalledWith('a2');
    expect(onShow).not.toHaveBeenCalledWith('a1');
  });

  it('drop() forgets the hold without showing or cancelling', () => {
    const { hold, start, onCancel, onShow, advance } = setup();
    start('a1');
    hold.drop();
    advance(1_000);
    expect(onShow).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(hold.activity()).toBe(false);
  });

  it('traces held, then shown or cancelled, with how long after the start', () => {
    const { hold, start, onTrace, advance } = setup();
    start('a1');
    advance(SPECULATIVE_HOLD_MS);
    start('a2');
    advance(120);
    hold.activity();
    expect(onTrace.mock.calls).toEqual([
      ['held', 'a1', 0],
      ['shown', 'a1', SPECULATIVE_HOLD_MS],
      ['held', 'a2', 0],
      ['cancelled', 'a2', 120],
    ]);
  });
});

/**
 * A transcript line.
 *
 * @param fields The line's fields.
 * @returns The line.
 */
function line(fields: Partial<Utterance> & Pick<Utterance, 'id' | 'speaker' | 'text'>): Utterance {
  return { tStart: 0, tEnd: 1_000, final: true, ...fields } as Utterance;
}

describe('themWentOn', () => {
  const asked = { lineIds: ['u1'], end: 10_000, lineWords: 6 };
  const question = line({
    id: 'u1',
    speaker: 'them',
    text: 'How would you design a cache?',
    tStart: 7_000,
    tEnd: 10_000,
  });

  it('is false while nothing new was said', () => {
    expect(themWentOn([question], asked)).toBe(false);
  });

  it('is true for new words of theirs after the asked speech (a new turn)', () => {
    const more = line({
      id: 'u2',
      speaker: 'them',
      text: 'and keep it consistent',
      tStart: 10_300,
      tEnd: 10_600,
      final: false,
    });
    expect(themWentOn([question, more], asked)).toBe(true);
  });

  it('is true when an asked line grew', () => {
    const grown = { ...question, text: 'How would you design a cache for reads?' };
    expect(themWentOn([grown], asked)).toBe(true);
  });

  it('ignores listening sounds, the user, and marks of lost audio', () => {
    const lines = [
      question,
      line({ id: 'u2', speaker: 'them', text: 'mm-hm', tStart: 10_200, tEnd: 10_400 }),
      line({
        id: 'u3',
        speaker: 'you',
        text: 'So I would start with',
        tStart: 10_500,
        tEnd: 11_000,
      }),
      line({
        id: 'g1',
        speaker: 'them',
        text: '[audio gap]',
        tStart: 10_500,
        tEnd: 12_000,
        gap: true,
      }),
    ];
    expect(themWentOn(lines, asked)).toBe(false);
  });

  it('ignores their earlier speech (before the asked speech ended)', () => {
    const earlier = line({
      id: 'u0',
      speaker: 'them',
      text: 'Next question.',
      tStart: 5_000,
      tEnd: 6_000,
    });
    expect(themWentOn([earlier, question], asked)).toBe(false);
  });
});
