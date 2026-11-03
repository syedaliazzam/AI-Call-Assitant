/**
 * Tests for apps/web/src/core/transcript/display.ts:
 * a short line is shown as it is; a line over 20 s or over 35 words is split into equal parts
 * with ids <id>#n, the same speaker, all the words in order, and times spread across the line.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_LINE_WORDS,
  displayTerms,
  sentenceCase,
  splitForDisplay,
} from '@/core/transcript/display';
import type { Utterance } from '@/core/transcript/transcript';

/**
 * A final "Them" line, for testing how long lines are split for display.
 *
 * @param words Number of words.
 * @param ms    How long the line lasted, in ms.
 * @returns The line.
 */
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

describe('number terms in display (ADR-0027)', () => {
  it('maps a spoken number back to its typed spelling, longest pattern first', () => {
    const terms = displayTerms({
      company: 'Northwind',
      preferences: { keyTerms: 'BM25\nH100' },
    });
    // The recognizer wrote the spoken form; display shows the typed spelling.
    expect(sentenceCase('WE RANKED WITH BM TWENTY FIVE', terms)).toBe('We ranked with BM25');
    expect(sentenceCase('THE H ONE HUNDRED IS FAST', terms)).toBe('The H100 is fast');
  });

  it('leaves a line without a number term unchanged but for sentence case', () => {
    const terms = displayTerms({ company: 'Northwind', preferences: { keyTerms: 'BM25' } });
    expect(sentenceCase('WE MET THE TEAM', terms)).toBe('We met the team');
  });
});
