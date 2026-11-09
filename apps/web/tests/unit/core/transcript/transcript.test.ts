/**
 * Tests for apps/web/src/core/transcript/transcript.ts:
 * a partial line replaces the speaker's previous partial and '' removes it; a final line removes
 * that speaker's partial; lines() is in time order even when finals arrive out of order (the two
 * channels finish at different times), mixes in partial lines by start time and keeps the same
 * array until something changes; close finals from the same speaker merge, but not across the
 * other speaker; window() keeps the last N minutes; clear() empties it; subscribers are told
 * about every change and can unsubscribe. Echo (Day 2): a "You" line that repeats what "Them"
 * just said is hidden from lines() and window(), counted, and kept in allLines(); it is also caught
 * when the "Them" line arrives after it, and a grey "You" echo is hidden too; short replies and
 * "Them" lines are never hidden; an echo does not merge with real lines. Display hold (Day 2):
 * while "Them" is speaking, a new "You" line is left out of displayLines() for 1.5 s, then shown
 * unless it turned out to be an echo; when "Them" is quiet it shows at once; lines() is never held.
 */
import { describe, expect, it, vi } from 'vitest';
import { createTranscript, DISPLAY_HOLD_MS, THEM_ACTIVE_MS } from '@/core/transcript/transcript';

/**
 * A transcript whose clock is fixed.
 *
 * @param now The fixed time, Unix ms (default 100 000).
 * @returns The transcript.
 */
function setup(now = 100_000) {
  return createTranscript(() => now);
}

