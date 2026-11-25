/**
 * File: apps/web/src/core/answer/ownQuestion.ts
 * Purpose: ADR-0123: the user's own spoken questions. Two rules, both pure:
 *          1. Who Ctrl+Enter answers (pressTarget()): ON A CALL, when the other side ("Them") has spoken within
 *             the last ON_CALL_WINDOW_MS, it answers only the other person's newest question, exactly as before
 *             (pressQuestion.ts / newestQuestion.ts); ON YOUR OWN, when they have not (or there is no other
 *             source), it answers the user's newest spoken question or request from the "You" transcript.
 *             Ctrl+Shift+Space always answers the user's own newest question, in both modes.
 *          2. Which of the user's words that is (chooseOwnQuestion()): the newest turn of "You" lines that asks
 *             something (a question, or a request such as "explain…", "write…"); ordinary talk does not count.
 *             A turn already answered shows its card again instead of asking twice.
 *          Never automatic: these rules run only on a key press. Auto-answer still answers only the other
 *          person (autoAnswer.ts, newestQuestion.ts), and the answer prompt is unchanged: the words are sent as
 *          the user's own question, the same way a typed or voice question is (mode 'chat').
 * Used by: src/features/live/useLiveAnswers.ts (answer, ownQuestion), src/features/live/LiveAnswers.tsx (the
 *          hint on bar 2)
 * Depends on: src/core/transcript (questionKind.ts, transcript.ts)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger); ADR-0123
 *
 * Pure: the caller passes the lines, what was answered and the time. Transcript text is never logged.
 */
import { lineKind } from '../transcript/questionKind';
import { readableLine, type Utterance } from '../transcript/transcript';

/**
 * ADR-0123: the other side counts as "on the call" for this long after their last words, ms (about two
 * minutes, the brief's figure). A system sound such as a video playing counts as the other person too.
 */
export const ON_CALL_WINDOW_MS = 120_000;

/** ADR-0123: "You" lines further apart than this are separate turns, ms (a breath inside one question is shorter). */
export const OWN_TURN_GAP_MS = 2_500;

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
 * A request worded as an instruction to the assistant ("explain recursion", "okay, write me a short email…"),
 * which lineKind() calls a statement. Checked at the start of each sentence, after fillers and a name.
 */
const OWN_REQUEST =
  /^(?:(?:hey|hi|ok(?:ay)?|so|um+|uh+|and|now|right|alright|please|paramount(?: ai)?|kite)[,.!\s]+)*(?:can you |could you |would you |please )?(?:explain|summari[sz]e|give|write|draft|list|tell|show|help|translate|compare|describe|define|calculate|compute|convert|suggest|recommend|remind|find|check|rewrite|rephrase|fix|outline|plan|create|make|generate|teach|quiz)\b/i;

/**
 * Whether the user's words ask something of the assistant: a question (questionKind.ts, which also counts "tell
 * me about…" requests) or an instruction to it. Greetings, talk about the call, noise and ordinary remarks do not.
 *
 * @param text The words (never logged).
 * @returns True for a question or a request.
 * Called from: chooseOwnQuestion(); tests
 */
export function isOwnRequest(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  const kind = lineKind(trimmed);
  if (kind === 'question') return true;
  if (kind !== 'statement') return false;
  return trimmed.split(/(?<=[.!?])\s+/).some((sentence) => OWN_REQUEST.test(sentence.trim()));
}

/**
 * When the other side last spoke: the end of their newest line with words (capture clock, Unix ms).
 *
 * @param lines The call's lines (Transcript.lines()).
 * @returns The time, or null when they have said nothing yet.
 * Called from: pressTarget(), LiveAnswers.tsx (the hint's timer); tests
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
 * Called from: useLiveAnswers.ts (answer), LiveAnswers.tsx (the hint on bar 2); tests
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

/** What a press on the user's own question does. */
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
    }
  | {
      /** The newest question was answered already: show its card. */
      kind: 'answered';
      /** Its lines. */
      lineIds: string[];
    }
  | {
      /** The user has asked nothing yet. */
      kind: 'none';
    };

/** What chooseOwnQuestion() needs. */
export interface OwnInput {
  /** The visible lines (finals and grey lines), noise left out, in order. */
  lines: readonly Utterance[];
  /** The "You" lines already answered as the user's own question (ids as the lines have them now). */
  answeredLineIds: ReadonlySet<string>;
}

/**
 * The user's spoken turns, newest first: consecutive "You" lines with words, no "Them" words between them, and
 * gaps under OWN_TURN_GAP_MS.
 *
 * @param lines The lines, in order.
 * @returns The turns (each oldest first), newest turn first.
 */
function ownTurns(lines: readonly Utterance[]): Utterance[][] {
  const turns: Utterance[][] = [];
  let current: Utterance[] = [];
  for (const line of lines) {
    if (line.text.trim() === '' || line.nonEnglish) continue;
    if (line.speaker !== 'you') {
      if (current.length > 0) turns.push(current);
      current = [];
      continue;
    }
    const previous = current.at(-1);
    if (previous && line.tStart - previous.tEnd > OWN_TURN_GAP_MS) {
      turns.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) turns.push(current);
  return turns.reverse();
}

/**
 * ADR-0123: the user's newest spoken question or request. Looks back past ordinary talk ("okay, thanks") to the
 * newest turn that asks something; when every line of that turn was answered already, says so (the caller shows
 * that card).
 *
 * @param input See OwnInput.
 * @returns See OwnChoice.
 * Called from: useLiveAnswers.ts (ownQuestion); tests
 */
export function chooseOwnQuestion(input: OwnInput): OwnChoice {
  // Read with the punctuation model's marks where a line has none yet (as the other side's are).
  const lines = input.lines.map(readableLine);
  for (const turn of ownTurns(lines)) {
    const text = turn.map((line) => line.text.trim()).join(' ');
    if (!isOwnRequest(text)) continue;
    const lineIds = turn.map((line) => line.id);
    if (lineIds.every((id) => input.answeredLineIds.has(id))) return { kind: 'answered', lineIds };
    return {
      kind: 'answer',
      text: text.split(/\s+/).slice(-MAX_OWN_WORDS).join(' '),
      lineIds,
      grey: turn.at(-1)?.final === false,
    };
  }
  return { kind: 'none' };
}
