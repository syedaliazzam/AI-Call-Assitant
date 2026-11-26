/**
 * File: apps/web/src/core/answer/ownQuestion.ts
 * Purpose: ADR-0123 (amended 27 Nov 2026): the user's own spoken words. Two rules, both pure:
 *          1. Who Ctrl+Enter answers (pressTarget()): ON A CALL, when the other side ("Them") has spoken within the
 *             last ON_CALL_WINDOW_MS, it answers only the other person's newest question, exactly as before
 *             (pressQuestion.ts / newestQuestion.ts); ON YOUR OWN, when they have not (or there is no other
 *             source), it answers the user's own newest unanswered speech from the "You" transcript.
 *             Ctrl+Shift+Space always answers the user's own newest unanswered speech, in both modes.
 *          2. Which of the user's words that is (chooseOwnQuestion()): every "You" line said since the user's last
 *             answered words, back to the other person's last words, joined into one turn. Anything counts,
 *             greetings and small talk included: with no one else on the call, everything the user says is meant
 *             for the assistant. Words answered already show their card again instead of asking twice.
 *          Never automatic: these rules run only on a key press. Auto-answer still answers only the other
 *          person (autoAnswer.ts, newestQuestion.ts), and the answer prompt is unchanged: the words are sent as
 *          the user's own question, the same way a typed or voice question is (mode 'chat').
 * Used by: src/features/live/useLiveAnswers.ts (answer, ownQuestion), src/features/live/usePressTarget.ts (the
 *          hint on bar 2)
 * Depends on: src/core/transcript/transcript.ts (readableLine, Segment, Utterance), src/core/answer/newestQuestion.ts
 *             (segmentsOf: a joined line's stretches)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger); ADR-0123
 *
 * Pure: the caller passes the lines, what was answered and the time. Transcript text is never logged.
 */
import { readableLine, type Segment, type Utterance } from '../transcript/transcript';
import { segmentsOf } from './newestQuestion';

/**
 * ADR-0123: the other side counts as "on the call" for this long after their last words, ms (about two
 * minutes, the brief's figure). A system sound such as a video playing counts as the other person too.
 */
export const ON_CALL_WINDOW_MS = 120_000;

/**
 * ADR-0123: a press waits at most this long for the user's own last words to be finished (still grey) before
 * it sends what there is, ms.
 */
export const OWN_WAIT_MS = 1_500;

/** ADR-0123: at most this many of the newest words of a turn are sent (a long monologue stays a short request). */
export const MAX_OWN_WORDS = 200;

/** Who Ctrl+Enter answers right now: the other person ('them') or the user ('you'). */
export type PressTarget = 'them' | 'you';

/**
 * When the other side last spoke: the end of their newest line with words (capture clock, Unix ms).
 *
 * @param lines The call's lines (Transcript.lines()).
 * @returns The time, or null when they have said nothing yet.
 * Called from: pressTarget(), usePressTarget.ts (the hint's timer); tests
 */
export function lastThemSpeech(lines: readonly Utterance[]): number | null {
  const last = lines.findLast((line) => line.speaker === 'them' && line.text.trim() !== '');
  return last ? last.tEnd : null;
}

/**
 * ADR-0123: who Ctrl+Enter answers now. On a call (the other side spoke within ON_CALL_WINDOW_MS, and their
 * audio is connected) it is the other person; otherwise the user.
 *
 * @param lines         The call's lines.
 * @param now           The current time (Unix ms, the lines' clock).
 * @param themConnected False when there is no other-side source in this call.
 * @returns 'them' or 'you'.
 * Called from: useLiveAnswers.ts (answer), usePressTarget.ts (the hint on bar 2); tests
 */
export function pressTarget(
  lines: readonly Utterance[],
  now: number,
  themConnected: boolean,
): PressTarget {
  if (!themConnected) return 'you';
  const last = lastThemSpeech(lines);
  return last !== null && now - last < ON_CALL_WINDOW_MS ? 'them' : 'you';
}

