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
 *
 *          1.5.2 (ADR-0070), from the real call of 11 Nov 2026: speech of the user's that began while the other
 *          person was still talking (reading the last answer aloud, the speakers' echo) is not a reply and no
 *          longer ends the window (reply.ts); a question whose grey line paused and that the end-of-turn
 *          model heard as finished is answered at once, before its line is final (about a second sooner); a
 *          question that came due while another answer streamed is answered when that one finishes, however
 *          long it took; and a press that answered grey words is asked again on its card when the other
 *          person went on, as an auto-answer is.
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
import { startedOverThem } from '../transcript/reply';
import { readableLine, type Utterance } from '../transcript/transcript';

/** Silence after a question that sounds finished before Kite answers, ms. */
export const AUTO_PAUSE_MS = 1_200;

/** v1.4: silence after a line that sounds cut off before Kite answers, ms (1.8 s more). */
export const UNFINISHED_PAUSE_MS = 3_000;

/** v1.4 (ADR-0065): the longest extra wait for the end-of-turn model's judgment, ms. */
export const TURN_WAIT_MS = 500;

/** v1.4 (ADR-0065): the end-of-turn probability at which the voice counts as clearly finished. */
export const TURN_FINISHED_AT = 0.8;

/**
 * v1.4: the longest extra wait for the accurate engine's words, ms. 1.5.1 (ADR-0069): 0.5 s (was 1.5 s, then
 * 1 s), and only for a rewrite already running (refineQueue.ts marks a line only while its rewrite runs).
 * At 1 s, auto-answer's first word came 3.7 s after a question (target 3.5 s).
 */
export const ACCURATE_WAIT_MS = 500;

/**
 * 1.5.2 (ADR-0070): the end-of-turn probability at a pause from which a question still grey is answered at
 * once. Measured on the real call of 11 Nov 2026: 0.74 and 0.89 at question ends, ready 0.73–0.76 s after
 * the voice stopped; a wrong early answer is asked again on its card when the person goes on.
 */
export const EARLY_TURN_AT = 0.7;

/**
 * 1.5.2: after an answer stops streaming, a question that came due meanwhile is still answered for this
 * long even when it is older than AUTO_MAX_AGE_MS, ms.
 */
export const AFTER_STREAM_GRACE_MS = 2_000;

/** v1.4: new words starting within this long after an auto-answer started continue its question, ms. */
export const RERUN_WINDOW_MS = 4_000;

/**
 * 1.5.2 (ADR-0070): new words that are a question of their own and start this long after the answered
 * speech ended are the next question, never a continuation (with answers sent about a second after a
 * question, the next "Next question. …" fell inside the 4 s rerun window on the real call), ms.
 */
export const NEW_QUESTION_GAP_MS = 2_500;

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
  /** ADR-0076: the start of the speech it answered (capture clock), for the rule-6 re-ask. */
  start?: number;
  /** When it was asked (Unix ms, the lines' time base). */
  askedAt: number;
  /** True when Kite asked it by itself. */
  auto: boolean;
  /**
   * 1.5.2 (ADR-0070): true when a press answered words that were still grey: if the person goes on, it is
   * asked again on its card, as an auto-answer is.
   */
  grey?: boolean;
  /**
   * 1.5.2: how many words the question had when it was asked. A line that only grew is asked again only
   * with GROWN_WORDS more (the model often writes the last word a moment after the pause).
   */
  words?: number;
  /**
   * Batch D (P0-B, ADR-0079): the start of the speech the card's ORIGINAL request answered (capture clock).
   * A re-ask never moves it, so the rule-6 window cannot walk forward from re-ask to re-ask.
   */
  anchorStart?: number;
  /** Batch D (P0-B): the end of the speech the card's original request answered. A re-ask never moves it. */
  anchorEnd?: number;
  /** Batch D (P0-B): how many times this question was asked again (at most MAX_REASKS). */
  reasks?: number;
  /**
   * Batch D (P0-C): the words the original request sent, to tell "the same sentence, finished" from a new
   * question. In memory only; never saved or logged.
   */
  askedText?: string;
}

/** 1.5.2 (ADR-0070): new words a line that only grew needs before its card is asked again. */
export const GROWN_WORDS = 2;

