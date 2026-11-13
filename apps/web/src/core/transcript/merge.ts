/**
 * File: apps/web/src/core/transcript/merge.ts
 * Purpose: The rule for joining close-together lines in the transcript: a final line from the
 *          same speaker that starts within 1.5 s of the previous final line continues that line
 *          instead of starting a new one. Partial (grey) text never merges. Speech-to-text ends an
 *          utterance after about a second of silence, so one spoken sentence with a short pause
 *          would otherwise show as two lines.
 *          v1.4 (ADR-0062): when the earlier line sounds cut off ("…and what you would change
 *          about"), the pause may be up to 4 s; and the other person's blips in between ("okay",
 *          "um") do not stop the join (transcript.ts skips them).
 * Used by: src/core/transcript/transcript.ts, stability.ts
 * Depends on: src/core/transcript/transcript.ts (Utterance type only), questionKind.ts (looksGarbled),
 *             complete.ts (looksUnfinished), src/core/stt/language.ts (NON_ENGLISH_TEXT)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2, §7.1 (core/transcript)
 */
import { NON_ENGLISH_TEXT } from '../stt/language';
import { looksUnfinished } from './complete';
import { looksGarbled } from './questionKind';
import type { Speaker, Utterance } from './transcript';

/** Largest gap (ms) between two final lines of the same speaker that still merges them. */
export const MERGE_GAP_MS = 1_500;

/** v1.4: the largest gap (ms) when the earlier line sounds cut off in the middle (complete.ts). */
export const UNFINISHED_MERGE_GAP_MS = 4_000;

/** A new final line, before it has an id. */
export interface FinalLine {
  /** Who spoke. */
  speaker: Speaker;
  /** What was said. Never logged. */
  text: string;
  /** Start (Unix ms, capture time). */
  tStart: number;
  /** End (Unix ms, capture time). */
  tEnd: number;
  /** v1.4: true when the line is speech in another language (its text is NON_ENGLISH_TEXT). */
  nonEnglish?: boolean;
  /** ADR-0076: the speech engine's own end of turn ended it (Flux EndOfTurn). */
  endOfTurn?: boolean;
}

/**
 * The largest pause after a line that still joins the same speaker's next line to it.
 *
 * @param previous The earlier line.
 * @returns UNFINISHED_MERGE_GAP_MS when it sounds cut off, otherwise MERGE_GAP_MS.
 * Called from: shouldMerge(); stability.ts; tests
 */
export function mergeGapFor(previous: Pick<Utterance, 'text' | 'nonEnglish'>): number {
  if (previous.nonEnglish) return MERGE_GAP_MS;
  return looksUnfinished(previous.text) ? UNFINISHED_MERGE_GAP_MS : MERGE_GAP_MS;
}

/**
 * Tells whether a new final line continues the previous one.
 *
 * @param previous The same speaker's line just before it (or undefined at the start). The caller
 *                 has already checked that only the other person's blips lie between them.
 * @param next     The new final line.
 * @param gapMs    Largest gap that still merges (default: mergeGapFor(previous)).
 * @returns True only for two finals from the same speaker close enough together.
 * Called from: Transcript.addFinal(); tests
 */
export function shouldMerge(
  previous: Utterance | undefined,
  next: FinalLine,
  gapMs?: number,
): boolean {
  if (!previous || !previous.final) return false;
  if (previous.speaker !== next.speaker) return false;
  // ADR-0076: a mark of lost audio stays a line of its own.
  if (previous.gap) return false;
  // Noise stays apart from speech, so it can collapse and a question stays clean (v1.1.0).
  if (looksGarbled(previous.text) !== looksGarbled(next.text)) return false;
  // Another language stays apart from English (v1.4), so a question next to it stays clean.
  if (Boolean(previous.nonEnglish) !== Boolean(next.nonEnglish)) return false;
  const gap = next.tStart - previous.tEnd;
  return gap <= (gapMs ?? mergeGapFor(previous));
}

/**
 * Joins a final line onto the previous one.
 *
 * @param previous The earlier line (keeps its id and start time).
 * @param next     The line that continues it.
 * @returns The merged line (a new object; the inputs are not changed).
 * Called from: Transcript.addFinal(); tests
 */
export function mergeLines(previous: Utterance, next: FinalLine): Utterance {
  const { engineTurnEnd: _was, ...rest } = previous;
  void _was;
  return {
    ...rest,
    // Two stretches of another language read as one mark, not the mark twice.
    text: previous.nonEnglish ? NON_ENGLISH_TEXT : `${previous.text} ${next.text}`.trim(),
    tStart: Math.min(previous.tStart, next.tStart),
    tEnd: Math.max(previous.tEnd, next.tEnd),
    // ADR-0076 (E3 rule 3): each stretch keeps its own times, so new words after an answered stretch can
    // be found even inside one joined line.
    segments: [
      ...(previous.segments ?? [
        { text: previous.text, tStart: previous.tStart, tEnd: previous.tEnd },
      ]),
      { text: next.text, tStart: next.tStart, tEnd: next.tEnd },
    ],
    // ADR-0076: whether the speaker finished is what the newest stretch says.
    ...(next.endOfTurn ? { engineTurnEnd: true } : {}),
  };
}
