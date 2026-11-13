/**
 * File: apps/web/src/core/answer/speculative.ts
 * Purpose: The speculative auto-answer (Batch C, P1-1; investigation D1). In calls with cloud transcription,
 *          auto-answer sends its request at the other side's end of turn (Flux EndOfTurn). On the real
 *          Claude voice that end came early in 14 of 26 questions (the voice paused between the sentences of
 *          one question), so the answer streams into a card that is held hidden for SPECULATIVE_HOLD_MS:
 *          - if the other person goes on within the hold (new words, or Flux StartOfTurn / TurnResumed), the
 *            request is cancelled silently and nothing was ever shown; the next end of turn asks the whole
 *            question;
 *          - otherwise the card is shown when the hold ends; if the turn really continues after that, the
 *            rule-6 re-ask of newestQuestion.ts asks again on the same card.
 *          This module holds the timer and the decisions; useLiveAnswers.ts does the cancelling and showing.
 * Used by: src/features/live/useLiveAnswers.ts; tests/unit/core/answer/speculative.test.ts
 * Depends on: src/core/transcript (blip.ts isBlip, transcript.ts Utterance)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md D1, E3 rule 9; ADR-0078
 *
 * Ids and times only: transcript text is read to count words, never logged.
 */
import { isBlip } from '../transcript/blip';
import type { Utterance } from '../transcript/transcript';

/** How long a speculative answer stays hidden while the other person may still go on, ms (D1). */
export const SPECULATIVE_HOLD_MS = 400;

/** What the hold reports to the timing trace. */
export type SpeculativeState = 'held' | 'shown' | 'cancelled';

/** Timer functions (tests pass fakes). */
export interface HoldTimers {
  /** Starts a timer. */
  set: (run: () => void, ms: number) => unknown;
  /** Stops a timer. */
  clear: (handle: unknown) => void;
}

/** Options for createSpeculativeHold(). */
export interface SpeculativeHoldOptions {
  /** How long to hold, ms (default SPECULATIVE_HOLD_MS). */
  holdMs?: number;
  /** The clock, ms (default Date.now). */
  now?: () => number;
  /** Timers (default setTimeout / clearTimeout). */
  timers?: HoldTimers;
  /**
   * Trace (ids and times only).
   *
   * @param state    What happened.
   * @param answerId The answer.
   * @param ms       How long after the hold started.
   */
  onTrace?: (state: SpeculativeState, answerId: string, ms: number) => void;
}

/** What happens to one held answer. */
export interface HeldAnswer {
  /** The hold ended with no new speech (or the user pressed Answer): show the card. */
  onShow: () => void;
  /** The other person went on within the hold: cancel the request and forget the card, silently. */
  onCancel: () => void;
}

/** The running hold. */
export interface SpeculativeHold {
  /**
   * Starts holding a new speculative answer. A hold still running is cancelled first (a newer request
   * replaces it).
   *
   * @param answerId The answer's id (its card).
   * @param held     What to do when it is shown or cancelled.
   */
  start(answerId: string, held: HeldAnswer): void;
  /**
   * The other person went on (new words, or a turn started or resumed). Cancels the held answer.
   *
   * @returns True when an answer was cancelled.
   */
  activity(): boolean;
  /**
   * Shows the held answer now (the user pressed Answer while it was held: they want it).
   *
   * @returns True when an answer was shown.
   */
  release(): boolean;
  /**
   * Whether an answer is held now.
   *
   * @param answerId Only this answer (default: any).
   * @returns True while held.
   */
  holding(answerId?: string): boolean;
  /** Forgets the hold without showing or cancelling (End, a new call, or the answer was replaced). */
  drop(): void;
}

/**
 * Creates the hold for one call.
 *
 * @param options See SpeculativeHoldOptions.
 * @returns The hold.
 * Called from: useLiveAnswers.ts; tests
 */
export function createSpeculativeHold(options: SpeculativeHoldOptions): SpeculativeHold {
  const holdMs = options.holdMs ?? SPECULATIVE_HOLD_MS;
  const now = options.now ?? Date.now;
  const timers: HoldTimers = options.timers ?? {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let current: { answerId: string; startedAt: number; timer: unknown; held: HeldAnswer } | null =
    null;

  /**
   * Ends the current hold one way or the other.
   *
   * @param outcome 'shown' or 'cancelled'.
   */
  const settle = (outcome: 'shown' | 'cancelled') => {
    const held = current;
    if (!held) return;
    current = null;
    timers.clear(held.timer);
    options.onTrace?.(outcome, held.answerId, now() - held.startedAt);
    if (outcome === 'shown') held.held.onShow();
    else held.held.onCancel();
  };

  return {
    start(answerId, held) {
      if (current) settle('cancelled');
      const timer = timers.set(() => {
        if (current?.answerId === answerId) settle('shown');
      }, holdMs);
      current = { answerId, startedAt: now(), timer, held };
      options.onTrace?.('held', answerId, 0);
    },
    activity() {
      if (!current) return false;
      settle('cancelled');
      return true;
    },
    release() {
      if (!current) return false;
      settle('shown');
      return true;
    },
    holding(answerId) {
      return current !== null && (answerId === undefined || current.answerId === answerId);
    },
    drop() {
      if (current) timers.clear(current.timer);
      current = null;
    },
  };
}

/** The speech a speculative answer asked about. */
export interface AskedSpeech {
  /** The lines it was in. */
  lineIds: readonly string[];
  /** The end of that speech (capture clock, Unix ms). */
  end: number;
  /**
   * How many words the asked lines held when the request was sent (whole lines, not only the words sent:
   * a joined line can hold an earlier, answered stretch).
   */
  lineWords: number;
}

/**
 * Words in a text.
 *
 * @param text The text.
 * @returns How many.
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Whether the other person went on after the asked speech: a "Them" line with words that ended after it
 * and is not among the asked lines (a new turn), or an asked line that gained words. Listening sounds
 * ("mm-hm") and marks of lost audio do not count.
 *
 * @param lines The visible lines, in order.
 * @param asked What was asked.
 * @returns True when they went on.
 * Called from: useLiveAnswers.ts (each transcript change while an answer is held); tests
 */
export function themWentOn(lines: readonly Utterance[], asked: AskedSpeech): boolean {
  let askedWords = 0;
  for (const line of lines) {
    if (line.speaker !== 'them' || line.gap || line.text.trim() === '') continue;
    if (asked.lineIds.includes(line.id)) {
      askedWords += countWords(line.text);
      continue;
    }
    if (line.tEnd > asked.end && !isBlip(line.text)) return true;
  }
  // An asked line that grew (with one clock any new word counts, E3 rule 6).
  return askedWords > asked.lineWords;
}
