/**
 * File: apps/web/src/core/answer/autoAnswer.ts
 * Purpose: Auto-answer (beta, off by default; Day 6 Stage 4f, reworked in v1.4 / ADR-0062): decides when
 *          Kite should answer by itself, without the user pressing Answer, and which lines make the
 *          question. Also the rule both auto-answer and Answer use to tell when the other person's new
 *          words only continue a question already answered.
 *
 *          The question window: every "Them" line since the user last really spoke (a blip such as
 *          "okay" or "um" does not count) that has not been answered yet. Auto-answer fires when the
 *          window holds a question, nobody is still speaking, and the pause since its last line is long
 *          enough: AUTO_PAUSE_MS when the last line sounds finished, UNFINISHED_PAUSE_MS when it sounds
 *          cut off ("…and what you would change about"). While the desktop's accurate engine is still
 *          rewriting a line of the window, it waits up to ACCURATE_WAIT_MS more for the better words.
 *
 *          If the other person goes on within RERUN_WINDOW_MS of an auto-answer starting, their new
 *          words continue that question: the answer is cancelled and asked again with the whole
 *          question, on the same card (a "rerun"), never as a second card.
 * Used by: src/features/live/useAutoAnswer.ts, src/features/live/useLiveAnswers.ts (continuation)
 * Depends on: src/core/transcript (questionKind.ts lineKind, blip.ts isBlip, complete.ts
 *             looksUnfinished, transcript.ts Utterance)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger), §7.5; ADR-0062
 *
 * Pure functions only (the caller passes the time), so every rule is unit-tested. Transcript
 * text is never logged.
 */
import { isBlip } from '../transcript/blip';
import { looksUnfinished } from '../transcript/complete';
import { lineKind } from '../transcript/questionKind';
import type { Utterance } from '../transcript/transcript';

/** Silence after a question that sounds finished before Kite answers, ms. */
export const AUTO_PAUSE_MS = 1_200;

/** v1.4: silence after a line that sounds cut off before Kite answers, ms (1.8 s more). */
export const UNFINISHED_PAUSE_MS = 3_000;

/** v1.4: the longest extra wait for the accurate engine's words, ms. */
export const ACCURATE_WAIT_MS = 1_500;

/** v1.4: new words starting within this long after an auto-answer started continue its question, ms. */
export const RERUN_WINDOW_MS = 4_000;

/** v1.4: Answer pressed after new words that started within this long of the last question's end, ms. */
export const CONTINUE_WINDOW_MS = 8_000;

/**
 * Slack when comparing speech times, in ms (as repeatGuard.ts SPAN_SLACK_MS): a merged line's end is
 * later than the answered one's only once new words were added.
 */
const GROWN_SLACK_MS = 700;

/**
 * v1.4: a grey line that has not changed for this long is stuck, not speech (the engine ends a line
 * after 1.2 s without new words), so it no longer counts as someone speaking, ms.
 */
export const STALE_PARTIAL_MS = 5_000;

/**
 * v1.4: a question that ended longer ago than this is never answered by itself (for example when
 * auto-answer is turned on during a call, or the user replied first), ms.
 */
export const AUTO_MAX_AGE_MS = 10_000;

/** Fewest words a question has ("What?" or "Sorry?" alone is not one). */
const MIN_QUESTION_WORDS = 3;

/**
 * Whether some text is a question Kite should answer by itself: at least three words, and a question
 * (or a request) by questionKind.ts, so greetings, talk about the call ("can you repeat that?") and
 * noise are never answered by themselves.
 *
 * @param text The words.
 * @returns True for a question.
 * Called from: autoAnswerDue(); tests
 */
export function isAutoQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).filter(Boolean).length < MIN_QUESTION_WORDS) return false;
  return lineKind(trimmed) === 'question';
}

/** The latest answer to speech in this call (what a rerun or a continuation would replace). */
export interface AnsweredQuestion {
  /** The answer's id (its card). */
  answerId: string;
  /** The ids of the lines its question came from. */
  lineIds: readonly string[];
  /** The end of the speech it answered (Unix ms, the lines' time base). */
  end: number;
  /** When it was asked (Unix ms, the lines' time base). */
  askedAt: number;
  /** True when Kite asked it by itself. */
  auto: boolean;
}

/** What autoAnswerDue() needs to know about the call. */
export interface AutoAnswerState {
  /** Whether the user turned auto-answer on (Settings). */
  enabled: boolean;
  /** Whether an answer is streaming now. */
  streaming: boolean;
  /** The visible transcript lines, in order (finals and partials). */
  lines: readonly Utterance[];
  /** Lines already answered in this call (by any answer). */
  answeredLineIds: ReadonlySet<string>;
  /** The latest answer to speech in this call, or null. */
  last: AnsweredQuestion | null;
}

/** What auto-answer should do now. */
export type AutoDecision =
  | {
      /** Answer a new question. */
      kind: 'answer';
      /** The lines of the question, oldest first. */
      lineIds: string[];
      /** End of its last line (Unix ms). */
      tEnd: number;
    }
  | {
      /** Ask again with the whole question, on the card of the answer it replaces. */
      kind: 'rerun';
      /** The answer to replace. */
      replaces: string;
      /** The lines of the whole question, oldest first. */
      lineIds: string[];
      /** End of its last line (Unix ms). */
      tEnd: number;
    };

/**
 * Whether a line is something the user really said (a turn), not a blip.
 *
 * @param line A visible line.
 * @returns True for a "You" line that is not a blip.
 * Called from: questionWindow(), continuationOf()
 */
function isUserTurn(line: Utterance): boolean {
  return line.speaker === 'you' && !isBlip(line.text);
}