/**
 * Words in some text.
 *
 * @param text The text.
 * @returns How many.
 * Called from: autoAnswerDue(); useLiveAnswers.ts
 */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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
  /**
   * 1.5.2: when the last answer stopped streaming (the same clock as now), or null. A question that came
   * due while it streamed is still answered just after (AFTER_STREAM_GRACE_MS).
   */
  idleSince?: number | null;
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
 * Whether a line is something the user really said in reply (a turn): not a blip, and (1.5.2, ADR-0070)
 * not speech that began while the other person was still talking (reply.ts).
 *
 * @param line  A visible line.
 * @param lines The visible lines it is among.
 * @returns True for a "You" line that is a reply.
 * Called from: questionWindow(), continuationOf(), autoAnswerDue()
 */
function isUserTurn(line: Utterance, lines: readonly Utterance[]): boolean {
  return line.speaker === 'you' && !isBlip(line.text) && !startedOverThem(line, lines);
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
  // The user's last finished turn (their grey words may still be a blip or not).
  const lastTurn = spoken.findLastIndex((line) => line.final && isUserTurn(line, spoken));
  return spoken.slice(lastTurn + 1).filter((line) => {
    if (line.speaker !== 'them' || answered.has(line.id)) return false;
    // Their "mm-hm" while the user answered is not part of their next question.
    if (isBlip(line.text)) return false;
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
    // The user took the turn after the question (finished or still talking): what follows is a new
    // exchange.
    if (isUserTurn(line, spoken)) return [];
    if (line.speaker !== 'them') continue;
    const grown = last.lineIds.includes(line.id);
    // The other person's "mm-hm" while the user answers is listening, never more of the question
    // (measured on the synthetic calls, ADR-0063: it caused a late rerun).
    if (!grown && isBlip(line.text)) continue;
    if (!grown && line.tStart > from + withinMs) return after;
    const kind = lineKind(line.text);
    if (!grown && (kind === 'greeting' || kind === 'instruction' || kind === 'meta')) return after;
    // 1.5.2: a question of its own after a real gap is the next question (its own card).
    if (!grown && kind === 'question' && line.tStart - last.end > NEW_QUESTION_GAP_MS) return after;
    after.push(line);
  }
  return after;
}

/**
 * 1.5.2 (ADR-0070): whether a grey line paused and the end-of-turn model heard the speaker finish at that
 * pause, with no voice since: the question can be answered before its line is final.
 *
 * @param line A visible line.
 * @returns True for a grey line judged finished at its pause.
 * Called from: pauseNeeded(), endOf(), autoAnswerDue()
 */
export function finishedAtPause(line: Utterance): boolean {
  const pause = line.pause;
  // The pause holds until the voice comes back (the transcript removes it then); words written a moment
  // late from audio before it do not end it.
  if (line.final || !pause || typeof pause.turnEnd !== 'number') return false;
  // Words that look cut off ("…and") need the clearer judgment, as for a final line (ADR-0065).
  return pause.turnEnd >= (looksUnfinished(line.text) ? TURN_FINISHED_AT : EARLY_TURN_AT);
}

/**
 * Where a window's speech ended: a grey line judged finished at its pause ends at that pause.
 *
 * @param line The window's last line.
 * @returns The end of speech (Unix ms).
 * Called from: autoAnswerDue()
 */
function endOf(line: Utterance): number {
  return finishedAtPause(line) ? line.pause!.speechEnd : line.tEnd;
}

/**
 * How long to wait after a window's last line before answering it.
 *
 * @param window           The window's lines.
 * @param now              The current time (Unix ms).
 * @param waitForAccurate  False for a rerun: it does not wait for the accurate engine's words.
 * @returns The pause needed, in ms (Infinity when the accurate engine is still busy and may still be).
 * Called from: autoAnswerDue()
 */
function pauseNeeded(window: readonly Utterance[], now: number, waitForAccurate = true): number {
  const last = window.at(-1)!;
  // 1.5.2 (ADR-0070): the model already heard the speaker finish at the pause: no more waiting, and no
  // waiting for the accurate engine either (a better word or two does not change the answer; on the real
  // call that wait made answers 0.5 s later).
  if (finishedAtPause(last)) return 0;
  // v1.4 (ADR-0065): the end-of-turn model may only SHORTEN the wait. When the words look cut off
  // (3 s), a clear "finished" from the voice (TURN_FINISHED_AT) brings it back to 1.2 s; while it is
  // still judging, wait for it, at most TURN_WAIT_MS past the short pause (always inside the 3 s).
  // It never lengthens a wait: on the synthetic calls (ADR-0063) its "not finished" also hit real
  // question ends, and a premature answer is already asked again on its card (the rerun).
  let unfinished = looksUnfinished(last.text);
  if (unfinished) {
    if (last.turnEnd === 'pending' && now - last.tEnd < AUTO_PAUSE_MS + TURN_WAIT_MS) {
      return Number.POSITIVE_INFINITY;
    }
    if (typeof last.turnEnd === 'number' && last.turnEnd >= TURN_FINISHED_AT) unfinished = false;
  }
  const pause = unfinished ? UNFINISHED_PAUSE_MS : AUTO_PAUSE_MS;
  // Wait for the accurate engine's words, but never more than ACCURATE_WAIT_MS on top.
  if (
    waitForAccurate &&
    window.some((line) => line.refining) &&
    now - last.tEnd < pause + ACCURATE_WAIT_MS
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return pause;
}

/**
 * Whether an auto-answer (or a rerun) is due now, and for which lines.
 *
 * @param input See AutoAnswerState.
 * @param now   The current time, in the lines' time base (ms).
 * @returns What to do, or null when nothing is due.
 * Called from: useAutoAnswer.ts (on a timer); tests
 */
export function autoAnswerDue(input: AutoAnswerState, now: number): AutoDecision | null {
  // 1.5.2 (ADR-0070): lines are read with the punctuation model's marks when they have no marks yet.
  const state = { ...input, lines: input.lines.map(readableLine) };
  const last = state.last;
  // 1.5.2: a press that answered grey words is asked again when the person goes on, even with auto-answer
  // off; nothing else happens by itself then.
  if (!state.enabled && !last?.grey) return null;
  const spoken = speech(state.lines);
  // The other person still speaking (a grey line that changed lately) means the question may go on.
  // The user's own grey line does not wait (measured on the synthetic calls, ADR-0063): people start
  // "So, um…" right after a question, which is exactly when they need the answer. A finished reply
  // from the user still ends the moment (the window below). 1.5.2 (ADR-0070): unless that grey line paused
  // and the end-of-turn model heard them finish there.
  if (
    spoken.some(
      (line) =>
        !line.final &&
        line.speaker === 'them' &&
        now - line.tEnd < STALE_PARTIAL_MS &&
        !finishedAtPause(line),
    )
  ) {
    return null;
  }

  // The other person went on after an auto-answer (1.5.2: or a press on grey words) started: ask again
  // with the whole question.
  if (last?.auto || last?.grey) {
    const more = continuationOf(state.lines, last, RERUN_WINDOW_MS, last.askedAt);
    if (more.length > 0) {
      const whole = [
        ...spoken.filter((line) => last.lineIds.includes(line.id) && !more.includes(line)),
        ...more,
      ];
      const end = Math.max(...more.map((line) => endOf(line)));
      // 1.5.2: the same lines with a word or so more are not a new question (no second request).
      const onlyGrown = more.every((line) => last.lineIds.includes(line.id));
      const words = wordCount(whole.map((line) => line.text).join(' '));
      if (onlyGrown && last.words !== undefined && words < last.words + GROWN_WORDS) return null;
      // ADR-0066: a rerun does not wait for the accurate engine. Its card is already on screen and the
      // user is about to reply; on the synthetic calls that wait let the user's first words cancel
      // the rerun, and the rest of the question then got a card of its own.
      if (now - end < pauseNeeded(more, now, false)) return null;
      return {
        kind: 'rerun',
        replaces: last.answerId,
        lineIds: whole.map((line) => line.id),
        tEnd: end,
      };
    }
  }

  if (!state.enabled || state.streaming) return null;
  const window = questionWindow(state.lines, state.answeredLineIds);
  if (window.length === 0) return null;
  // The newest words must be the other person's: a finished reply from the user ends the moment
  // (their grey words do not, see above; 1.5.2: nor does speech of theirs that began over the question).
  const newest = spoken
    .filter(
      (line) =>
        (line.final || finishedAtPause(line)) &&
        (line.speaker === 'them' || isUserTurn(line, spoken)),
    )
    .at(-1);
  if (!newest || newest.speaker !== 'them') return null;
  const text = window.map((line) => line.text.trim()).join(' ');
  if (!isAutoQuestion(text)) return null;
  const end = endOf(window.at(-1)!);
  if (now - end < pauseNeeded(window, now)) return null;
  // Too old to answer by itself, unless it came due while another answer was streaming (1.5.2): then it
  // is answered as soon as that one finishes.
  const cameDueWhileStreaming =
    state.idleSince != null &&
    now - state.idleSince <= AFTER_STREAM_GRACE_MS &&
    end + AUTO_PAUSE_MS >= (last?.askedAt ?? 0);
  if (now - end > AUTO_MAX_AGE_MS && !cameDueWhileStreaming) return null;
  return { kind: 'answer', lineIds: window.map((line) => line.id), tEnd: end };
}
