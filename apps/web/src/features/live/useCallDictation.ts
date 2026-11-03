/**
 * File: apps/web/src/features/live/useCallDictation.ts
 * Purpose: Talking to Kite during a call (item 8, ADR-0038): the microphone button in the message
 *          box, the overlay and the script bar turns the user's speech into a question. It uses the
 *          call's own "You" channel (no second microphone or engine). While listening for Kite
 *          ("Auto" or "Ask Kite"), the user's words are diverted: they never become a "You"
 *          transcript line, are not saved and are not sent in later prompts. With "For the call"
 *          they stay a normal "You" line and are also used as the question. The question is sent
 *          when the user pauses, and listening then stops. During calls nothing is read aloud.
 * Used by: src/features/live/LivePage.tsx (creates it and routes the "You" channel through it);
 *          src/features/live/LiveAnswers.tsx (the controls, via the `dictation` prop)
 * Depends on: src/core/voice/dictation.ts, @kite/shared (TargetChoice), React
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md
 *
 * Dictated text is only handed to the answer path; never logged.
 */
'use client';

import type { TargetChoice } from '@kite/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDictation, shouldDivert, type Dictation } from '@/core/voice/dictation';

/** Receives a dictated question and the chat mode it was spoken in. */
export type DictationHandler = (text: string, target: TargetChoice) => void;

/** The controls the call's UI uses. */
export interface CallDictation {
  /** True when speech-to-text dictation is available in this call (mic channel running). */
  supported: boolean;
  /** True while listening for a dictated question. */
  listening: boolean;
  /** Starts listening; `target` is the current chat mode. */
  start: (target: TargetChoice) => void;
  /** Stops listening without sending. */
  stop: () => void;
  /**
   * Sets who receives the dictated question (LiveAnswers sends it as a chat question); null to stop
   * receiving. Replaces the handler given to the hook, if any.
   */
  setOnText: (handler: DictationHandler | null) => void;
}

/**
 * Where the live page sends the "You" channel's speech while a call runs. Each returns true when
 * the words were diverted (the page must then keep them out of the transcript).
 */
export interface DictationRoute {
  /**
   * A partial "You" text.
   *
   * @param text The partial text ('' when cleared).
   * @returns True to keep it out of the transcript.
   */
  partial: (text: string) => boolean;
  /**
   * A final "You" line.
   *
   * @param text The final text.
   * @returns True to keep it out of the transcript.
   */
  final: (text: string) => boolean;
}

/** What useCallDictation() takes. */
export interface CallDictationInput {
  /** True while the call is connected (the "You" channel is running). */
  available: boolean;
  /** Receives the dictated question; optional (setOnText() can set it later). */
  onText?: DictationHandler;
}

/**
 * The call's dictation.
 *
 * @param input Whether the call is connected, and an optional receiver.
 * @returns `dictation` for the UI and `route` for the live page's engine callbacks (stable, so the
 *          engine is never rebuilt because of it).
 * Called from: LivePage.tsx
 */
export function useCallDictation(input: CallDictationInput): {
  dictation: CallDictation;
  route: DictationRoute;
} {
  const [listening, setListening] = useState(false);
  const targetRef = useRef<TargetChoice>('auto');
  const handlerRef = useRef<DictationHandler | null>(input.onText ?? null);
  const listeningRef = useRef(false);
  const dictationRef = useRef<Dictation | null>(null);
  const inputHandler = input.onText;
  useEffect(() => {
    if (inputHandler) handlerRef.current = inputHandler;
  }, [inputHandler]);

  // One dictation for the call; the engine callbacks reach it through `route`.
  useEffect(() => {
    const words = createDictation({
      onSend: (text) => {
        listeningRef.current = false;
        setListening(false);
        handlerRef.current?.(text, targetRef.current);
      },
      onStop: () => {
        listeningRef.current = false;
        setListening(false);
      },
    });
    dictationRef.current = words;
    return () => {
      words.stop();
      dictationRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    dictationRef.current?.stop();
  }, []);

  // The call ended or dropped: never leave the user's words diverted.
  const { available } = input;
  useEffect(() => {
    if (!available && listeningRef.current) stop();
  }, [available, stop]);

  const start = useCallback(
    (target: TargetChoice) => {
      if (!available) return;
      targetRef.current = target;
      listeningRef.current = true;
      setListening(true);
      dictationRef.current?.start();
    },
    [available],
  );

  const setOnText = useCallback((handler: DictationHandler | null) => {
    handlerRef.current = handler;
  }, []);

  const route = useMemo<DictationRoute>(
    () => ({
      partial(text) {
        if (!listeningRef.current) return false;
        dictationRef.current?.partial(text);
        return shouldDivert(true, targetRef.current);
      },
      final(text) {
        if (!listeningRef.current) return false;
        dictationRef.current?.final(text);
        return shouldDivert(true, targetRef.current);
      },
    }),
    [],
  );

  const dictation = useMemo<CallDictation>(
    () => ({ supported: available, listening, start, stop, setOnText }),
    [available, listening, start, stop, setOnText],
  );

  return { dictation, route };
}
