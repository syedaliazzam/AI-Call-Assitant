/**
 * File: apps/web/src/core/voice/dictation.ts
 * Purpose: Turns speech-to-text events into one dictated message for Kite (item 8, ADR-0038), and (ADR-0101)
 *          sends a call's voice question as soon as the speaker stops:
 *          - at the first end-of-speech signal (Flux EagerEndOfTurn or EndOfTurn on the voice stream, a
 *            Nova-3 speech_final, an on-device final line) it asks the app to start the answer speculatively,
 *            held hidden (onSpeculate), and shows it (onSend) after holdMs with no new words; new words within
 *            the hold cancel it silently (onCancel) and the whole question is asked at the next signal;
 *          - words spoken within continueMs after it was shown extend the same question (onExtend: the app
 *            asks again, on the same card, with the whole question), so a thinking pause never leaves half a
 *            question;
 *          - with no signal at all, fallbackMs of silence after the last new words sends it;
 *          - words of an utterance that was already open when listening started (spoken before the key press)
 *            are not part of the question (skipWords).
 *          Filler alone ("um", "uh") is not sent. If nothing is heard for IDLE_STOP_MS, it stops without
 *          sending, so the microphone is never left diverted by accident. Also decides whether a call's "You"
 *          line is diverted away from the transcript (shouldDivert()).
 * Used by: src/core/voice/micSession.ts users (src/features/ask-kite/useVoiceInput.ts),
 *          src/features/live/useCallDictation.ts, src/core/voice/voiceMode.ts
 * Depends on: @kite/shared (TargetChoice)
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md;
 *               docs/decisions/ADR-0101-fast-voice-questions-for-everyone.md
 *
 * No React and no browser APIs: timers are injected, so tests drive the clock. Dictated text is
 * never logged.
 */
import type { TargetChoice } from '@kite/shared';

/**
 * Ask AI page (no end-of-speech signals there): how long the speaker must stay quiet after a final line
 * before the message is sent, in ms (spec S14; back to 1.5 s in ADR-0101, as a shorter pause cut questions
 * in two). In a call it is the hard fallback when no end-of-speech signal arrives (CALL_FALLBACK_MS).
 */
export const SEND_PAUSE_MS = 1_500;

/** ADR-0101: in a call, how long a speculative voice question stays hidden before it is shown, ms. */
export const VOICE_HOLD_MS = 300;

/**
 * ADR-0101: in a call, the silence after the last new words that sends the question when no end-of-speech
 * signal came (the developer's 1.5 s).
 */
export const CALL_FALLBACK_MS = 1_500;

/**
 * ADR-0101: in a call, how long after a question was shown more words still belong to it (they extend it,
 * on the same card), ms. Longer than the thinking pauses measured inside one question (1.2–2.3 s, counted
 * from the moment it was shown, which is itself 0.3–0.9 s after the speaker stopped).
 */
export const VOICE_CONTINUE_MS = 1_800;

/**
 * How long listening may go on with nothing heard, in ms, before it stops without sending. During a
 * call, listening diverts the user's own words away from the transcript, so it must not stay on
 * because the user forgot it.
 */
export const IDLE_STOP_MS = 15_000;

/** Words that are only hesitation: a message made of nothing else is not sent. */
const FILLER_WORDS = new Set(['um', 'uh', 'er', 'erm', 'hmm', 'hm', 'mm', 'mhm', 'ah', 'oh']);

/**
 * Whether dictated text is worth sending: it has at least one word that is not a filler.
 *
 * @param text The collected text.
 * @returns True when it says something.
 * Called from: createDictation(); tests
 */
export function isMeaningful(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
    .some((word) => !FILLER_WORDS.has(word));
}

/**
 * Whether a call's "You" line, heard while dictating, is kept out of the call. Words dictated to
 * Kite ("Auto" or "Ask Kite") are a question for Kite, not something said in the meeting, so they
 * must not become a "You" transcript line, be saved, or be sent in later prompts. With "For the
 * call" the user is answering out loud, so the line stays in the transcript (ADR-0038).
 *
 * @param listening True while dictating.
 * @param target    The current chat mode.
 * @returns True to divert the line away from the transcript.
 * Called from: src/features/live/useCallDictation.ts; tests
 */
export function shouldDivert(listening: boolean, target: TargetChoice): boolean {
  return listening && target !== 'call';
}

