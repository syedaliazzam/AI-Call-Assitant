/**
 * File: apps/web/src/core/voice/voiceMode.ts
 * Purpose: Voice mode's rules (ADR-0095: hands-free talking to the assistant during a call), without React:
 *          on, it keeps a dictation listening continuously (one question after another); after a quiet
 *          stretch it listens again; while the other person really speaks, and for VOICE_RESUME_MS after
 *          their last words, it pauses; off, it stops. While it is on (listening or paused), every word of the
 *          user's is for the assistant, never a "You" transcript line (diverts()).
 *          ADR-0101: a short sound from the other side (fewer than THEM_SPEECH_WORDS words and shorter than
 *          THEM_SPEECH_MS: "mm-hmm", a noise) does not pause it; when real speech from them does, what the
 *          user had already said is sent first (dictation.sendNow()), not thrown away.
 * Used by: src/features/live/useCallDictation.ts
 * Depends on: src/core/voice/dictation.ts (Dictation, DictationTimers)
 * Architecture: docs/decisions/ADR-0095-voice-mode-groq-and-move-keys.md;
 *               docs/decisions/ADR-0101-fast-voice-questions-for-everyone.md
 *
 * Timers are injected, so tests drive the clock. No text passes through here.
 */
import type { Dictation, DictationTimers } from './dictation';

/**
 * How long Voice mode stays paused after the other person's last words, in ms (the developer's 2 s).
 */
export const VOICE_RESUME_MS = 2_000;

/** ADR-0101: the other person's speech pauses Voice mode from this many words of one utterance. */
export const THEM_SPEECH_WORDS = 3;

/** ADR-0101: …or once one utterance of theirs lasts this long, ms (the developer's ~1 s). */
export const THEM_SPEECH_MS = 1_000;

/** ADR-0101: what is known of the other person's speech so far (counts and times only). */
export interface ThemSpeech {
  /** Words in their current utterance. */
  words: number;
  /** How long it has lasted, ms (0 when not known). */
  ms: number;
}

/**
 * ADR-0101: whether the other side's sound is real speech (it pauses Voice mode) or a short sound ("mm-hmm",
 * a noise) that does not.
 *
 * @param speech Words and length of their utterance so far.
 * @returns True for real speech.
 * Called from: createVoiceMode(); tests
 */
export function isRealSpeech(speech: ThemSpeech): boolean {
  return speech.words >= THEM_SPEECH_WORDS || speech.ms >= THEM_SPEECH_MS;
}

/** Voice mode's state. 'paused' while the other person speaks (and VOICE_RESUME_MS after). */
export type VoiceModeState = 'off' | 'listening' | 'paused';

/** Options for createVoiceMode(). */
export interface VoiceModeOptions {
  /** The call's dictation (the one the voice question uses too). */
  dictation: Pick<Dictation, 'start' | 'stop' | 'sendNow'>;
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
  /** Turns it on: the dictation starts listening, continuously. */
  on: () => void;
  /** Turns it off: the dictation stops. */
  off: () => void;
  /**
   * The other person is making sound. ADR-0101: short sounds are ignored; real speech sends what the user
   * had said, then pauses until resumeMs after their last words.
   *
   * @param speech Words and length of their utterance so far.
   */
  them: (speech: ThemSpeech) => void;
  /**
   * A question was just sent. The dictation keeps listening by itself (continuous, ADR-0101).
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
  afterStop: (reason: 'stopped' | 'idle' | 'done') => boolean;
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

  /** Listens continuously (ADR-0101: one question after another, no restart between them). */
  const listen = (): void => {
    options.dictation.start({ continuous: true });
  };

  return {
    state: () => state,
    on() {
      clearResume();
      put('listening');
      listen();
    },
    off() {
      clearResume();
      if (state === 'off') return;
      put('off');
      options.dictation.stop();
    },
    them(speech) {
      if (state === 'off') return;
      // ADR-0101: "mm-hmm" or a noise: nothing changes, and nothing said is lost.
      if (!isRealSpeech(speech)) return;
      if (state === 'listening') {
        // ADR-0101: what the user already said is their question: sent now, not thrown away.
        options.dictation.sendNow();
        put('paused');
        options.dictation.stop();
      }
      clearResume();
      resumeTimer = timers.set(() => {
        resumeTimer = null;
        if (state !== 'paused') return;
        put('listening');
        listen();
      }, resumeMs);
    },
    afterSend() {
      return state !== 'off';
    },
    afterStop(reason) {
      if (state === 'off') return false;
      // A quiet stretch is normal here: listen on. A stop Voice mode asked for (pause) needs nothing.
      if (state === 'listening' && reason !== 'stopped') listen();
      return true;
    },
    diverts: () => state !== 'off',
    dispose: clearResume,
  };
}