describe('createTranscript', () => {
  it('replaces a speaker partial line, and removes it on "" or a final line', () => {
    const t = setup();
    t.addPartial('them', 'what', 1_000);
    t.addPartial('them', 'what would', 1_000);
    expect(t.lines()).toEqual([
      expect.objectContaining({ id: 'partial-them', text: 'what would', final: false }),
    ]);
    t.addPartial('them', '', null);
    expect(t.lines()).toEqual([]);
    t.addPartial('you', 'hello', 5_000);
    t.addFinal({ speaker: 'you', text: 'hello there', tStart: 5_000, tEnd: 6_000 });
    expect(t.lines()).toEqual([
      expect.objectContaining({ id: 'u1', text: 'hello there', final: true }),
    ]);
  });

  it('keeps time order when finals arrive out of order, with partial lines by start time', () => {
    const t = setup();
    t.addFinal({ speaker: 'you', text: 'second', tStart: 5_000, tEnd: 6_000 });
    t.addFinal({ speaker: 'them', text: 'first', tStart: 1_000, tEnd: 3_000 });
    t.addPartial('them', 'third', 9_000);
    t.addPartial('you', 'between', 7_000);
    expect(t.lines().map((line) => line.text)).toEqual(['first', 'second', 'between', 'third']);
  });

  it('merges close finals of the same speaker, but not across the other speaker', () => {
    const t = setup();
    t.addFinal({ speaker: 'them', text: 'what would the rollout', tStart: 1_000, tEnd: 2_000 });
    const merged = t.addFinal({ speaker: 'them', text: 'timeline be', tStart: 2_800, tEnd: 4_000 });
    expect(merged).toMatchObject({
      id: 'u1',
      text: 'what would the rollout timeline be',
      tEnd: 4_000,
    });
    t.addFinal({ speaker: 'you', text: 'about six weeks', tStart: 4_500, tEnd: 6_000 });
    t.addFinal({ speaker: 'them', text: 'great', tStart: 6_500, tEnd: 7_000 });
    expect(t.lines().map((line) => [line.speaker, line.text])).toEqual([
      ['them', 'what would the rollout timeline be'],
      ['you', 'about six weeks'],
      ['them', 'great'],
    ]);
  });

  it('returns the same lines array until something changes', () => {
    const t = setup();
    t.addFinal({ speaker: 'you', text: 'a', tStart: 1_000, tEnd: 2_000 });
    const first = t.lines();
    expect(t.lines()).toBe(first);
    t.addPartial('them', 'b', 3_000);
    expect(t.lines()).not.toBe(first);
  });

  it('window() keeps lines that ended in the last N minutes', () => {
    const now = 10 * 60_000;
    const t = setup(now);
    t.addFinal({ speaker: 'them', text: 'old', tStart: 0, tEnd: 1_000 });
    t.addFinal({ speaker: 'you', text: 'recent', tStart: now - 60_000, tEnd: now - 50_000 });
    expect(t.window(3).map((line) => line.text)).toEqual(['recent']);
    expect(t.window(10).map((line) => line.text)).toEqual(['old', 'recent']);
  });

  it('clears, and tells subscribers about every change until they unsubscribe', () => {
    const t = setup();
    const listener = vi.fn();
    const unsubscribe = t.subscribe(listener);
    t.addPartial('you', 'hi', 1_000);
    t.addFinal({ speaker: 'you', text: 'hi', tStart: 1_000, tEnd: 1_500 });
    t.clear();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(t.lines()).toEqual([]);
    unsubscribe();
    t.addPartial('you', 'again', 2_000);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  describe('echo', () => {
    const THEM = 'NOW THIS MIGHT SOUND TRIVIAL AND NOT REALLY EXISTENTIAL AT ALL';
    const ECHO = 'AND THIS MIGHT SOUND TRIVIAL AND NOT REALLY EXISTENTIAL AT ALL';

    it('hides a You line that repeats what Them just said, and counts it', () => {
      const t = setup();
      t.addFinal({ speaker: 'them', text: THEM, tStart: 10_000, tEnd: 14_000 });
      const stored = t.addFinal({ speaker: 'you', text: ECHO, tStart: 10_300, tEnd: 14_400 });
      expect(stored.echo).toBe(true);
      expect(t.lines().map((line) => line.speaker)).toEqual(['them']);
      expect(t.window(10).map((line) => line.speaker)).toEqual(['them']);
      expect(t.allLines()).toHaveLength(2);
      expect(t.echoStats()).toEqual({ count: 1, lastAt: 14_400 });
    });

    it('also catches the echo when the Them line becomes final after it', () => {
      const t = setup();
      t.addPartial('them', 'NOW THIS MIGHT SOUND', 10_000);
      t.addFinal({ speaker: 'you', text: ECHO, tStart: 10_300, tEnd: 14_400 });
      t.addFinal({ speaker: 'them', text: THEM, tStart: 10_000, tEnd: 14_000 });
      expect(t.lines().map((line) => line.speaker)).toEqual(['them']);
      expect(t.echoStats().count).toBe(1);
    });

    it('hides a grey You line that is an echo of the grey Them line', () => {
      const t = setup(20_000);
      t.addPartial('them', THEM, 10_000);
      t.addPartial('you', ECHO, 10_300);
      expect(t.lines().map((line) => line.id)).toEqual(['partial-them']);
    });

    it('keeps short genuine replies and every Them line', () => {
      const t = setup();
      t.addFinal({ speaker: 'them', text: 'YES EXACTLY', tStart: 1_000, tEnd: 2_000 });
      t.addFinal({ speaker: 'you', text: 'YES EXACTLY', tStart: 2_200, tEnd: 3_000 });
      t.addFinal({ speaker: 'them', text: 'YES EXACTLY', tStart: 3_200, tEnd: 4_000 });
      // v1.4: the reply is kept (it came after "Them" stopped, so it is no echo), and the two "Them"
      // lines join across it, because a two-word reply is a blip that does not cut their speech.
      expect(t.lines().map((line) => line.speaker)).toEqual(['them', 'you']);
      expect(t.lines()[0]!.text).toBe('YES EXACTLY YES EXACTLY');
      expect(t.echoStats().count).toBe(0);
    });

    it('does not merge an echo into a real line, nor a real line into an echo', () => {
      const t = setup();
      t.addFinal({ speaker: 'you', text: 'LET ME CHECK', tStart: 1_000, tEnd: 2_000 });
      t.addFinal({ speaker: 'them', text: THEM, tStart: 2_100, tEnd: 6_000 });
      t.addFinal({ speaker: 'you', text: ECHO, tStart: 2_400, tEnd: 6_300 });
      expect(t.lines().map((line) => line.text)).toEqual(['LET ME CHECK', THEM]);
    });
  });

  describe('display hold', () => {
    /**
     * A transcript with a clock and timers the test controls.
     *
     * @param start Start time, Unix ms (default 50 000).
     * @returns The transcript and advance() to move time on.
     */
    function controlled(start = 50_000) {
      let now = start;
      const timers: { at: number; run: () => void }[] = [];
      const t = createTranscript(() => now, {
        schedule: (run, ms) => {
          const timer = { at: now + ms, run };
          timers.push(timer);
          return () => timers.splice(timers.indexOf(timer), 1);
        },
      });
      /**
       * Moves the clock on and runs the timers that are due.
       *
       * @param ms How far to move, in ms.
       */
      const advance = (ms: number) => {
        now += ms;
        for (const timer of timers.filter((entry) => entry.at <= now)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.run();
        }
      };
      return { t, advance };
    }
    const THEM = 'NOW THIS MIGHT SOUND TRIVIAL AND NOT REALLY EXISTENTIAL AT ALL';
    const ECHO = 'AND THIS MIGHT SOUND TRIVIAL AND NOT REALLY EXISTENTIAL AT ALL';

    it('while Them speaks, holds a new You line for 1.5 s, then shows it (lines() is not held)', () => {
      const { t, advance } = controlled();
      const listener = vi.fn();
      t.subscribe(listener);
      t.addPartial('them', 'SO WHAT IS THE PLAN', 49_000);
      t.addFinal({ speaker: 'you', text: 'LET ME SHARE MY SCREEN', tStart: 49_500, tEnd: 50_000 });
      expect(t.displayLines().map((line) => line.speaker)).toEqual(['them']);
      expect(t.lines().map((line) => line.speaker)).toEqual(['them', 'you']);
      advance(DISPLAY_HOLD_MS - 1);
      expect(t.displayLines().some((line) => line.speaker === 'you')).toBe(false);
      const calls = listener.mock.calls.length;
      advance(1);
      expect(t.displayLines().map((line) => line.speaker)).toEqual(['them', 'you']);
      expect(listener.mock.calls.length).toBe(calls + 1);
    });

    it('never shows a held You line that turns out to be an echo', () => {
      const { t, advance } = controlled();
      t.addPartial('them', 'NOW THIS MIGHT', 49_000);
      t.addFinal({ speaker: 'you', text: ECHO, tStart: 49_300, tEnd: 50_000 });
      expect(t.displayLines().some((line) => line.speaker === 'you')).toBe(false);
      advance(800);
      t.addFinal({ speaker: 'them', text: THEM, tStart: 49_000, tEnd: 50_000 });
      advance(DISPLAY_HOLD_MS);
      expect(t.displayLines().map((line) => line.speaker)).toEqual(['them']);
      expect(t.echoStats().count).toBe(1);
    });

    it('shows a You line at once when Them is quiet', () => {
      const { t, advance } = controlled();
      t.addFinal({ speaker: 'them', text: 'ANY QUESTIONS', tStart: 40_000, tEnd: 41_000 });
      advance(THEM_ACTIVE_MS + 1);
      t.addPartial('you', 'YES ONE', 52_100);
      expect(t.displayLines().map((line) => line.speaker)).toEqual(['them', 'you']);
      t.addFinal({ speaker: 'you', text: 'YES ONE QUESTION', tStart: 52_100, tEnd: 53_000 });
      expect(t.displayLines().map((line) => line.text)).toEqual([
        'ANY QUESTIONS',
        'YES ONE QUESTION',
      ]);
    });

    it('keeps holding a grey You line that started during Them speech when it becomes final', () => {
      const { t, advance } = controlled();
      t.addPartial('them', 'SO WHAT IS THE PLAN', 49_000);
      t.addPartial('you', 'LET ME', 49_500);
      advance(500);
      t.addFinal({ speaker: 'you', text: 'LET ME SHARE', tStart: 49_500, tEnd: 50_400 });
      expect(t.displayLines().some((line) => line.speaker === 'you')).toBe(false);
      advance(DISPLAY_HOLD_MS - 500);
      expect(t.displayLines().some((line) => line.speaker === 'you')).toBe(true);
    });
  });
  describe('v1.4 (ADR-0062)', () => {
    it("joins the other person's lines across the user's blip, and keeps the blip", () => {
      const t = setup();
      t.addFinal({
        speaker: 'them',
        text: 'TELL ME ABOUT A TIME A DEPLOYMENT WENT WRONG',
        tStart: 1_000,
        tEnd: 4_000,
      });
      t.addFinal({ speaker: 'you', text: 'UM', tStart: 4_200, tEnd: 4_400 });
      t.addFinal({
        speaker: 'them',
        text: 'AND HOW YOU FOUND THE CAUSE',
        tStart: 5_000,
        tEnd: 7_000,
      });
      expect(t.lines().map((line) => line.speaker)).toEqual(['them', 'you']);
      expect(t.lines()[0]!.text).toBe(
        'TELL ME ABOUT A TIME A DEPLOYMENT WENT WRONG AND HOW YOU FOUND THE CAUSE',
      );
    });

    it('does not join across a real reply from the user', () => {
      const t = setup();
      t.addFinal({ speaker: 'them', text: 'HOW BIG IS THE TEAM', tStart: 1_000, tEnd: 2_000 });
      t.addFinal({ speaker: 'you', text: 'ABOUT TWELVE PEOPLE', tStart: 2_200, tEnd: 3_000 });
      t.addFinal({ speaker: 'them', text: 'WHO DO YOU REPORT TO', tStart: 3_200, tEnd: 4_000 });
      expect(t.lines().map((line) => line.speaker)).toEqual(['them', 'you', 'them']);
    });

    it('waits up to 4 s to join after a line that sounds cut off, 1.5 s otherwise', () => {
      const cut = setup();
      cut.addFinal({
        speaker: 'them',
        text: 'COULD YOU WALK ME THROUGH THE SYSTEM AND',
        tStart: 1_000,
        tEnd: 3_000,
      });
      cut.addFinal({ speaker: 'them', text: 'WHAT YOU WOULD CHANGE', tStart: 6_500, tEnd: 8_000 });
      expect(cut.lines()).toHaveLength(1);
      const done = setup();
      done.addFinal({ speaker: 'them', text: 'HOW BIG IS THE TEAM', tStart: 1_000, tEnd: 3_000 });
      done.addFinal({ speaker: 'them', text: 'WHO DO YOU REPORT TO', tStart: 6_500, tEnd: 8_000 });
      expect(done.lines()).toHaveLength(2);
    });

    it('stores another language as its mark, never joins it with English, and never refines it', () => {
      const t = setup();
      t.addFinal({
        speaker: 'them',
        text: 'MERA NAAM HAI PICHLE SAAL',
        tStart: 1_000,
        tEnd: 3_000,
        nonEnglish: true,
      });
      t.addFinal({ speaker: 'them', text: 'SO HOW BIG IS THE TEAM', tStart: 3_500, tEnd: 5_000 });
      expect(t.lines().map((line) => line.text)).toEqual([
        '[non-English speech]',
        'SO HOW BIG IS THE TEAM',
      ]);
      expect(t.lines()[0]!.nonEnglish).toBe(true);
      expect(t.refineFinal(t.lines()[0]!.id, '[non-English speech]', 'MY NAME IS')).toBe(false);
    });

    it('hides the user own voice coming back on "Them", without counting it as speaker echo', () => {
      const t = setup();
      t.addFinal({
        speaker: 'you',
        text: 'I LED THE MIGRATION TO KUBERNETES LAST YEAR',
        tStart: 1_000,
        tEnd: 4_000,
      });
      t.addFinal({
        speaker: 'them',
        text: 'I LED THE MIGRATION TO KUBERNETES',
        tStart: 1_500,
        tEnd: 4_300,
      });
      expect(t.lines().map((line) => line.speaker)).toEqual(['you']);
      expect(t.allLines().find((line) => line.speaker === 'them')?.hiddenAs).toBe('you-echo');
      expect(t.echoStats().count).toBe(0);
    });

    it('keeps a "Them" line that ends with its leaked copy on "You" (speakers, not a network echo)', () => {
      const t = setup();
      t.addFinal({
        speaker: 'you',
        text: 'SORRY CAN YOU REPEAT THAT HOW DO YOU DECIDE WHAT GETS TESTED',
        tStart: 1_000,
        tEnd: 6_100,
      });
      t.addFinal({
        speaker: 'them',
        text: 'HOW DO YOU DECIDE WHAT GETS TESTED',
        tStart: 3_500,
        tEnd: 6_000,
      });
      expect(t.lines().some((line) => line.speaker === 'them')).toBe(true);
    });

    it('hides a one-word noise on "You" inside "Them" speech, but keeps a short answer', () => {
      const t = setup();
      t.addFinal({
        speaker: 'them',
        text: 'WALK ME THROUGH THE ARCHITECTURE OF THE BILLING SYSTEM',
        tStart: 1_000,
        tEnd: 6_000,
      });
      t.addFinal({ speaker: 'you', text: 'A', tStart: 2_000, tEnd: 2_300 });
      t.addFinal({ speaker: 'you', text: 'OKAY', tStart: 4_000, tEnd: 4_300 });
      expect(t.lines().map((line) => line.text)).toEqual([
        'WALK ME THROUGH THE ARCHITECTURE OF THE BILLING SYSTEM',
        'OKAY',
      ]);
    });

    it('marks a line while the accurate engine rewrites it', () => {
      const t = setup();
      const line = t.addFinal({
        speaker: 'them',
        text: 'HOW BIG IS THE TEAM',
        tStart: 1_000,
        tEnd: 2_000,
      });
      t.setRefining(line.id, true);
      expect(t.lines()[0]!.refining).toBe(true);
      t.setRefining(line.id, false);
      expect(t.lines()[0]!.refining).toBeUndefined();
    });
  });
});
