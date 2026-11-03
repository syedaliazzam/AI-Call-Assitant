/**
 * File: apps/web/src/features/ask-kite/useVoiceInput.ts
 * Purpose: The Ask Kite page's microphone (item 8, ADR-0038): press to talk, and the message is sent
 *          when you pause. Joins the microphone session (core/voice/micSession.ts) to the dictation
 *          (core/voice/dictation.ts): the words show in the box as they are heard, and the pause
 *          sends them through the page's normal send path.
 * Used by: src/features/ask-kite/AskKitePage.tsx
 * Depends on: src/core/voice/micSession.ts, src/core/voice/dictation.ts, React
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md
 *
 * Dictated text is only shown and sent as the user's message; never logged.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDictation } from '@/core/voice/dictation';
import { createMicSession, type MicSession, type MicState } from '@/core/voice/micSession';

/** What the page passes in. */
export interface VoiceInputOptions {
  /** The message so far, as it is heard (shown in the box). */
  onPreview: (text: string) => void;
  /** The finished message, after the pause: send it. */
  onSend: (text: string) => void;
}

/** The microphone's controls and state. */
export interface VoiceInput {
  /** 'loading' while the model loads or the microphone opens; 'listening'; 'idle'. */
  state: MicState;
  /** A failure to show, or null. */
  error: string | null;
  /**
   * Starts listening. What is already typed stays in front of the dictated words.
   *
   * @param typed The box's current text.
   */
  start: (typed: string) => void;
  /** Stops listening without sending. */
  stop: () => void;
}

/**
 * The Ask Kite microphone.
 *
 * @param options Preview and send callbacks.
 * @returns The controls and state.
 * Called from: AskKitePage.tsx
 */
export function useVoiceInput(options: VoiceInputOptions): VoiceInput {
  const [state, setState] = useState<MicState>('idle');
  const [error, setError] = useState<string | null>(null);
  // The latest callbacks, read when speech arrives (the session and dictation live for the page).
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  /** What was typed before listening started; the dictated words follow it. */
  const typedRef = useRef('');
  const mic = useRef<MicSession | null>(null);

  // Created once for the page; the engine inside loads only on the first press.
  useEffect(() => {
    /**
     * Joins the typed text and the dictated words.
     *
     * @param text The dictated words.
     * @returns The message.
     */
    const withTyped = (text: string) => [typedRef.current, text].filter(Boolean).join(' ');
    const words = createDictation({
      onChange: (text) => latest.current.onPreview(withTyped(text)),
      onSend: (text) => {
        mic.current?.stop();
        latest.current.onSend(withTyped(text));
      },
      onStop: () => mic.current?.stop(),
    });
    const session = createMicSession({
      onPartial: (text) => words.partial(text),
      onFinal: (text) => words.final(text),
      onError: (message) => {
        words.stop();
        setError(message);
      },
      onState: (next) => {
        setState(next);
        // Collect only once the microphone is really open: the first press may download and load
        // the model, which must not count towards the "nothing heard" stop. When the microphone
        // stops (sent, stopped or an error), collecting stops too.
        if (next === 'listening') words.start();
        else if (next === 'idle') words.stop();
      },
    });
    mic.current = session;
    return () => {
      words.stop();
      session.close();
      mic.current = null;
    };
  }, []);

  const start = useCallback((typed: string) => {
    setError(null);
    typedRef.current = typed.trim();
    void mic.current?.start();
  }, []);

  const stop = useCallback(() => {
    // Stopping the microphone stops the dictation too (onState above).
    mic.current?.stop();
  }, []);

  return { state, error, start, stop };
}
