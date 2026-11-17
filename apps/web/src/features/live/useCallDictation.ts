/**
 * File: apps/web/src/features/live/useCallDictation.ts
 * Purpose: Talking to Kite during a call (item 8, ADR-0038): the microphone button in the message
 *          box, the overlay and the script bar turns the user's speech into a question. It uses the
 *          call's own "You" channel (no second microphone or engine). While listening for Kite
 *          ("Auto" or "Ask Kite"), the user's words are diverted: they never become a "You"
 *          transcript line, are not saved and are not sent in later prompts. With "For the call"
 *          they stay a normal "You" line and are also used as the question. The question is sent
 *          when the user pauses, and listening then stops. During calls nothing is read aloud.
 *          ADR-0095 (Voice mode, hands-free): the same, over and over until turned off. Each pause of about
 *          1 s (ADR-0099; was 1.5 s) sends what was said as a question and listening goes on; while the other person speaks, and
 *          for VOICE_RESUME_MS after, it pauses (their voice coming through the user's speakers must not
 *          become a question). While Voice is on, none of the user's words become "You" lines.
 * Used by: src/features/live/LivePage.tsx (creates it and routes the "You" channel through it);
 *          src/features/live/LiveAnswers.tsx (the controls, via the `dictation` prop)
 * Depends on: src/core/voice/dictation.ts, src/core/voice/voiceMode.ts (ADR-0095), @kite/shared
 *             (TargetChoice), React
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md;
 *               docs/decisions/ADR-0095-voice-mode-groq-and-move-keys.md
 *
 * Dictated text is only handed to the answer path; never logged.
 */
'use client';

import type { TargetChoice } from '@kite/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDictation, shouldDivert, type Dictation } from '@/core/voice/dictation';
import { createVoiceMode, type VoiceMode, type VoiceModeState } from '@/core/voice/voiceMode';

/**
 * What the user sees when listening stopped because nothing was heard (v1.0.3). ADR-0082: the same words
 * after the microphone button and after the voice question's shortcut.
 */
export const IDLE_NOTICE = "Didn't catch a question. Try again and speak your question.";

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
  /**
   * Why the last listen ended without a question, for the user (v1.0.3: "didn't catch a question"
   * after 15 s of silence), or null. Cleared when listening starts again.
   */
  notice: string | null;
  /** Stops listening without sending. */
  stop: () => void;
  /**
   * Sets who receives the dictated question (LiveAnswers sends it as a chat question); null to stop
   * receiving. Replaces the handler given to the hook, if any.
   */
  setOnText: (handler: DictationHandler | null) => void;
  /** ADR-0095: Voice mode (hands-free): off, listening, or paused while the other person speaks. */
  voice: VoiceModeState;
  /**
   * ADR-0095: turns Voice mode on or off. On, it stops any one-off listen and listens until turned off; its
   * words are never "You" lines.
   *
   * @param on     True to turn it on.
   * @param target The chat mode its questions are sent with (never "For the call": see voiceQuestionTarget()).
   */
  setVoice: (on: boolean, target: TargetChoice) => void;
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
  /**
   * ADR-0095: the other person is speaking (a partial or final "Them" text with words). Voice mode pauses
   * until VOICE_RESUME_MS after the last call.
   */
  them: () => void;
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
  const [notice, setNotice] = useState<string | null>(null);
  // ADR-0095: Voice mode's state for the UI; its rules live in core/voice/voiceMode.ts.
  const [voice, setVoiceState] = useState<VoiceModeState>('off');
  const voiceRef = useRef<VoiceMode | null>(null);
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
        // ADR-0095: Voice mode keeps listening for the next question.
        voiceRef.current?.afterSend();
      },
      onStop: (reason) => {
        // ADR-0095: in Voice mode a quiet stretch is normal (listen on, no notice), and its pauses stop
        // the dictation on purpose.
        if (voiceRef.current?.afterStop(reason)) return;
        // Nothing heard for a while: say so, instead of the button simply going quiet (v1.0.3).
        if (reason === 'idle') setNotice(IDLE_NOTICE);
        listeningRef.current = false;
        setListening(false);
      },
    });
    dictationRef.current = words;
    const voiceMode = createVoiceMode({ dictation: words, onChange: setVoiceState });
    voiceRef.current = voiceMode;
    return () => {
      // Timers never outlive the call page.
      voiceMode.dispose();
      voiceRef.current = null;
      words.stop();
      dictationRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    // ADR-0095: a one-off listen never stops Voice mode's own listening.
    if (!voiceRef.current?.diverts()) dictationRef.current?.stop();
  }, []);

  const { available } = input;
  const setVoice = useCallback(
    (on: boolean, target: TargetChoice) => {
      if (!on) {
        voiceRef.current?.off();
        return;
      }
      if (!available) return;
      // A one-off listen in progress gives way to Voice mode.
      listeningRef.current = false;
      setListening(false);
      setNotice(null);
      targetRef.current = target;
      voiceRef.current?.on();
    },
    [available],
  );

  // The call ended or dropped: never leave the user's words diverted.
  useEffect(() => {
    if (!available && listeningRef.current) stop();
    if (!available) voiceRef.current?.off();
  }, [available, stop]);

  const start = useCallback(
    (target: TargetChoice) => {
      if (!available) return;
      // ADR-0095: Voice mode is already listening for every question.
      if (voiceRef.current?.diverts()) return;
      targetRef.current = target;
      listeningRef.current = true;
      setListening(true);
      setNotice(null);
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
        // ADR-0095: while Voice mode is on, every word is for the assistant (paused: the dictation is
        // stopped, so they are dropped), never a line.
        if (voiceRef.current?.diverts()) {
          dictationRef.current?.partial(text);
          return true;
        }
        if (!listeningRef.current) return false;
        dictationRef.current?.partial(text);
        return shouldDivert(true, targetRef.current);
      },
      final(text) {
        if (voiceRef.current?.diverts()) {
          dictationRef.current?.final(text);
          return true;
        }
        if (!listeningRef.current) return false;
        dictationRef.current?.final(text);
        return shouldDivert(true, targetRef.current);
      },
      them() {
        voiceRef.current?.them();
      },
    }),
    [],
  );

  const dictation = useMemo<CallDictation>(
    () => ({ supported: available, listening, notice, start, stop, setOnText, voice, setVoice }),
    [available, listening, notice, start, stop, setOnText, voice, setVoice],
  );

  return { dictation, route };
}
