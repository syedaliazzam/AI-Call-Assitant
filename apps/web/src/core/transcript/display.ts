/**
 * File: apps/web/src/core/transcript/display.ts
 * Purpose: Prepares transcript lines for display: splits very long lines into shorter ones, and
 *          writes lines in sentence case with the session's own spellings (Day 6 Stage 4d). Display
 *          only: the stored line (and what answers and notes use) is unchanged.
 * Used by: src/features/live/TranscriptStrip.tsx, src/features/live/SavedTranscript.tsx,
 *          src/core/transcript/group.ts,
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
import { parseKeyTerms } from '@kite/shared';
import { spokenVariants } from '../stt/spokenNumbers';
import type { Session } from '../storage/types';
import type { Utterance } from './transcript';

/**
 * A spelling to restore in a displayed line: either a plain term (matched and shown as itself), or
 * a [pattern, replacement] pair, which shows the typed spelling where the recognizer wrote the
 * spoken form of a number (ADR-0027): ['BM TWENTY FIVE', 'BM25'].
 */
export type DisplayTerm = string | readonly [pattern: string, replacement: string];

/**
 * A display term as a [pattern, replacement] pair (a plain term is its own replacement).
 *
 * @param term The display term.
 * @returns The pattern to match and the text to show.
 * Called from: sentenceCase()
 */
function termPair(term: DisplayTerm): readonly [string, string] {
  return typeof term === 'string' ? [term, term] : term;
}

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
 * A term that contains a digit also adds a pair for each spoken-word variant the recognizer might
 * have written (ADR-0027), so "BM25" is restored from "BM TWENTY FIVE" (and "BM TWO FIVE").
 *
 * @param session The session's company and key terms.
 * @returns The terms and spoken-form pairs, longest pattern first (so "Bluefin Route" wins over
 *          "Route", and "BM TWENTY FIVE" over "TWENTY").
 * Called from: LivePage.tsx, SessionReview.tsx (passed to the transcript components)
 */
