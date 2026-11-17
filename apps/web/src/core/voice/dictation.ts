/**
 * File: apps/web/src/core/voice/dictation.ts
 * Purpose: Turns speech-to-text events into one dictated message for Kite (item 8, ADR-0038): it
 *          collects the final lines heard while listening, and once the speaker pauses for
 *          SEND_PAUSE_MS after a final line, it sends the collected text once and stops listening.
 *          Filler alone ("um", "uh") is not sent. If nothing is heard for IDLE_STOP_MS, it stops
 *          without sending, so the microphone is never left diverted by accident. Also decides
 *          whether a call's "You" line is diverted away from the transcript (shouldDivert()).
 * Used by: src/core/voice/micSession.ts users (src/features/ask-kite/useVoiceInput.ts),
 *          src/features/live/useCallDictation.ts
 * Depends on: @kite/shared (TargetChoice)
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md
 *
 * No React and no browser APIs: timers are injected, so tests drive the clock. Dictated text is
 * never logged.
 */
import type { TargetChoice } from '@kite/shared';

/**
 * How long the speaker must stay quiet after a final line before the message is sent, in ms (spec S14):
 * long enough for a breath between sentences, short enough to feel like "it sends when I stop".
 */
export const SEND_PAUSE_MS = 1_000;

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

/** Timer functions (the browser's by default; tests pass fakes). */
export interface DictationTimers {
  /** Starts a timer. */
  set: (callback: () => void, ms: number) => unknown;
  /** Cancels a timer started by set(). */
  clear: (handle: unknown) => void;
}

/** Options for createDictation(). */
export interface DictationOptions {
  /** Called once with the collected text when the speaker pauses; listening then stops. */
  onSend: (text: string) => void;
  /** Called with the text so far (finals and the current partial) as it changes. Optional. */
  onChange?: (text: string) => void;
  /** Called when listening stops without sending (stop(), or nothing heard). Optional. */
  onStop?: (reason: 'stopped' | 'idle') => void;
  /** The pause that sends, in ms (default SEND_PAUSE_MS). */
  pauseMs?: number;
  /** The silence that stops listening, in ms (default IDLE_STOP_MS). */
  idleMs?: number;
  /** Timers (default setTimeout/clearTimeout). */
  timers?: DictationTimers;
}

/** One dictation: listening for one message at a time. */
export interface Dictation {
  /** Starts listening for a new message (clears anything collected before). */
  start: () => void;
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
   * Feeds a finished utterance.
   *
   * @param text The final text.
   */
  final: (text: string) => void;
  /** The text collected so far (finals and the current partial). */
  text: () => string;
}

/** The browser's timers. */
const BROWSER_TIMERS: DictationTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

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
  const pauseMs = options.pauseMs ?? SEND_PAUSE_MS;
  const idleMs = options.idleMs ?? IDLE_STOP_MS;
  let active = false;
  let finals: string[] = [];
  let current = '';
  let sendTimer: unknown = null;
  let idleTimer: unknown = null;

  const collected = () =>
    [...finals, current]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');

  /** Cancels both timers. */
  const clearTimers = () => {
    if (sendTimer !== null) timers.clear(sendTimer);
    if (idleTimer !== null) timers.clear(idleTimer);
    sendTimer = null;
    idleTimer = null;
  };

  /** Restarts the "nothing heard" timer: any speech counts as activity. */
  const armIdle = () => {
    if (idleTimer !== null) timers.clear(idleTimer);
    idleTimer = timers.set(() => {
      idleTimer = null;
      if (!active) return;
      active = false;
      clearTimers();
      finals = [];
      current = '';
      options.onStop?.('idle');
    }, idleMs);
  };

  /** Sends what was collected if it says something; otherwise keeps listening for more. */
  const flush = () => {
    sendTimer = null;
    if (!active) return;
    const text = collected();
    if (!isMeaningful(text)) {
      // Only "um": forget it and keep listening for the real message.
      finals = [];
      current = '';
      options.onChange?.('');
      return;
    }
    active = false;
    clearTimers();
    finals = [];
    current = '';
    options.onSend(text);
  };

  return {
    start() {
      clearTimers();
      finals = [];
      current = '';
      active = true;
      armIdle();
    },
    stop() {
      const was = active;
      active = false;
      clearTimers();
      finals = [];
      current = '';
      if (was) options.onStop?.('stopped');
    },
    listening: () => active,
    partial(text) {
      if (!active) return;
      current = text;
      if (text.trim() === '') return;
      // The speaker is talking again: the pause has not happened yet.
      if (sendTimer !== null) {
        timers.clear(sendTimer);
        sendTimer = null;
      }
      armIdle();
      options.onChange?.(collected());
    },
    final(text) {
      if (!active) return;
      current = '';
      if (text.trim() !== '') finals.push(text.trim());
      armIdle();
      options.onChange?.(collected());
      if (sendTimer !== null) timers.clear(sendTimer);
      sendTimer = timers.set(flush, pauseMs);
    },
    text: collected,
  };
}