/**
 * ADR-0082: the target a voice question (Ctrl+Shift+Space, Ctrl+Alt+Enter) listens with. The spoken
 * question must never become a "You" transcript line or count as the user's reply, so it is always one
 * that is diverted (shouldDivert()): the chat switch's own choice, except "For the call", which becomes
 * "Auto".
 *
 * @param chatTarget The session's chat switch.
 * @returns The target to dictate with.
 * Called from: src/features/live/LiveAnswers.tsx; tests
 */
export function voiceQuestionTarget(chatTarget: TargetChoice): TargetChoice {
  return chatTarget === 'call' ? 'auto' : chatTarget;
}

/**
 * Text with its first `count` words taken off (ADR-0101: words spoken before the key press).
 *
 * @param text  The text.
 * @param count How many words to drop.
 * @returns What is left ('' when nothing).
 * Called from: createDictation(); tests
 */
export function withoutFirstWords(text: string, count: number): string {
  if (count <= 0) return text;
  return text.trim().split(/\s+/).filter(Boolean).slice(count).join(' ');
}

/** Timer functions (the browser's by default; tests pass fakes). */
export interface DictationTimers {
  /** Starts a timer. */
  set: (callback: () => void, ms: number) => unknown;
  /** Cancels a timer started by set(). */
  clear: (handle: unknown) => void;
}

/** ADR-0101: an end-of-speech signal from the speech engine. */
export type EndSignal =
  /** Flux EagerEndOfTurn: probably finished (may still go on). */
  | 'eager'
  /** Flux EndOfTurn: finished. */
  | 'end';

/** Options for createDictation(). */
export interface DictationOptions {
  /**
   * Called with the question when it is sent (shown): once per question, after its hold. With onSpeculate,
   * the same text was given to onSpeculate first (the app shows that request); a different text is new.
   */
  onSend: (text: string) => void;
  /**
   * ADR-0101: an end-of-speech signal with something said: start the answer for this text now, held hidden.
   * Optional: without it the question is only sent (onSend) after the hold.
   */
  onSpeculate?: (text: string) => void;
  /** ADR-0101: the speaker went on within the hold: cancel the hidden answer, silently. Optional. */
  onCancel?: () => void;
  /**
   * ADR-0101: the speaker went on within continueMs after the question was shown: ask again, on the same
   * card, with the whole question (this text). Optional (without it, later words are a new question).
   */
  onExtend?: (text: string) => void;
  /** Called with the text so far (finals and the current partial) as it changes. Optional. */
  onChange?: (text: string) => void;
  /**
   * Called when listening stops without sending (stop(), or nothing heard), or ('done') when a question's
   * time for more words ended (one question: listening is then over). Optional.
   */
  onStop?: (reason: 'stopped' | 'idle' | 'done') => void;
  /**
   * How long a speculative question stays hidden before it is shown, in ms (default SEND_PAUSE_MS, the
   * Ask AI page's pause; a call passes VOICE_HOLD_MS).
   */
  holdMs?: number;
  /** Silence after the last new words that sends without a signal, in ms (default: none). */
  fallbackMs?: number | null;
  /** After a question was shown, how long more words extend it, in ms (default 0: listening ends). */
  continueMs?: number;
  /** The silence that stops listening, in ms (default IDLE_STOP_MS). */
  idleMs?: number;
  /**
   * Whether words look cut off ("…the price of the"), so an early signal is not trusted (default: never).
   * The call passes core/transcript/complete.ts looksUnfinished().
   */
  unfinished?: (text: string) => boolean;
  /** Timers (default setTimeout/clearTimeout). */
  timers?: DictationTimers;
}

/** What start() takes (all optional). */
export interface StartOptions {
  /**
   * ADR-0101: how many words of the utterance already open when listening started were spoken before it
   * (the key press): they are not part of the question. Applies until that utterance's final line.
   */
  skipWords?: number;
  /** ADR-0101 (Voice mode): keep listening for the next question after each one, instead of stopping. */
  continuous?: boolean;
}

