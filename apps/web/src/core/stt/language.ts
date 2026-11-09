/**
 * File: apps/web/src/core/stt/language.ts
 * Purpose: Spots a final line that is very likely speech in another language (for example Urdu or
 *          Hindi), which the English-only speech model can only turn into unrelated English words
 *          (v1.4, ADR-0062). Such a line is shown and sent as "[non-English speech]" and is never taken
 *          as a question. It uses how sure the model was (its per-token log probabilities) together
 *          with how few everyday English words the line holds: real English, even misheard, is full
 *          of words like "the", "and", "you".
 * Used by: src/features/live/LivePage.tsx (onFinal), tests/integration harness (stt:calls)
 * Depends on: src/core/stt/protocol.ts (LineConfidence)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2; ADR-0062
 *
 * Calibrated on 9 Nov 2026 (real worker, Chromium): 0 of 30 synthetic English lines and 1 of 41 lines of
 * the developer's own name-heavy accented English (the names set, the hardest English we have) were
 * flagged; 21 of 30 lines of romanised Urdu spoken by the English voices were flagged. Careful on purpose:
 * replacing real English is the worse mistake. Transcript text is never logged.
 */
import type { LineConfidence } from './protocol';

/** What a line marked as another language reads as, everywhere (screen, saved lines, Claude). */
export const NON_ENGLISH_TEXT = '[non-English speech]';

/** Fewest words for a line to be judged (a short line is too little to tell). */
export const NON_ENGLISH_MIN_WORDS = 5;

/** The model's mean log probability per word piece must be below this. */
export const NON_ENGLISH_MAX_MEAN_LOG_PROB = -0.75;

/** More than this share of word pieces must be unsure (protocol.ts LOW_TOKEN_LOG_PROB). */
export const NON_ENGLISH_MIN_LOW_SHARE = 0.3;

/** Fewer than this share of the words may be everyday English words. */
export const NON_ENGLISH_MAX_COMMON_SHARE = 0.25;

/**
 * Everyday English words (the same list as questionKind.ts's COMMON_WORDS): speech in English has them,
 * even when some words are misheard.
 */
const COMMON_WORDS = new Set(
  (
    'the a an and or but so if then of to in on at for from with by about as into over after before ' +
    'i you we they he she it this that these those there here my your our their his her its ' +
    'is are was were be been being am do does did have has had will would can could should may might must ' +
    'what how why when where who which not no yes all some any more most very just also like get got go ' +
    'going make made need want know think see say said tell work use one two time way out up down'
  ).split(' '),
);

/**
 * The share of a line's words that are everyday English words.
 *
 * @param text The line.
 * @returns 0…1 (0 for no words).
 * Called from: looksNonEnglish(); tests
 */
export function commonWordShare(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return 0;
  return words.filter((word) => COMMON_WORDS.has(word)).length / words.length;
}

/**
 * Whether a final line is very likely another language.
 *
 * @param line.text       The line as the live engine wrote it.
 * @param line.confidence How sure the engine was (absent: never judged, the line is kept as it is).
 * @returns True to mark it as "[non-English speech]".
 * Called from: LivePage.tsx (onFinal); the stt:calls harness; tests
 */
export function looksNonEnglish(line: { text: string; confidence?: LineConfidence }): boolean {
  const { confidence } = line;
  if (!confidence) return false;
  const words = line.text.trim().split(/\s+/).filter(Boolean).length;
  return (
    words >= NON_ENGLISH_MIN_WORDS &&
    confidence.meanLogProb < NON_ENGLISH_MAX_MEAN_LOG_PROB &&
    confidence.lowShare > NON_ENGLISH_MIN_LOW_SHARE &&
    commonWordShare(line.text) < NON_ENGLISH_MAX_COMMON_SHARE
  );
}
