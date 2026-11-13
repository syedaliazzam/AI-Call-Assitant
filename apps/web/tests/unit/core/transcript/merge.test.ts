/**
 * Tests for apps/web/src/core/transcript/merge.ts:
 * shouldMerge() joins a final line onto the previous final line only for the same speaker and a
 * gap of at most 1.5 s, never onto a partial line or another speaker's line; mergeLines() keeps
 * the earlier id and start, joins the text and takes the later end.
 */
import { describe, expect, it } from 'vitest';
import {
  MERGE_GAP_MS,
  mergeGapFor,
  mergeLines,
  shouldMerge,
  UNFINISHED_MERGE_GAP_MS,
} from '@/core/transcript/merge';
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

/**
 * A new final line.
 *
 * @param speaker Who spoke.
 * @param tStart  When it started (Unix ms).
 * @returns The line, as addFinal() receives it.
 */
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
      // ADR-0076: each stretch keeps its own times.
      segments: [
        { text: PREVIOUS.text, tStart: PREVIOUS.tStart, tEnd: PREVIOUS.tEnd },
        { text: 'timeline be?', tStart: 2_400, tEnd: 3_500 },
      ],
    });
    expect(PREVIOUS.text).toBe('What would the rollout');
  });
});

describe('noise and speech (v1.1.0, ADR-0044)', () => {
  it('never merges them, however close', () => {
    const line = (text: string) => ({
      id: 'u1',
      speaker: 'them' as const,
      text,
      final: true,
      tStart: 0,
      tEnd: 1_000,
    });
    const next = { speaker: 'them' as const, tStart: 1_100, tEnd: 2_000 };
    const noise = 'GRONK BLIMP SPROCKET WIBBLE FLANGE';
    expect(shouldMerge(line('WHAT DOES IT COST'), { ...next, text: noise })).toBe(false);
    expect(shouldMerge(line(noise), { ...next, text: 'WHAT DOES IT COST' })).toBe(false);
    expect(shouldMerge(line('WHAT DOES IT COST'), { ...next, text: 'FOR FORTY SEATS' })).toBe(true);
  });
});

describe('v1.4 (ADR-0062): cut-off lines and another language', () => {
  it('waits 4 s after a line that sounds cut off, 1.5 s otherwise', () => {
    expect(mergeGapFor({ text: 'Could you walk me through the system and' })).toBe(
      UNFINISHED_MERGE_GAP_MS,
    );
    expect(mergeGapFor({ text: 'How big is the team?' })).toBe(MERGE_GAP_MS);
    const cut = { ...PREVIOUS, text: 'Tell me about the' };
    expect(shouldMerge(cut, next('them', 2_000 + UNFINISHED_MERGE_GAP_MS))).toBe(true);
    expect(shouldMerge(cut, next('them', 2_001 + UNFINISHED_MERGE_GAP_MS))).toBe(false);
  });

  it('never joins another language with English, and joins two stretches into one mark', () => {
    const other = { ...PREVIOUS, text: '[non-English speech]', nonEnglish: true };
    expect(shouldMerge(other, next('them', 2_500))).toBe(false);
    const more = { ...next('them', 2_500), text: '[non-English speech]', nonEnglish: true };
    expect(shouldMerge(other, more)).toBe(true);
    expect(mergeLines(other, more).text).toBe('[non-English speech]');
  });
});