/** One dictation: listening for one message at a time. */
export interface Dictation {
  /**
   * Starts listening for a new message (clears anything collected before).
   *
   * @param options Words to skip, and whether to keep listening after each question.
   */
  start: (options?: StartOptions) => void;
  /** Stops listening without sending; calls onStop('stopped') if it was listening. */
  stop: () => void;
  /** True while listening. */
  listening: () => boolean;
  /**
   * Feeds the current partial text of the speaker's utterance ('' when cleared).
   *
   * @param text The partial text.
   */
  partial: (text: string) => void;
  /**
   * Feeds a finished utterance. It is also an end-of-speech signal (a Nova-3 speech_final, an on-device
   * final line).
   *
   * @param text The final text.
   */
  final: (text: string) => void;
  /**
   * ADR-0101: an end-of-speech signal from the engine (Flux on the voice stream).
   *
   * @param kind 'eager' (probably finished) or 'end' (finished).
   */
  signal: (kind: EndSignal) => void;
  /** ADR-0101: the engine says the speaker went on (Flux TurnResumed). */
  resumed: () => void;
  /**
   * ADR-0101 (Voice mode, the other person starts speaking): send what was said now, if it says anything.
   *
   * @returns True when something was sent or extended.
   */
  sendNow: () => boolean;
  /** The text collected so far (finals and the current partial). */
  text: () => string;
}

/** The browser's timers. */
const BROWSER_TIMERS: DictationTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Where a question is:
 * - 'listening': collecting words, nothing sent;
 * - 'held': sent speculatively (onSpeculate), hidden, the hold running;
 * - 'shown': sent (onSend), more words within continueMs extend it;
 * - 'extending': more words came after it was shown; the next signal (after the hold) extends it.
 */
type Phase = 'listening' | 'held' | 'shown' | 'extending';

/**
 * Creates a dictation.
 *
 * @param options Callbacks, timings and timers.
 * @returns The dictation (idle until start()).
 * Called from: src/features/ask-kite/useVoiceInput.ts, src/features/live/useCallDictation.ts;
 *              tests
 */