export function displayTerms(
  session: Pick<Session, 'company'> & { preferences: Pick<Session['preferences'], 'keyTerms'> },
): DisplayTerm[] {
  const typed = [session.company, ...parseKeyTerms(session.preferences.keyTerms)]
    .map((term) => term.replace(/\s*:\s*[\d.]+\s*$/, '').trim())
    .filter((term) => /[A-Za-z]/.test(term) && term.length <= 50);
  const terms: DisplayTerm[] = [];
  const seen = new Set<string>();
  for (const term of typed) {
    if (!seen.has(term.toLowerCase())) {
      seen.add(term.toLowerCase());
      terms.push(term);
      // Map each spoken reading of the term's numbers back to the typed spelling.
      for (const variant of spokenVariants(term)) terms.push([variant, term] as const);
    }
  }
  const pattern = (term: DisplayTerm) => (typeof term === 'string' ? term : term[0]);
  return terms.sort((a, b) => pattern(b).length - pattern(a).length);
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
 * Whether a word is written in capitals: it has a letter and no lower-case letter ("WHAT",
 * "I'M", "AWS"). Words without letters ("25", "-") are neither.
 *
 * @param word One word.
 * @returns True for an all-capitals word.
 * Called from: lowerCapitalRuns()
 */
function isCapitalWord(word: string): boolean {
  return /\p{Lu}/u.test(word) && !/\p{Ll}/u.test(word);
}

/**
 * Lower-cases the all-capitals stretches of a line that also has lower-case letters (v1.0.2). A
 * line becomes mixed when the accurate engine (ADR-0034) rewrote the words one utterance added
 * to a merged line: the live engine's part is in capitals, the refined part is cased. A stretch
 * counts when it has 3 or more capital words, or 2 where one is longer than 4 letters
 * ("THANK YOU"); shorter pairs ("AWS API") and single words are taken for acronyms and kept.
 * A lowered stretch that starts the line or follows ".", "?" or "!" gets a capital first letter.
 *
 * @param text A line with some lower-case letters.
 * @returns The line with its shouted stretches in lower case.
 * Called from: caseLine()
 */
function lowerCapitalRuns(text: string): string {
  // Words and the white space between them, so the line is put back exactly as it was.
  const parts = text.split(/(\s+)/);
  /** Indexes (into parts) of the current run of capital words. */
  let run: number[] = [];
  const flush = () => {
    const long = run.some((index) => parts[index]!.replace(/[^\p{L}]/gu, '').length > 4);
    if (run.length >= 3 || (run.length === 2 && long)) {
      for (const index of run) parts[index] = parts[index]!.toLowerCase();
      // A new sentence (or the line's start) begins with a capital letter.
      const before = parts.slice(0, run[0]).join('').trimEnd();
      if (before === '' || /[.?!]$/.test(before)) {
        parts[run[0]!] = parts[run[0]!]!.replace(/\p{Ll}/u, (letter) => letter.toUpperCase());
      }
    }
    run = [];
  };
  parts.forEach((part, index) => {
    if (index % 2 === 1 || part === '') return; // white space
    if (isCapitalWord(part)) run.push(index);
    // A word with no letters (a number) neither starts nor ends a run.
    else if (/\p{L}/u.test(part)) flush();
  });
  flush();
  return parts.join('');
}

/**
 * Writes a transcript line for display: lower-cases capitals, restores the session's spellings
 * and capitalises "I"; with capitalizeFirst, also the first letter.
 *
 * @param text            The line as the engine wrote it.
 * @param terms           Spellings to restore (displayTerms()), longest pattern first.
 * @param capitalizeFirst True to start with a capital (a line or sentence of its own).
 * @returns The line for display.
 * Called from: sentenceCase(), continuationCase()
 */
function caseLine(text: string, terms: readonly DisplayTerm[], capitalizeFirst: boolean): string {
  // All capitals: the live engine's line. Mixed: an accurate rewrite inside a merged line.
  let line = /\p{Ll}/u.test(text) ? lowerCapitalRuns(text) : text.toLowerCase();
  for (const term of terms) {
    const [pattern, replacement] = termPair(term);
    // Whole words only: "route" inside "routes" or "reroute" is left alone.
    line = line.replace(
      new RegExp(`(?<![\\w'])${escapeRegExp(pattern)}(?![\\w'])`, 'gi'),
      () => replacement,
    );
  }
  line = line.replace(/(?<![\w'])i(?=$|[\s'’,.?!])/g, 'I');
  if (!capitalizeFirst) return line;
  return line.replace(
    /^(\s*)([a-z])/,
    (_match, space: string, letter: string) => space + letter.toUpperCase(),
  );
}

/**
 * Writes a transcript line in sentence case for display (Day 6 Stage 4d): the speech model
 * writes all capitals and no punctuation, which is hard to read. An all-capitals line is
 * lower-cased; then the session's own spellings of its terms are restored, "I" (and I'm, I'll,
 * I've, I'd) is capitalised, and so is the first letter. A line that already has lower-case
 * letters (an engine that writes case) keeps its case, except for long all-capitals stretches
 * left by the live engine in a partly refined line (v1.0.2: lowerCapitalRuns()). Display only:
 * the stored line, and what answers and notes use, are unchanged.
 *
 * @param text  The line as the engine wrote it.
 * @param terms Spellings to restore (displayTerms()), longest pattern first.
 * @returns The line for display.
 * Called from: TranscriptStrip.tsx, SavedTranscript.tsx, ReviewSections.tsx (ConversationSection),
 *              core/transcript/group.ts
 */
export function sentenceCase(text: string, terms: readonly DisplayTerm[] = []): string {
  return caseLine(text, terms, true);
}

/**
 * Writes a line that continues the sentence before it (v1.0.2 transcript bubbles): as
 * sentenceCase(), but the first letter keeps the case the line gives it, so a live-engine line
 * that carries on after a pause reads "…tell me about your project", not "…tell me About".
 *
 * @param text  The line as the engine wrote it.
 * @param terms Spellings to restore (displayTerms()), longest pattern first.
 * @returns The line for display.
 * Called from: core/transcript/group.ts
 */
export function continuationCase(text: string, terms: readonly DisplayTerm[] = []): string {
  return caseLine(text, terms, false);
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
  terms: readonly DisplayTerm[] = [],
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
