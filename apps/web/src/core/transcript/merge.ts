/**
 * File: apps/web/src/core/transcript/merge.ts
 * Purpose: The rule for joining close-together lines in the transcript: a final line from the
 *          same speaker that starts within 1.5 s of the previous final line (with nobody else in
 *          between) continues that line instead of starting a new one. Partial (grey) text never
 *          merges. Speech-to-text ends an utterance after about a second of silence, so one
 *          spoken sentence with a short pause would otherwise show as two lines.
 * Used by: src/core/transcript/transcript.ts
 * Depends on: src/core/transcript/transcript.ts (Utterance type only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 step 2, §7.1 (core/transcript)
 */
import type { Speaker, Utterance } from './transcript';

/** Largest gap (ms) between two final lines of the same speaker that still merges them. */
export const MERGE_GAP_MS = 1_500;

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
}

/**
 * Tells whether a new final line continues the previous one.
 *
 * @param previous The final line just before it in time (or undefined at the start).
 * @param next     The new final line.
 * @param gapMs    Largest gap that still merges (default MERGE_GAP_MS).
 * @returns True only for two finals from the same speaker less than gapMs apart.
 * Called from: Transcript.addFinal(); tests
 */
export function shouldMerge(
  previous: Utterance | undefined,
  next: FinalLine,
  gapMs: number = MERGE_GAP_MS,
): boolean {
  if (!previous || !previous.final) return false;
  if (previous.speaker !== next.speaker) return false;
  const gap = next.tStart - previous.tEnd;
  return gap <= gapMs;
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
  return {
    ...previous,
    text: `${previous.text} ${next.text}`.trim(),
    tStart: Math.min(previous.tStart, next.tStart),
    tEnd: Math.max(previous.tEnd, next.tEnd),
  };
}