export function createDictation(options: DictationOptions): Dictation {
  const timers = options.timers ?? BROWSER_TIMERS;
  const holdMs = options.holdMs ?? SEND_PAUSE_MS;
  const fallbackMs = options.fallbackMs ?? null;
  const continueMs = options.continueMs ?? 0;
  const idleMs = options.idleMs ?? IDLE_STOP_MS;
  const unfinished = options.unfinished ?? (() => false);
  let active = false;
  let continuous = false;
  let phase: Phase = 'listening';
  let finals: string[] = [];
  let current = '';
  // ADR-0101: words of the utterance open at start() that were spoken before it.
  let skip = 0;
  // The text handed to onSpeculate / onSend / onExtend last.
  let sentText = '';
  let holdTimer: unknown = null;
  let fallbackTimer: unknown = null;
  let continueTimer: unknown = null;
  let idleTimer: unknown = null;

  const collected = () =>
    [...finals, current]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');

  /**
   * Cancels a timer.
   *
   * @param handle The timer, or null.
   * @returns null.
   */
  const cancel = (handle: unknown): null => {
    if (handle !== null) timers.clear(handle);
    return null;
  };

  /** Cancels every timer. */
  const clearTimers = () => {
    holdTimer = cancel(holdTimer);
    fallbackTimer = cancel(fallbackTimer);
    continueTimer = cancel(continueTimer);
    idleTimer = cancel(idleTimer);
  };

  /** Forgets the question (a new one starts from nothing). */
  const reset = () => {
    finals = [];
    current = '';
    phase = 'listening';
    sentText = '';
    holdTimer = cancel(holdTimer);
    fallbackTimer = cancel(fallbackTimer);
    continueTimer = cancel(continueTimer);
  };

  /** Restarts the "nothing heard" timer: any speech counts as activity. */
  const armIdle = () => {
    idleTimer = cancel(idleTimer);
    idleTimer = timers.set(() => {
      idleTimer = null;
      if (!active) return;
      // A question being shown or extended is not "nothing heard".
      if (phase !== 'listening') return;
      active = false;
      clearTimers();
      reset();
      options.onStop?.('idle');
    }, idleMs);
  };

  /** The question's time for more words is over: listen for the next one, or stop. */
  const finishQuestion = () => {
    continueTimer = null;
    if (!active) return;
    if (continuous) {
      reset();
      options.onChange?.('');
      armIdle();
      return;
    }
    active = false;
    clearTimers();
    reset();
    options.onStop?.('done');
  };

  /** Starts (or restarts) the time in which more words extend the question shown. */
  const armContinue = () => {
    continueTimer = cancel(continueTimer);
    if (continueMs <= 0) {
      finishQuestion();
      return;
    }
    continueTimer = timers.set(finishQuestion, continueMs);
  };

  /** The hold ended with no new words: show the question (or the whole question, extended). */
  const show = () => {
    holdTimer = null;
    if (!active) return;
    const text = collected();
    if (phase === 'extending') {
      sentText = text;
      phase = 'shown';
      options.onExtend?.(text);
      armContinue();
      return;
    }
    if (phase !== 'held') return;
    sentText = text;
    phase = 'shown';
    fallbackTimer = cancel(fallbackTimer);
    options.onSend(text);
    armContinue();
  };

  /**
   * An end of speech (a signal, a final line, the fallback, or sendNow()).
   *
   * @param strong True when the speaker surely finished (Flux EndOfTurn, the fallback, sendNow()): no hold.
   */
  const ended = (strong: boolean) => {
    if (!active) return;
    const text = collected();
    if (!isMeaningful(text)) {
      if (phase === 'listening' && text !== '') {
        // Only "um": forget it and keep listening for the real message.
        finals = [];
        current = '';
        options.onChange?.('');
      }
      return;
    }
    // Nothing new since the question was shown: nothing to do.
    if (phase === 'shown') return;
    // An early signal on words that look cut off is not trusted; the next signal or the fallback sends.
    if (!strong && unfinished(text)) return;
    if (phase === 'extending') {
      holdTimer = cancel(holdTimer);
      if (strong) show();
      else holdTimer = timers.set(show, holdMs);
      return;
    }
    if (phase === 'held' && text === sentText) {
      if (strong) {
        holdTimer = cancel(holdTimer);
        show();
      }
      return;
    }
    if (phase === 'held') {
      // Held, but the words changed since: that answer is for the wrong text.
      options.onCancel?.();
    }
    phase = 'held';
    sentText = text;
    options.onSpeculate?.(text);
    holdTimer = cancel(holdTimer);
    if (strong) show();
    else holdTimer = timers.set(show, holdMs);
  };

  /** New words: a held question is cancelled, a shown one will be extended, the fallback restarts. */
  const wordsChanged = () => {
    armIdle();
    if (phase === 'held') {
      holdTimer = cancel(holdTimer);
      phase = 'listening';
      sentText = '';
      options.onCancel?.();
    } else if (phase === 'shown') {
      continueTimer = cancel(continueTimer);
      phase = 'extending';
    } else if (phase === 'extending') {
      holdTimer = cancel(holdTimer);
    }
    fallbackTimer = cancel(fallbackTimer);
    if (fallbackMs !== null) {
      fallbackTimer = timers.set(() => {
        fallbackTimer = null;
        ended(true);
      }, fallbackMs);
    }
    options.onChange?.(collected());
  };

  return {
    start(startOptions = {}) {
      clearTimers();
      reset();
      active = true;
      continuous = startOptions.continuous === true;
      skip = Math.max(0, startOptions.skipWords ?? 0);
      armIdle();
    },
    stop() {
      const was = active;
      active = false;
      clearTimers();
      // A hidden answer never shows once listening is stopped.
      if (phase === 'held') options.onCancel?.();
      reset();
      if (was) options.onStop?.('stopped');
    },
    listening: () => active,
    partial(text) {
      if (!active) return;
      const own = withoutFirstWords(text, skip);
      const before = collected();
      current = own;
      if (own.trim() === '') return;
      if (collected() !== before) wordsChanged();
    },
    final(text) {
      if (!active) return;
      const own = withoutFirstWords(text, skip);
      // The utterance that was open at start() is over: later ones are all the speaker's question.
      skip = 0;
      const before = collected();
      current = '';
      if (own.trim() !== '') finals.push(own.trim());
      if (collected() !== before) wordsChanged();
      ended(false);
    },
    signal(kind) {
      ended(kind === 'end');
    },
    resumed() {
      if (!active) return;
      if (phase === 'held') {
        holdTimer = cancel(holdTimer);
        phase = 'listening';
        sentText = '';
        options.onCancel?.();
      } else if (phase === 'extending') {
        holdTimer = cancel(holdTimer);
      }
    },
    sendNow() {
      if (!active || !isMeaningful(collected()) || phase === 'shown') return false;
      ended(true);
      return true;
    },
    text: collected,
  };
}
