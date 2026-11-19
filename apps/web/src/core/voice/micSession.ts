/**
 * File: apps/web/src/core/voice/micSession.ts
 * Purpose: Speech-to-text from the microphone outside a call, for talking to Ask Kite (item 8,
 *          ADR-0038). It reuses the call's own pieces: the platform's microphone (the same
 *          constraints as the "You" channel) and the on-device speech engine (createSttEngine),
 *          attached as the "you" channel. The engine is created on first use and kept until
 *          close(), so a second question does not reload the model; the microphone is opened only
 *          while listening, so the system's microphone indicator is off in between.
 * Used by: src/features/ask-kite/useVoiceInput.ts
 * Depends on: src/core/stt/sttEngine.ts (createSttEngine), src/platform (getPlatform: microphone)
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md; kite-architecture-v3.1.md §7.1
 *
 * Audio stays on this device (as in a call); recognised text is only handed to the caller, never
 * logged.
 */
import { getPlatform } from '@/platform';
import { createSttEngine, type SttEngine, type SttEngineOptions } from '../stt/sttEngine';

/** What the microphone session is doing. */
export type MicState = 'idle' | 'loading' | 'listening';

/** Options for createMicSession(). */
export interface MicSessionOptions {
  /** The current partial text of what is being said ('' when cleared). */
  onPartial: (text: string) => void;
  /** A finished utterance. */
  onFinal: (text: string) => void;
  /** A failure, as a sentence to show (microphone refused, model failed). */
  onError: (message: string) => void;
  /** The state, whenever it changes. Optional. */
  onState?: (state: MicState) => void;
}

/** What the session needs from the browser (tests pass fakes). */
export interface MicSessionDeps {
  /** Creates the speech engine. */
  createEngine: (
    options: SttEngineOptions,
  ) => Pick<SttEngine, 'ready' | 'attach' | 'detach' | 'stop'>;
  /** Opens the microphone. */
  openMic: () => Promise<MediaStream>;
}

/** A microphone → speech-to-text session. */
export interface MicSession {
  /** Loads the model if needed, opens the microphone and starts transcribing. Never rejects. */
  start: () => Promise<void>;
  /** Stops transcribing and closes the microphone; the model stays loaded. */
  stop: () => void;
  /** Stops everything and ends the engine; the session cannot be used afterwards. */
  close: () => void;
  /** The current state. */
  state: () => MicState;
}

/**
 * A short sentence for a failure to start.
 *
 * @param error What start() caught.
 * @param mac   True on a Mac (1.8.0, ADR-0111: the words name macOS's setting); default false.
 * @returns The sentence to show.
 * Called from: createMicSession(); tests
 */
export function micErrorMessage(error: unknown, mac = false): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return mac
      ? 'Paramount AI can’t use the microphone. Turn it on under System Settings → Privacy & Security → Microphone (Paramount AI, or your browser), then try again.'
      : 'Paramount AI can’t use the microphone. Allow it for this site (or for Paramount AI in your system settings), then try again.';
  }
  // v1.0.3: Windows reports a microphone that its privacy settings block, or that another app holds,
  // as NotReadableError; say where to look instead of the generic sentence.
  if (name === 'NotReadableError' || name === 'AbortError') {
    return mac
      ? 'The microphone is blocked or busy. Check System Settings → Privacy & Security → Microphone, close other apps using it, then try again.'
      : 'The microphone is blocked or busy. In Windows, check Settings → Privacy & security → Microphone (allow desktop apps), close other apps using it, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. Connect one, then try again.';
  }
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === 'string' && code.startsWith('download-')) {
    return 'Paramount AI couldn’t load the speech model. Check your connection, then try again.';
  }
  return 'Voice input could not start. Try again, or type your question.';
}

/**
 * The real browser objects: the engine with its defaults, and the platform's microphone.
 *
 * @returns Default dependencies.
 * Called from: createMicSession() (default argument)
 */
function defaultDeps(): MicSessionDeps {
  return {
    createEngine: (options) => createSttEngine(options),
    openMic: () => getPlatform().getMicStream(),
  };
}

/**
 * Creates a microphone session.
 *
 * @param options Callbacks.
 * @param deps    Engine and microphone (tests).
 * @returns The session (idle until start()).
 * Called from: src/features/ask-kite/useVoiceInput.ts; tests
 */
export function createMicSession(
  options: MicSessionOptions,
  deps: MicSessionDeps = defaultDeps(),
): MicSession {
  let engine: ReturnType<MicSessionDeps['createEngine']> | null = null;
  let stream: MediaStream | null = null;
  let state: MicState = 'idle';
  let closed = false;
  /** Increases with every start() and stop(), so a start that finishes late is undone. */
  let generation = 0;

  const setState = (next: MicState) => {
    state = next;
    options.onState?.(next);
  };

  /** Closes the microphone, if open. */
  const releaseMic = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  /**
   * The engine, created on first use with callbacks that only pass text on while listening.
   *
   * @returns The engine.
   */
  const ensureEngine = () => {
    engine ??= deps.createEngine({
      onPartial: ({ channel, text }) => {
        if (channel === 'you' && state === 'listening') options.onPartial(text);
      },
      onFinal: ({ channel, text }) => {
        if (channel === 'you' && state === 'listening') options.onFinal(text);
      },
      onError: (error) => {
        // A decoding failure mid-way: stop listening and say so (the code only, never text).
        if (state !== 'idle') {
          releaseMic();
          setState('idle');
          options.onError(micErrorMessage(error, getPlatform().hotkeyModifier() === '⌘'));
        }
      },
    });
    return engine;
  };

  return {
    async start() {
      if (closed || state !== 'idle') return;
      generation += 1;
      const mine = generation;
      setState('loading');
      try {
        const current = ensureEngine();
        await current.ready.catch((error: unknown) => {
          // A model that failed to load is dropped, so the next try loads it again.
          current.stop();
          if (engine === current) engine = null;
          throw error;
        });
        const mic = await deps.openMic();
        if (mine !== generation || closed) {
          // stop() or close() happened while loading: do not leave the microphone open.
          mic.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mic;
        await current.attach('you', mic);
        if (mine !== generation || closed) return;
        setState('listening');
      } catch (error) {
        if (mine !== generation) return;
        releaseMic();
        setState('idle');
        options.onError(micErrorMessage(error, getPlatform().hotkeyModifier() === '⌘'));
      }
    },
    stop() {
      generation += 1;
      if (state === 'idle') return;
      // detach() would turn the words in progress into a final line; listening has ended, so the
      // state goes idle first and the callbacks drop it.
      setState('idle');
      engine?.detach('you');
      releaseMic();
    },
    close() {
      generation += 1;
      closed = true;
      if (state !== 'idle') setState('idle');
      engine?.detach('you');
      releaseMic();
      engine?.stop();
      engine = null;
    },
    state: () => state,
  };
}
