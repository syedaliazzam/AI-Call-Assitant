/**
 * File: apps/web/src/core/transcript/reply.ts
 * Purpose: When the user's speech is a reply to the other person (1.5.2, ADR-0070). Speech that began while
 *          the other person was still talking is not a reply: the user reading the last answer aloud as the
 *          next question starts, or the speakers' echo of the question heard by the microphone. On the real
 *          call of 11 Nov 2026 such lines (2–4 s into a question) ended the question window, and three
 *          questions got no auto-answer; presses then looked past the newest question.
 * Used by: src/core/answer/autoAnswer.ts (question window, continuation), src/core/transcript/question.ts
 *          (which lines a press answers)
 * Depends on: src/core/transcript/transcript.ts (Utterance)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger); ADR-0070
 *
 * Pure functions. Text is never read here: only who spoke and when.
 */
import type { Utterance } from './transcript';

/**
 * How far before the other person's end of speech the user may start and still be replying, ms. A line's
 * end is when its last word changed, a little after the voice stopped, and people often start a reply
 * just before the other person's last syllable.
 */
export const REPLY_SLACK_MS = 500;

/**
 * Whether a "You" line began while the other person was talking: one of their lines (finished or still
 * grey) had started before it and went on for more than REPLY_SLACK_MS after it began.
 *
 * @param line  A "You" line.
 * @param lines The visible lines (finals and grey lines; hidden echoes are already left out).
 * @returns True when it began over the other person's words.
 * Called from: isReply(); autoAnswer.ts; question.ts; tests
 */
export function startedOverThem(line: Utterance, lines: readonly Utterance[]): boolean {
  if (line.speaker !== 'you') return false;
  return lines.some(
    (other) =>
      other.speaker === 'them' &&
      other.text.trim() !== '' &&
      other.tStart <= line.tStart &&
      other.tEnd > line.tStart + REPLY_SLACK_MS,
  );
}
