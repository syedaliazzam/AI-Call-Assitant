/**
 * Tests for apps/web/src/core/stt/language.ts (v1.4, ADR-0062): a line is marked as another language only
 * when it is long enough, the model was unsure of it, and it holds few everyday English words; English,
 * even when the model was unsure, short lines, and lines without a confidence are never marked. All
 * text is invented (the "Urdu" lines are what an English-only model writes for it).
 */
import { describe, expect, it } from 'vitest';
import { commonWordShare, looksNonEnglish, NON_ENGLISH_TEXT } from '@/core/stt/language';

/** A confidence like the calibration's other-language lines (romanised Urdu read by an English voice). */
const UNSURE = { tokens: 20, meanLogProb: -0.95, lowShare: 0.45 };
/** A confidence like the synthetic English lines. */
const SURE = { tokens: 20, meanLogProb: -0.3, lowShare: 0.03 };

describe('looksNonEnglish', () => {
  it('marks a long, unsure line with few everyday English words', () => {
    expect(
      looksNonEnglish({ text: 'MERA NAAM HAI PICHLE SAAL KAAM KAR RAHA', confidence: UNSURE }),
    ).toBe(true);
  });

  it('keeps English even when the model was unsure (accents, names)', () => {
    expect(
      looksNonEnglish({
        text: 'WE MOVED THE BILLING EXPORT TO NORTHWIND LAST YEAR',
        confidence: UNSURE,
      }),
    ).toBe(false);
  });

  it('keeps sure lines, short lines, and lines with no confidence', () => {
    const text = 'MERA NAAM HAI PICHLE SAAL KAAM KAR RAHA';
    expect(looksNonEnglish({ text, confidence: SURE })).toBe(false);
    expect(looksNonEnglish({ text: 'MERA NAAM HAI', confidence: UNSURE })).toBe(false);
    expect(looksNonEnglish({ text })).toBe(false);
  });

  it('reads as the mark everywhere', () => {
    expect(NON_ENGLISH_TEXT).toBe('[non-English speech]');
  });
});

describe('commonWordShare', () => {
  it('counts everyday English words', () => {
    expect(commonWordShare('THE PLAN AND THE TEAM')).toBeCloseTo(0.6);
    expect(commonWordShare('')).toBe(0);
  });
});
