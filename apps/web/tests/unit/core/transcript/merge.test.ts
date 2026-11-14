/**
 * Tests for apps/web/src/core/transcript/merge.ts:
 * shouldMerge() joins a final line onto the previous final line only for the same speaker and a
 * gap of at most 1.5 s, never onto a partial line or another speaker's line; mergeLines() keeps
 * the earlier id and start, joins the text and takes the later end. Batch D (P1-D): otherSpeakerBetween()
 * finds a real line of the other speaker ending between two lines (never the other speaker's blips, hidden
 * echo or noise lines, or marks of lost audio).
 */
import { describe, expect, it } from 'vitest';
import {
  MERGE_GAP_MS,
  mergeGapFor,
  mergeLines,
  otherSpeakerBetween,
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

describe('Batch D (P1-D): otherSpeakerBetween', () => {
  /**
   * A final "You" line.
   *
   * @param text   Its words.
   * @param tStart Start (ms).
   * @param tEnd   End (ms).
   * @param extra  More fields (echo, gap).
   * @returns The line.
   */
  const you = (text: string, tStart: number, tEnd: number, extra: Partial<Utterance> = {}) =>
    ({ id: 'y', speaker: 'you', text, tStart, tEnd, final: true, ...extra }) as Utterance;
  // The next "Them" stretch "starts" 0.1 s after the previous ends (the 14 Nov Flux start), ends at 9 s.
  const later = { speaker: 'them' as const, tEnd: 9_000 };

  it('finds a reply that ended between the two, whatever the next line says its start is', () => {
    expect(
      otherSpeakerBetween([you('I built the pipeline myself', 3_000, 6_000)], PREVIOUS, later),
    ).toBe(true);
  });

  it('ignores blips, hidden echo or noise, marks of lost audio, grey lines and lines outside', () => {
    expect(otherSpeakerBetween([you('okay', 3_000, 3_500)], PREVIOUS, later)).toBe(false);
    expect(
      otherSpeakerBetween(
        [you('I built the pipeline', 3_000, 6_000, { echo: true })],
        PREVIOUS,
        later,
      ),
    ).toBe(false);
    expect(
      otherSpeakerBetween([you('[audio gap]', 3_000, 6_000, { gap: true })], PREVIOUS, later),
    ).toBe(false);
    expect(
      otherSpeakerBetween(
        [you('I built the pipeline', 3_000, 6_000, { final: false })],
        PREVIOUS,
        later,
      ),
    ).toBe(false);
    // Ended before the earlier line ended, or after the new one ended.
    expect(otherSpeakerBetween([you('I built the pipeline', 500, 1_900)], PREVIOUS, later)).toBe(
      false,
    );
    expect(otherSpeakerBetween([you('I built the pipeline', 8_000, 9_500)], PREVIOUS, later)).toBe(
      false,
    );
    // The same speaker's lines never count.
    expect(
      otherSpeakerBetween(
        [{ ...you('more of the question here', 3_000, 6_000), speaker: 'them' }],
        PREVIOUS,
        later,
      ),
    ).toBe(false);
  });
});
