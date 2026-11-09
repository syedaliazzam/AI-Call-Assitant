/**
 * File: apps/web/src/core/transcript/stability.ts
 * Purpose: Decides which transcript lines are "stable": final, old enough, past the echo filter,
 *          and no longer able to change. Stable lines go into the cached, append-only
 *          conversation of an answer request; every other line goes into the uncached tail.
 * Used by: src/core/answer/context.ts (buildAnswerRequest)
 * Depends on: src/core/transcript/transcript.ts (Utterance), merge.ts (mergeGapFor),
 *             echo.ts (ECHO_WINDOW_AFTER_MS)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3; day-04-answers.md
 *               "Prompt design" (stable line) and Stage 4; ADR-0025
 *
 * Why so careful: a line in the cached conversation is never sent differently again (the
 * cache matches bytes), so it must not change after it is frozen. A final line can still
 * change in two ways: it merges with the same speaker's next line when that one starts within
 * mergeGapFor() of its end (merge.ts: 1.5 s, or 4 s after a line that sounds cut off, v1.4), and a
 * line is marked as an echo when a matching line of the other speaker becomes final (echo.ts; a "Them"
 * line can be the user's own echo since v1.4). Both depend on a line that is still being heard (a
 * partial), which may finish long after 5 s when the speaker talks for a while, so the rules
 * check the open partials too, not only the age.
 */
import { ECHO_WINDOW_AFTER_MS } from './echo';
import { mergeGapFor } from './merge';
import type { Utterance } from './transcript';

/** How old (since its end) a final line must be before it can be stable, in ms. */
export const STABLE_AFTER_MS = 5_000;

/** What splitStable() returns. */
export interface StableSplit {
  /** Stable lines, in transcript order: they will not change any more. */
  stable: Utterance[];
  /** Every other visible line (newer finals and partials), in transcript order. */
  tail: Utterance[];
}

/**
 * Whether one line is stable, given the open partial lines.
 *
 * @param line     A visible line.
 * @param partials The open partial lines (at most one per speaker).
 * @param now      Unix ms, the transcript's clock.
 * @returns True when the line can no longer change.
 * Called from: splitStable()
 */
function isStable(line: Utterance, partials: readonly Utterance[], now: number): boolean {
  if (!line.final || line.echo) return false;
  if (now - line.tEnd < STABLE_AFTER_MS) return false;
  for (const partial of partials) {
    // The same speaker's open line could still merge into this one (v1.4: after a longer pause when
    // this line sounds cut off, merge.ts mergeGapFor).
    if (partial.speaker === line.speaker && partial.tStart <= line.tEnd + mergeGapFor(line)) {
      return false;
    }
    // v1.4: an open "You" line that began before this "Them" line could still show it to be the user's
    // own voice coming back (echo.ts isReverseEcho).
    if (line.speaker === 'them' && partial.speaker === 'you' && partial.tStart <= line.tStart) {
      return false;
    }
    // An open "Them" line could still turn out to be this "You" line's original (echo).
    if (
      line.speaker === 'you' &&
      partial.speaker === 'them' &&
      partial.tStart <= line.tEnd + ECHO_WINDOW_AFTER_MS
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Splits the visible lines into stable lines and the tail.
 *
 * @param lines The transcript's visible lines (Transcript.lines(): finals and partials, no
 *              echoes), in transcript order.
 * @param now   Unix ms, the transcript's clock.
 * @returns The stable lines and the tail; together they hold every line given, each once.
 * Called from: buildAnswerRequest() in core/answer/context.ts; tests
 */
export function splitStable(lines: readonly Utterance[], now: number): StableSplit {
  const partials = lines.filter((line) => !line.final);
  const split: StableSplit = { stable: [], tail: [] };
  for (const line of lines) {
    (isStable(line, partials, now) ? split.stable : split.tail).push(line);
  }
  return split;
}
