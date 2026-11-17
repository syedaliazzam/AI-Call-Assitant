/**
 * File: apps/web/src/core/voice/voiceMode.ts
 * Purpose: Voice mode's rules (ADR-0095: hands-free talking to the assistant during a call), without React:
 *          on, it keeps a dictation listening; after each question is sent, and after a quiet stretch, it
 *          listens again; while the other person speaks, and for VOICE_RESUME_MS after their last words, it
 *          pauses (their voice through the user's speakers must not become a question), dropping what was
 *          collected; off, it stops. While it is on (listening or paused), every word of the user's is for
 *          the assistant, never a "You" transcript line (diverts()).
 * Used by: src/features/live/useCallDictation.ts
 * Depends on: src/core/voice/dictation.ts (Dictation, DictationTimers)
 * Architecture: docs/decisions/ADR-0095-voice-mode-groq-and-move-keys.md
 *
 * Timers are injected, so tests drive the clock. No text passes through here.
 */
import type { Dictation, DictationTimers } from './dictation';

/**
 * How long Voice mode stays paused after the other person's last words, in ms (the developer's 2 s).
 */
export const VOICE_RESUME_MS = 2_000;

/** Voice mode's state. 'paused' while the other person speaks (and VOICE_RESUME_MS after). */
export type VoiceModeState = 'off' | 'listening' | 'paused';

/** Options for createVoiceMode(). */
export interface VoiceModeOptions {
  /** The call's dictation (the one the voice question uses too). */
  dictation: Pick<Dictation, 'start' | 'stop'>;
  /** Called with each new state, for the UI. */
  onChange: (state: VoiceModeState) => void;
  /** The pause after the other person's last words, in ms (default VOICE_RESUME_MS). */
  resumeMs?: number;
  /** Timers (default setTimeout/clearTimeout). */
  timers?: DictationTimers;
}

/** Voice mode for one call. */
export interface VoiceMode {
  /** The state now. */
  state: () => VoiceModeState;
  /** Turns it on: the dictation starts listening. */
  on: () => void;
  /** Turns it off: the dictation stops. */
  off: () => void;
  /** The other person is speaking: pause (dropping what was collected) until resumeMs after the last call. */
  them: () => void;
  /**
   * A question was just sent (the dictation stops itself then): listen for the next one.
   *
   * @returns True when Voice mode handled it (it is on).
   */
  afterSend: () => boolean;
  /**
   * The dictation stopped by itself (nothing heard for a while, or a stop this object asked for).
   *
   * @param reason Why it stopped.
   * @returns True when Voice mode handled it (it is on), so no "didn't catch a question" notice shows.
   */
  afterStop: (reason: 'stopped' | 'idle') => boolean;
  /** True while the user's words must stay out of the transcript (Voice mode is on). */
  diverts: () => boolean;
  /** Clears its timer (the call page is going away). */
  dispose: () => void;
}

/** The browser's timers. */
const BROWSER_TIMERS: DictationTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Creates Voice mode for a call (off).
 *
 * @param options The dictation, the change callback, the pause and timers.
 * @returns Voice mode.
 * Called from: src/features/live/useCallDictation.ts; tests
 */
export function createVoiceMode(options: VoiceModeOptions): VoiceMode {
  const timers = options.timers ?? BROWSER_TIMERS;
  const resumeMs = options.resumeMs ?? VOICE_RESUME_MS;
  let state: VoiceModeState = 'off';
  let resumeTimer: unknown = null;

  /**
   * Moves to a state and says so.
   *
   * @param next The new state.
   */
  const put = (next: VoiceModeState) => {
    if (state === next) return;
    state = next;
    options.onChange(next);
  };

  /** Cancels the resume timer. */
  const clearResume = () => {
    if (resumeTimer !== null) timers.clear(resumeTimer);
    resumeTimer = null;
  };

  return {
    state: () => state,
    on() {
      clearResume();
      put('listening');
      options.dictation.start();
    },
    off() {
      clearResume();
      if (state === 'off') return;
      put('off');
      options.dictation.stop();
    },
    them() {
      if (state === 'off') return;
      if (state === 'listening') {
        // The words collected so far may be the other person's voice through the speakers: dropped.
        put('paused');
        options.dictation.stop();
      }
      clearResume();
      resumeTimer = timers.set(() => {
        resumeTimer = null;
        if (state !== 'paused') return;
        put('listening');
        options.dictation.start();
      }, resumeMs);
    },
    afterSend() {
      if (state === 'off') return false;
      if (state === 'listening') options.dictation.start();
      return true;
    },
    afterStop(reason) {
      if (state === 'off') return false;
      // A quiet stretch is normal here: listen on. A stop Voice mode asked for (pause) needs nothing.
      if (state === 'listening' && reason === 'idle') options.dictation.start();
      return true;
    },
    diverts: () => state !== 'off',
    dispose: clearResume,
  };
}
