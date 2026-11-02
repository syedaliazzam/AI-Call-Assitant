/**
 * File: apps/web/src/core/transcript/display.ts
 * Purpose: Prepares transcript lines for display: splits very long lines into shorter ones, and
 *          writes lines in sentence case with the session's own spellings (Day 6 Stage 4d). Display
 *          only: the stored line (and what answers and notes use) is unchanged.
 * Used by: src/features/live/TranscriptStrip.tsx, src/features/live/SavedTranscript.tsx,
 *          src/features/review/ReviewSections.tsx, src/features/live/LivePage.tsx,
 *          src/features/review/SessionReview.tsx
 * Depends on: src/core/transcript/transcript.ts (Utterance type), src/core/storage/types.ts (Session)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Why by length and not by sentence: the speech model writes no punctuation, so sentences
 * cannot be found. A line longer than MAX_LINE_MS (20 s) or MAX_LINE_WORDS (35 words, about two
 * spoken sentences) is cut into equal parts. The model gives no per-word times, so each part's
 * start and end are estimated in proportion to its words.
 */
import type { Session } from '../storage/types';
import type { Utterance } from './transcript';

/** Longest line shown in one piece, in ms. */
export const MAX_LINE_MS = 20_000;

/** Most words shown in one piece (about two spoken sentences). */
export const MAX_LINE_WORDS = 35;

/**
 * Splits a line into display parts when it is too long or too wordy.
 *
 * @param line The transcript line.
 * @returns The line itself (one element) or its parts. Parts get ids `<id>#<n>`, keep the
 *          speaker and `final`, and have estimated times.
 * Called from: TranscriptStrip.tsx; tests
 */
export function splitForDisplay(line: Utterance): Utterance[] {
  const words = line.text.split(/\s+/).filter(Boolean);
  const duration = Math.max(0, line.tEnd - line.tStart);
  const parts = Math.max(
    Math.ceil(duration / MAX_LINE_MS),
    Math.ceil(words.length / MAX_LINE_WORDS),
    1,
  );
  if (parts === 1 || words.length < 2) return [line];

  const count = Math.min(parts, words.length);
  const size = Math.ceil(words.length / count);
  const result: Utterance[] = [];
  for (let start = 0, n = 0; start < words.length; start += size, n += 1) {
    const end = Math.min(words.length, start + size);
    result.push({
      ...line,
      id: `${line.id}#${n}`,
      text: words.slice(start, end).join(' '),
      tStart: Math.round(line.tStart + (duration * start) / words.length),
      tEnd: Math.round(line.tStart + (duration * end) / words.length),
    });
  }
  return result;
}

/**
 * The spellings to restore in displayed lines: the session's key terms (one per line, without a
 * typed " :score") and its company, as the user wrote them (Day 6 Stage 4d).
 *
 * @param session The session's company and key terms.
 * @returns The terms, longest first (so "Bluefin Route" wins over "Route").
 * Called from: LivePage.tsx, SessionReview.tsx (passed to the transcript components)
 */
export function displayTerms(
  session: Pick<Session, 'company'> & { preferences: Pick<Session['preferences'], 'keyTerms'> },
): string[] {
  const terms = [session.company, ...session.preferences.keyTerms.split(/\r?\n/)]
    .map((term) => term.replace(/\s*:\s*[\d.]+\s*$/, '').trim())
    .filter((term) => /[A-Za-z]/.test(term) && term.length <= 50);
  return [...new Set(terms)].sort((a, b) => b.length - a.length);
}

/**
 * Escapes text for use inside a regular expression.
 *
 * @param text Any text.
 * @returns The text with every regular-expression character escaped.
 * Called from: sentenceCase()
 */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Writes a transcript line in sentence case for display (Day 6 Stage 4d): the speech model
 * writes all capitals and no punctuation, which is hard to read. An all-capitals line is
 * lower-cased; then the session's own spellings of its terms are restored, "I" (and I'm, I'll,
 * I've, I'd) is capitalised, and so is the first letter. A line that already has lower-case
 * letters (an engine that writes case) keeps its case. Display only: the stored line, and what
 * answers and notes use, are unchanged.
 *
 * @param text  The line as the engine wrote it.
 * @param terms Spellings to restore (displayTerms()), longest first.
 * @returns The line for display.
 * Called from: TranscriptStrip.tsx, SavedTranscript.tsx, ReviewSections.tsx (ConversationSection)
 */
export function sentenceCase(text: string, terms: readonly string[] = []): string {
  let line = /[a-z]/.test(text) ? text : text.toLowerCase();
  for (const term of terms) {
    // Whole words only: "route" inside "routes" or "reroute" is left alone.
    line = line.replace(new RegExp(`(?<![\\w'])${escapeRegExp(term)}(?![\\w'])`, 'gi'), () => term);
  }
  line = line.replace(/(?<![\w'])i(?=$|[\s'’,.?!])/g, 'I');
  return line.replace(
    /^(\s*)([a-z])/,
    (_match, space: string, letter: string) => space + letter.toUpperCase(),
  );
}

/** Words in one transcript chip (the overlay shows the latest words as small chips). */
export const CHIP_WORDS = 3;

/** One chip of the overlay's transcript bar. */
export interface TranscriptChip {
  /** Stable id: the line's id and the chip's place in the line. */
  id: string;
  /** The words. */
  text: string;
  /** Who said them. */
  speaker: Utterance['speaker'];
}

/**
 * The latest words as chips, newest last: each line in sentence case, cut every CHIP_WORDS
 * words. Ids stay the same as a line grows, so Clear can hide what was on screen.
 *
 * @param lines The visible lines, in order.
 * @param terms Spellings to restore (displayTerms()).
 * @param max   Most chips.
 * @returns The chips.
 * Called from: LiveAnswers.tsx (the overlay's state); tests
 */
export function transcriptChips(
  lines: readonly Utterance[],
  terms: readonly string[] = [],
  max = 6,
): TranscriptChip[] {
  const chips: TranscriptChip[] = [];
  for (let l = lines.length - 1; l >= 0 && chips.length < max; l -= 1) {
    const line = lines[l]!;
    const words = sentenceCase(line.text, terms).split(/\s+/).filter(Boolean);
    const lineChips: TranscriptChip[] = [];
    for (let i = 0; i < words.length; i += CHIP_WORDS) {
      lineChips.push({
        id: `${line.id}:${i / CHIP_WORDS}`,
        text: words.slice(i, i + CHIP_WORDS).join(' '),
        speaker: line.speaker,
      });
    }
    chips.unshift(...lineChips);
  }
  return chips.slice(-max);
}
