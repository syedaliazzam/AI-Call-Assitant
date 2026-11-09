/**
 * File: apps/web/src/core/transcript/echo.ts
 * Purpose: Recognises "echo": the other side's voice coming out of the laptop's speakers, picked
 *          up by the microphone and transcribed a second time as "You"; and (v1.4) the reverse, the
 *          user's own voice coming back on "Them" from the other person's speakers. An echo line repeats,
 *          in the same order, what the other channel said a moment earlier. Such lines are hidden from
 *          the transcript (transcript.ts), because Answer takes the question from the "Them" lines
 *          since the user last spoke: a fake "You" line would cut that question short, and a fake "Them"
 *          line would be answered as if they had asked it.
 * Used by: src/core/transcript/transcript.ts
 * Depends on: src/core/stt/wer.ts (normalizeWords: lower case, no punctuation),
 *             src/core/transcript/keyTermFix.ts (soundPattern: words that sound alike)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 2–3; ADR-0020 (speaker leak),
 *               ADR-0044, ADR-0062
 *
 * The "You" rule (Day 2, from the developer's speaker test; widened in v1.1.0 and v1.4):
 * - it is compared with what "Them" said from 10 s before the line started to 3 s after it ended
 *   (the echo arrives together with, or just after, the original);
 * - score = longest common word sequence (in order) ÷ number of words in the "You" line. Order
 *   matters: a real reply that reuses words of the question ("the professional plan costs…" after
 *   "what does the professional plan cost") shares a few words, not a long run in the same order.
 *   v1.4: two words also match when they sound alike (keyTermFix.ts soundPattern), because the echo
 *   is heard through the room and the speech model mishears it differently from the clean original;
 * - four words or more: an echo when score ≥ ECHO_MIN_SCORE (0.6), or ≥ ECHO_INSIDE_SCORE (0.5) when
 *   the whole "You" line lies inside a stretch where "Them" was speaking;
 * - three words (v1.1.0): only when "Them" said the same three words in the same order within 3 s;
 * - one or two words (v1.4): only when the line lies inside "Them" speech and "Them" said every one of
 *   those words within 1.5 s of it. Before v1.4 these were never hidden, and "okay so", "gone" through
 *   the speakers stayed on screen.
 * The reverse rule (v1.4): a "Them" line of three words or more is the user's own echo when at least
 * REVERSE_ECHO_MIN_SCORE (0.6; 0.5 when it overlaps the user's speech) of its words repeat, in order, a
 * "You" line that ended at most 3 s before it
 * started, and it started at least 200 ms after that "You" line did (a network echo is never earlier).
 */
import { normalizeWords } from '../stt/wer';
import { soundPattern } from './keyTermFix';

/** Fewest words in a "You" line before the score rule judges it. */
export const ECHO_MIN_WORDS = 4;

/** Share of the "You" words that must appear in order in what "Them" said. */
export const ECHO_MIN_SCORE = 0.6;

/** v1.4: the same share when the "You" line lies wholly inside "Them" speech. */
export const ECHO_INSIDE_SCORE = 0.5;

/** How far before a "You" line's start "Them" speech is compared, in ms. */
export const ECHO_WINDOW_BEFORE_MS = 10_000;

/** How far after a "You" line's end "Them" speech is compared, in ms. */
export const ECHO_WINDOW_AFTER_MS = 3_000;

/** A "You" line this short is judged only by an exact match, very close in time (v1.1.0). */
export const ECHO_SHORT_WORDS = 3;

/** How close in time, either way, an exact match of a short line must be, in ms (v1.1.0). */
export const ECHO_SHORT_WINDOW_MS = 3_000;

/** v1.4: how close in time, either way, "Them" must have said a one- or two-word line's words, in ms. */
export const ECHO_TINY_WINDOW_MS = 1_500;

/**
 * v1.4: share of a "Them" line's words that must repeat the user's earlier words, in order (0.6 since the
 * synthetic reverse-echo call, ADR-0063: the echo comes back through a phone line and is misheard).
 */
export const REVERSE_ECHO_MIN_SCORE = 0.6;

/** v1.4: the same share when the "Them" line overlaps the user's own speech. */
export const REVERSE_ECHO_INSIDE_SCORE = 0.5;

/**
 * v1.4: a "Them" line is never the original of a "You" echo if it started more than this long after the
 * "You" line did, in ms (a speaker echo follows its original; this allows for the two engines' timing).
 */
export const ECHO_ORIGINAL_LEAD_MS = 500;

/** v1.4: fewest words in a "Them" line before it can be judged the user's own echo. */
export const REVERSE_ECHO_MIN_WORDS = 3;

