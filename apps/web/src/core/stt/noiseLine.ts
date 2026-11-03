/**
 * File: apps/web/src/core/stt/noiseLine.ts
 * Purpose: Decides whether a final transcript line is noise the speech model turned into a word
 *          (v1.0.1). A real call began with "You" lines such as "Tree", "Um" and "Wife": at the
 *          start the energy gate has not yet learned the room's background level, so its threshold
 *          is only the absolute floor and faint noise gets through. A line is dropped only when it
 *          is one word, is not a real short answer ("Yes", "No", "Okay"…), stands alone (no line
 *          from the same speaker just before), and was never clearly louder than the gate's
 *          threshold. Anything longer or louder is kept.
 * Used by: src/core/stt/channel.ts (ChannelDecoder.endUtterance)
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (speech-to-text)
 */

/** How much louder than the gate's threshold a lone word must peak to count as speech. */
export const LONE_WORD_LOUDNESS_FACTOR = 3;

/** A lone word is "isolated" when the same speaker said nothing for this long before it, in ms. */
export const ISOLATION_MS = 3_000;

/** One-word replies that are real answers, kept however quiet they are. */
const SHORT_ANSWERS = new Set([
  'yes',
  'yeah',
  'yep',
  'yup',
  'no',
  'nope',
  'nah',
  'ok',
  'okay',
  'sure',
  'right',
  'correct',
  'exactly',
  'absolutely',
  'definitely',
  'agreed',
  'true',
  'hi',
  'hello',
  'hey',
  'thanks',
  'bye',
  'please',
  'sorry',
  'pardon',
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
]);

/** What is known about one final line. */
export interface FinalLine {
  /** The line's text, as the engine wrote it. */
  text: string;
  /** The loudest chunk of the utterance (RMS, 0…1). */
  peakRms: number;
  /** The gate's threshold when the line ended (RMS, 0…1). */
  threshold: number;
  /** Time since the same speaker's previous final line ended, in ms (Infinity when none). */
  msSincePrevious: number;
}

/**
 * Whether a final line is noise to drop.
 *
 * @param line The line, its peak loudness, the gate's threshold and the time since the last line.
 * @returns True to drop it; false to keep it.
 * Called from: ChannelDecoder.endUtterance() in channel.ts; tests
 */
export function isNoiseLine(line: FinalLine): boolean {
  const words = line.text.trim().split(/\s+/).filter(Boolean);
  if (words.length !== 1) return false;
  const word = words[0]!.toLowerCase().replace(/[^\p{L}']/gu, '');
  if (SHORT_ANSWERS.has(word)) return false;
  if (line.msSincePrevious < ISOLATION_MS) return false;
  return line.peakRms < line.threshold * LONE_WORD_LOUDNESS_FACTOR;
}
