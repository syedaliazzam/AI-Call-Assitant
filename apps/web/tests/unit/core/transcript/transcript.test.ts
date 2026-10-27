/**
 * Tests for apps/web/src/core/transcript/transcript.ts:
 * a partial line replaces the speaker's previous partial and '' removes it; a final line removes
 * that speaker's partial; lines() is in time order even when finals arrive out of order (the two
 * channels finish at different times), mixes in partial lines by start time and keeps the same
 * array until something changes; close finals from the same speaker merge, but not across the
 * other speaker; window() keeps the last N minutes; clear() empties it; subscribers are told
 * about every change and can unsubscribe.
 */
import { describe, expect, it, vi } from 'vitest';
import { createTranscript } from '@/core/transcript/transcript';

/** A transcript whose clock is fixed at `now` (Unix ms). */
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
});