/** v1.4: the user's own echo starts at least this long after the user's line started, in ms. */
export const REVERSE_ECHO_MIN_DELAY_MS = 200;

/** v1.4: and at most this long after the user's line ended, in ms. */
export const REVERSE_ECHO_MAX_DELAY_MS = 3_000;

/**
 * Whether two normalised words count as the same: equal, or (both at least four letters) sounding alike.
 *
 * @param a One word.
 * @param b The other.
 * @returns True when they match.
 * Called from: lcsLength()
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return soundPattern(a) === soundPattern(b);
}

/**
 * Length of the longest common subsequence of two word lists (words in the same order, gaps
 * allowed). v1.4: words that sound alike count as the same.
 *
 * @param a First list.
 * @param b Second list.
 * @returns The number of words in the longest common subsequence.
 * Called from: echoScore(); tests
 */
export function lcsLength(a: readonly string[], b: readonly string[]): number {
  // One row of the classic dynamic-programming table at a time (memory O(len(b))).
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = sameWord(a[i - 1]!, b[j - 1]!)
        ? previous[j - 1]! + 1
        : Math.max(previous[j]!, current[j - 1]!);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * How much of a line repeats, in order, what the other channel said.
 *
 * @param lineText  The line being judged.
 * @param otherText What the other channel said around that time (joined in time order).
 * @returns 0…1 (0 for an empty line).
 * Called from: isEcho(), isReverseEcho(); tests
 */
export function echoScore(lineText: string, otherText: string): number {
  const words = normalizeWords(lineText);
  if (words.length === 0) return 0;
  return lcsLength(words, normalizeWords(otherText)) / words.length;
}

/** What "Them" said around a "You" line, at the distances the rules use. */
export interface ThemAround {
  /** From ECHO_WINDOW_BEFORE_MS before to ECHO_WINDOW_AFTER_MS after the line. */
  wide: string;
  /** Within ECHO_SHORT_WINDOW_MS either way (three-word rule). */
  near: string;
  /** Within ECHO_TINY_WINDOW_MS either way (one- and two-word rule). */
  tiny: string;
  /** True when the whole "You" line lies inside a stretch of "Them" speech. */
  inside: boolean;
}

/**
 * Decides whether a "You" line is an echo of "Them".
 *
 * @param youText The "You" line.
 * @param them    What "Them" said around it (a string is the wide window only, as before v1.4).
 * @param nearText v1.1.0 form: what "Them" said within ECHO_SHORT_WINDOW_MS (only with a string `them`).
 * @returns True for an echo.
 * Called from: transcript.ts (addPartial, addFinal); tests
 */
export function isEcho(youText: string, them: ThemAround | string, nearText = ''): boolean {
  const around: ThemAround =
    typeof them === 'string' ? { wide: them, near: nearText, tiny: '', inside: false } : them;
  const words = normalizeWords(youText);
  if (words.length === 0) return false;
  if (words.length < ECHO_SHORT_WORDS) {
    // Every word said by "Them" within a moment of it (exact words: too short to allow sound-alikes),
    // and the line lies inside "Them" speech: an echo comes out of the speakers while they talk, while
    // a real "yes, exactly" comes after they stop.
    if (!around.inside) return false;
    const near = new Set(normalizeWords(around.tiny));
    return words.every((word) => near.has(word));
  }
  if (words.length === ECHO_SHORT_WORDS) return echoScore(youText, around.near) === 1;
  const score = echoScore(youText, around.wide);
  return score >= (around.inside ? ECHO_INSIDE_SCORE : ECHO_MIN_SCORE);
}

/**
 * Decides whether a "Them" line is the user's own voice coming back from the other person's speakers.
 *
 * @param themText The "Them" line.
 * @param youText  The user's lines that could be its original (ended at most
 *                 REVERSE_ECHO_MAX_DELAY_MS before it, started at least REVERSE_ECHO_MIN_DELAY_MS
 *                 before it), joined in time order.
 * @param inside   True when the "Them" line overlaps the user's own speech (a weaker match is enough).
 * @returns True when it repeats them.
 * Called from: transcript.ts (addPartial, addFinal); tests
 */
export function isReverseEcho(themText: string, youText: string, inside = false): boolean {
  if (normalizeWords(themText).length < REVERSE_ECHO_MIN_WORDS || youText.trim() === '')
    return false;
  return (
    echoScore(themText, youText) >= (inside ? REVERSE_ECHO_INSIDE_SCORE : REVERSE_ECHO_MIN_SCORE)
  );
}