/**
 * The lines that can make a question: visible, with words, and not another language.
 *
 * @param lines The visible lines.
 * @returns Those lines, in order.
 * Called from: autoAnswerDue(), questionWindow(), continuationOf()
 */
function speech(lines: readonly Utterance[]): Utterance[] {
  return lines.filter((line) => line.text.trim() !== '' && !line.nonEnglish);
}

/**
 * The question window: the "Them" lines since the user last really spoke that are not answered yet.
 *
 * @param lines    The visible lines, in order.
 * @param answered Ids of the lines already answered.
 * @returns The window's lines, oldest first ([] when there are none).
 * Called from: autoAnswerDue(); tests
 */
export function questionWindow(
  lines: readonly Utterance[],
  answered: ReadonlySet<string>,
): Utterance[] {
  const spoken = speech(lines);
  const lastTurn = spoken.findLastIndex(isUserTurn);
  return spoken.slice(lastTurn + 1).filter((line) => {
    if (line.speaker !== 'them' || answered.has(line.id)) return false;
    // A line that is only a greeting, an instruction or talk about the call is never part of a
    // question ("can you repeat that?" then "why Go?" asks "why Go?").
    const kind = lineKind(line.text);
    return kind !== 'greeting' && kind !== 'instruction' && kind !== 'meta';
  });
}

/**
 * The other person's words that continue a question already answered: "Them" speech that grew or
 * started after it ended, started soon enough after it, with no real turn of the user in between, and
 * that is not a greeting, an instruction or talk about the call.
 *
 * @param lines    The visible lines, in order.
 * @param last     The latest answered question.
 * @param withinMs How soon after `from` the new words must have started.
 * @param from     When that clock starts (Unix ms): the answer's start for auto-answer, the
 *                 question's end for Answer.
 * @returns The continuing lines (oldest first), or [] when there are none.
 * Called from: autoAnswerDue(); useLiveAnswers.ts (Answer); tests
 */
export function continuationOf(
  lines: readonly Utterance[],
  last: AnsweredQuestion,
  withinMs: number,
  from: number,
): Utterance[] {
  const spoken = speech(lines);
  const after: Utterance[] = [];
  for (const line of spoken) {
    if (line.tEnd <= last.end + GROWN_SLACK_MS) continue;
    // The user took the turn after the question: what follows is a new exchange.
    if (isUserTurn(line)) return [];
    if (line.speaker !== 'them') continue;
    const grown = last.lineIds.includes(line.id);
    if (!grown && line.tStart > from + withinMs) return after;
    const kind = lineKind(line.text);
    if (!grown && (kind === 'greeting' || kind === 'instruction' || kind === 'meta')) return after;
    after.push(line);
  }
  return after;
}

/**
 * How long to wait after a window's last line before answering it.
 *
 * @param window The window's lines.
 * @param now    The current time (Unix ms).
 * @returns The pause needed, in ms (Infinity when the accurate engine is still busy and may still be).
 * Called from: autoAnswerDue()
 */
function pauseNeeded(window: readonly Utterance[], now: number): number {
  const last = window.at(-1)!;
  const pause = looksUnfinished(last.text) ? UNFINISHED_PAUSE_MS : AUTO_PAUSE_MS;
  // Wait for the accurate engine's words, but never more than ACCURATE_WAIT_MS on top.
  if (window.some((line) => line.refining) && now - last.tEnd < pause + ACCURATE_WAIT_MS) {
    return Number.POSITIVE_INFINITY;
  }
  return pause;
}

/**
 * Whether an auto-answer (or a rerun) is due now, and for which lines.
 *
 * @param state See AutoAnswerState.
 * @param now   The current time, in the lines' time base (ms).
 * @returns What to do, or null when nothing is due.
 * Called from: useAutoAnswer.ts (on a timer); tests
 */
export function autoAnswerDue(state: AutoAnswerState, now: number): AutoDecision | null {
  if (!state.enabled) return null;
  const spoken = speech(state.lines);
  // Anyone still speaking (a grey line that changed lately), other than a blip, means the moment has
  // not come.
  if (
    spoken.some(
      (line) =>
        !line.final &&
        now - line.tEnd < STALE_PARTIAL_MS &&
        (line.speaker === 'them' || !isBlip(line.text)),
    )
  ) {
    return null;
  }

  // The other person went on after an auto-answer started: ask again with the whole question.
  const last = state.last;
  if (last?.auto) {
    const more = continuationOf(state.lines, last, RERUN_WINDOW_MS, last.askedAt);
    if (more.length > 0) {
      const whole = [
        ...spoken.filter((line) => last.lineIds.includes(line.id) && !more.includes(line)),
        ...more,
      ];
      const end = Math.max(...more.map((line) => line.tEnd));
      if (now - end < pauseNeeded(more, now)) return null;
      return {
        kind: 'rerun',
        replaces: last.answerId,
        lineIds: whole.map((line) => line.id),
        tEnd: end,
      };
    }
  }

  if (state.streaming) return null;
  const window = questionWindow(state.lines, state.answeredLineIds);
  if (window.length === 0) return null;
  // The newest words must be the other person's: a real reply from the user ends the moment.
  const newest = spoken.filter((line) => line.speaker === 'them' || !isBlip(line.text)).at(-1);
  if (!newest || newest.speaker !== 'them') return null;
  const text = window.map((line) => line.text.trim()).join(' ');
  if (!isAutoQuestion(text)) return null;
  const end = window.at(-1)!.tEnd;
  if (now - end < pauseNeeded(window, now) || now - end > AUTO_MAX_AGE_MS) return null;
  return { kind: 'answer', lineIds: window.map((line) => line.id), tEnd: end };
}
