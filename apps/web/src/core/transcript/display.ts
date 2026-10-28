/**
 * File: apps/web/src/core/transcript/display.ts
 * Purpose: Splits very long transcript lines into shorter ones for display, so the strip stays
 *          easy to read. Display only: the stored line (and what answers use) is unchanged.
 * Used by: src/features/live/TranscriptStrip.tsx
 * Depends on: src/core/transcript/transcript.ts (Utterance type)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Why by length and not by sentence: the speech model writes no punctuation, so sentences
 * cannot be found. A line longer than MAX_LINE_MS (20 s) or MAX_LINE_WORDS (35 words, about two
 * spoken sentences) is cut into equal parts. The model gives no per-word times, so each part's
 * start and end are estimated in proportion to its words.
 */
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
