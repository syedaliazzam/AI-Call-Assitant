/**
 * Tests for apps/web/src/core/transcript/merge.ts:
 * shouldMerge() joins a final line onto the previous final line only for the same speaker and a
 * gap of at most 1.5 s, never onto a partial line or another speaker's line; mergeLines() keeps
 * the earlier id and start, joins the text and takes the later end.
 */
import { describe, expect, it } from 'vitest';
import { MERGE_GAP_MS, mergeLines, shouldMerge } from '@/core/transcript/merge';
import type { Utterance } from '@/core/transcript/transcript';

/** A stored final line from "them", 1 000–2 000 ms. */
const PREVIOUS: Utterance = {
  id: 'u1',
  speaker: 'them',
  text: 'What would the rollout',
  tStart: 1_000,
  tEnd: 2_000,
  final: true,
};

/** A new final line from `speaker` starting at `tStart`. */
const next = (speaker: 'you' | 'them', tStart: number) => ({
  speaker,
  text: 'x',
  tStart,
  tEnd: tStart + 1_000,
});

describe('shouldMerge', () => {
  it('merges the same speaker within 1.5 s, and not later', () => {
    expect(shouldMerge(PREVIOUS, next('them', 2_000 + MERGE_GAP_MS))).toBe(true);
    expect(shouldMerge(PREVIOUS, next('them', 2_000 + MERGE_GAP_MS + 1))).toBe(false);
  });

  it('never merges another speaker, a partial line, or the first line', () => {
    expect(shouldMerge(PREVIOUS, next('you', 2_100))).toBe(false);
    expect(shouldMerge({ ...PREVIOUS, final: false }, next('them', 2_100))).toBe(false);
    expect(shouldMerge(undefined, next('them', 2_100))).toBe(false);
  });
});

describe('mergeLines', () => {
  it('keeps the id and start, joins the text and takes the later end', () => {
    const merged = mergeLines(PREVIOUS, {
      speaker: 'them',
      text: 'timeline be?',
      tStart: 2_400,
      tEnd: 3_500,
    });
    expect(merged).toEqual({
      ...PREVIOUS,
      text: 'What would the rollout timeline be?',
      tEnd: 3_500,
    });
    expect(PREVIOUS.text).toBe('What would the rollout');
  });
});