/** What a press on the user's own words does. */
export type OwnChoice =
  | {
      /** Ask these words. */
      kind: 'answer';
      /** The words (the newest MAX_OWN_WORDS). Never logged. */
      text: string;
      /** Their lines, oldest first. */
      lineIds: string[];
      /** True when the newest of them is still grey (the user may still be speaking). */
      grey: boolean;
      /** The start of the newest stretch sent (capture time): the caller's next answeredUntil. */
      until: number;
    }
  | {
      /** The user's newest words were answered already: show that card. */
      kind: 'answered';
      /** The user's newest line (the caller finds its card). */
      lineIds: string[];
    }
  | {
      /** The user has said nothing yet. */
      kind: 'none';
    };

/** What chooseOwnQuestion() needs. */
export interface OwnInput {
  /** The visible lines (finals and grey lines), noise left out, in order. */
  lines: readonly Utterance[];
  /**
   * The capture time (Unix ms) up to which the user's own words were answered: the start of the newest stretch
   * sent. Stretches that start after it are new, even when the transcript joined them to an answered line (close
   * lines of one speaker merge, merge.ts). Null or absent: nothing of the user's answered yet.
   */
  answeredUntil?: number | null;
}

/**
 * Whether a line has words that count: not empty, and not marked as another language (the engine writes a
 * placeholder for other languages, not the user's words).
 *
 * @param line The line.
 * @returns True for a line with words.
 * Called from: chooseOwnQuestion()
 */
function hasWords(line: Utterance): boolean {
  return line.text.trim() !== '' && line.nonEnglish !== true;
}

/**
 * ADR-0123 (amended 27 Nov 2026): the user's newest unanswered speech. From the newest line back, it skips the
 * other person's words said after the user's, then joins every "You" stretch until it reaches words already
 * answered as the user's own (answeredUntil), or the other person's words before them. Any words count, greetings and small talk included
 * (before the amendment only a question or a request did, so "Hey there" got no answer). When the user's newest
 * line was answered already, it says so (the caller shows that card). At most the newest MAX_OWN_WORDS are sent.
 *
 * @param input See OwnInput.
 * @returns See OwnChoice.
 * Called from: useLiveAnswers.ts (ownQuestion); tests
 */
export function chooseOwnQuestion(input: OwnInput): OwnChoice {
  // Read with the punctuation model's marks where a line has none yet (as the other side's are).
  const lines = input.lines.map(readableLine).filter(hasWords);
  // The user's newest line: the other person's words after it (on a call, Ctrl+Shift+Space) are skipped.
  let end = lines.length - 1;
  while (end >= 0 && lines[end]!.speaker !== 'you') end -= 1;
  if (end < 0) return { kind: 'none' };
  const newest = lines[end]!;
  const until = input.answeredUntil ?? null;
  // A stretch is new when it starts after the newest stretch already answered (a grey line answered early and
  // finished later keeps its start, so it is not new; words joined to it later are).
  const isNew = (segment: Segment) => until === null || segment.tStart > until;
  const stretches: Segment[] = [];
  const lineIds: string[] = [];
  for (let index = end; index >= 0; index -= 1) {
    const line = lines[index]!;
    // The other person's words before mine end the turn.
    if (line.speaker !== 'you') break;
    const all = segmentsOf(line);
    const fresh = all.filter(isNew);
    if (fresh.length === 0) break;
    stretches.unshift(...fresh);
    lineIds.unshift(line.id);
    // Part of this line was answered already: the turn starts inside it.
    if (fresh.length < all.length) break;
  }
  // Nothing new since the last answer: that card again.
  if (stretches.length === 0) return { kind: 'answered', lineIds: [newest.id] };
  const text = stretches.map((segment) => segment.text.trim()).join(' ');
  return {
    kind: 'answer',
    text: text.split(/\s+/).slice(-MAX_OWN_WORDS).join(' '),
    lineIds,
    grey: newest.final === false,
    until: stretches.at(-1)!.tStart,
  };
}
