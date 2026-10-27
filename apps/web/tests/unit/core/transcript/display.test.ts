/**
 * Tests for apps/web/src/core/transcript/display.ts:
 * a short line is shown as it is; a line over 20 s or over 35 words is split into equal parts
 * with ids <id>#n, the same speaker, all the words in order, and times spread across the line.
 */
import { describe, expect, it } from 'vitest';
import { MAX_LINE_WORDS, splitForDisplay } from '@/core/transcript/display';
import type { Utterance } from '@/core/transcript/transcript';

/** A final "Them" line with `words` words over `ms` milliseconds. */
function line(words: number, ms: number): Utterance {
  return {
    id: 'u7',
    speaker: 'them',
    text: Array.from({ length: words }, (_, i) => `w${i}`).join(' '),
    tStart: 1_000,
    tEnd: 1_000 + ms,
    final: true,
  };
}

describe('splitForDisplay', () => {
  it('keeps a short line as it is', () => {
    const short = line(12, 5_000);
    expect(splitForDisplay(short)).toEqual([short]);
  });

  it('splits a line longer than 20 s, keeping every word in order', () => {
    const long = line(30, 45_000);
    const parts = splitForDisplay(long);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.id)).toEqual(['u7#0', 'u7#1', 'u7#2']);
    expect(parts.map((p) => p.text).join(' ')).toBe(long.text);
    expect(parts.every((p) => p.speaker === 'them' && p.final)).toBe(true);
    expect(parts[0]!.tStart).toBe(1_000);
    expect(parts.at(-1)!.tEnd).toBe(46_000);
    expect(parts[1]!.tStart).toBe(parts[0]!.tEnd);
  });

  it('splits a line with more than 35 words even when it is quick', () => {
    const wordy = line(MAX_LINE_WORDS + 5, 15_000);
    const parts = splitForDisplay(wordy);
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.text).join(' ')).toBe(wordy.text);
  });
});
