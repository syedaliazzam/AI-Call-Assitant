/**
 * File: apps/web/src/features/live/useCallDictation.ts
 * Purpose: Talking to Kite during a call (item 8, ADR-0038): the microphone button in the message
 *          box, the overlay and the script bar turns the user's speech into a question. It uses the
 *          call's own microphone (no second microphone). While listening for Kite ("Auto" or "Ask Kite"),
 *          the user's words are diverted: they never become a "You" transcript line, are not saved and are
 *          not sent in later prompts. With "For the call" they stay a normal "You" line and are also used as
 *          the question. During calls nothing is read aloud.
 *          ADR-0095 (Voice mode, hands-free): the same, over and over until turned off.
 *          ADR-0101 (fast voice questions, every account):
 *          - the question's words and end-of-speech signals come from the microphone's Flux voice stream when
 *            it is open (Flux EagerEndOfTurn / EndOfTurn / TurnResumed), otherwise from the "You" channel's
 *            own engine (a Nova-3 speech_final, an on-device final line);
 *          - at the first end-of-speech signal the answer starts, held hidden (VoiceQuestionHandler.speculate),
 *            and is shown after VOICE_HOLD_MS with no new words (show), cancelled silently if the user goes on
 *            (cancel); words within VOICE_CONTINUE_MS after it was shown extend it on the same card (extend);
 *            with no signal, CALL_FALLBACK_MS of silence sends it (core/voice/dictation.ts);
 *          - the press is clean: words of a "You" line still open at the press stay in the transcript as a
 *            normal line and are not part of the question;
 *          - the press, and in Voice mode the first words of each question, warm the answer's prompt cache
 *            (prewarm);
 *          - Voice mode: a short sound from the other side does not pause it; real speech sends what the user
 *            already said, then pauses (core/voice/voiceMode.ts).
 * Used by: src/features/live/LivePage.tsx (creates it and routes the "You" channel and the voice stream
 *          through it); src/features/live/LiveAnswers.tsx (the controls, via the `dictation` prop)
 * Depends on: src/core/voice/dictation.ts, src/core/voice/voiceMode.ts, src/core/voice/voiceStream.ts,
 *             src/core/transcript/complete.ts
 *             (looksUnfinished), src/core/stt/deepgram.ts (CloudEvent), @kite/shared (TargetChoice), React
 * Architecture: docs/decisions/ADR-0038-voice-for-ask-kite.md;
 *               docs/decisions/ADR-0095-voice-mode-groq-and-move-keys.md;
 *               docs/decisions/ADR-0101-fast-voice-questions-for-everyone.md
 *
 * Dictated text is only handed to the answer path; never logged.
 */
'use client';

import type { TargetChoice } from '@kite/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CloudEvent } from '@/core/stt/deepgram';
import { looksUnfinished } from '@/core/transcript/complete';
import {
  CALL_FALLBACK_MS,
  createDictation,
  shouldDivert,
  VOICE_CONTINUE_MS,
  VOICE_HOLD_MS,
  type Dictation,
  type StartOptions,
} from '@/core/voice/dictation';
import { createVoiceMode, type VoiceMode, type VoiceModeState } from '@/core/voice/voiceMode';
import { feedVoiceEvent } from '@/core/voice/voiceStream';

/**
 * What the user sees when listening stopped because nothing was heard (v1.0.3). ADR-0082: the same words
 * after the microphone button and after the voice question's shortcut.
 */
export const IDLE_NOTICE = "Didn't catch a question. Try again and speak your question.";

/** Receives a dictated question and the chat mode it was spoken in. */
export type DictationHandler = (text: string, target: TargetChoice) => void;

/** ADR-0101: what is known about when the user stopped speaking. */
export interface VoiceTiming {
  /** When the question's last word ended (Unix ms, capture clock), or null when not known. */
  speechEnd: number | null;
}

/**
 * ADR-0101: what the answer side does with a voice question. LiveAnswers sets it (setVoiceHandler()).
 */
export interface VoiceQuestionHandler {
  /**
   * An end-of-speech signal: start answering this text now, held hidden.
   *
   * @param text   The question so far (never logged).
   * @param target The chat mode it was spoken in.
   * @param timing When the user stopped.
   */
  speculate: (text: string, target: TargetChoice, timing: VoiceTiming) => void;
  /**
   * The question is done: show the held answer (the same text), or answer now (a different text, or none
   * held).
   *
   * @param text   The question.
   * @param target The chat mode.
   * @param timing When the user stopped.
   */
  show: (text: string, target: TargetChoice, timing: VoiceTiming) => void;
  /** The user went on within the hold: cancel the held answer, silently. */
  cancel: () => void;
  /**
   * The user went on just after the answer was shown: ask again, on the same card, with the whole question.
   *
   * @param text   The whole question.
   * @param target The chat mode.
   * @param timing When the user stopped.
   */
  extend: (text: string, target: TargetChoice, timing: VoiceTiming) => void;
  /** Warm the answer's prompt cache now (a voice question is about to come). */
  prewarm: () => void;
}

/** The controls the call's UI uses. */
export interface CallDictation {
  /** True when speech-to-text dictation is available in this call (mic channel running). */
  supported: boolean;
  /** True while listening for a dictated question (until it is sent). */
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
   * receiving. Used when no VoiceQuestionHandler is set.
   */
  setOnText: (handler: DictationHandler | null) => void;
  /** ADR-0101: sets the answer side of voice questions (speculate, show, cancel, extend, prewarm). */
  setVoiceHandler: (handler: VoiceQuestionHandler | null) => void;
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
 * Where the live page sends the "You" channel's speech, the voice stream and the other side's speech while a
 * call runs. partial() and final() return true when the words were diverted (the page must then keep them
 * out of the transcript).
 */
export interface DictationRoute {
  /**
   * A partial "You" text (Nova-3 or the on-device engine).
   *
   * @param text The partial text ('' when cleared).
   * @param tEnd When its words last changed (Unix ms, capture clock), if known.
   * @returns True to keep it out of the transcript.
   */
  partial: (text: string, tEnd?: number | null) => boolean;
  /**
   * A final "You" line (Nova-3 or the on-device engine).
   *
   * @param text The final text.
   * @param tEnd When its last word ended (Unix ms, capture clock), if known.
   * @returns True to keep it out of the transcript.
   */
  final: (text: string, tEnd?: number | null) => boolean;
  /**
   * ADR-0101: an event of the microphone's Flux voice stream (turn text and turn events).
   *
   * @param event The event.
   */
  voice: (event: CloudEvent) => void;
  /**
   * The other person is making sound (a partial or final "Them" text with words). ADR-0101: Voice mode
   * pauses only for real speech.
   *
   * @param text   Their words so far in this utterance (counted, never kept).
   * @param tStart When the utterance started (Unix ms), if known.
   * @param tEnd   When its words last changed (Unix ms), if known.
   */
  them: (text: string, tStart?: number | null, tEnd?: number | null) => void;
}

/** What useCallDictation() takes. */
export interface CallDictationInput {
  /** True while the call is connected (the "You" channel is running). */
  available: boolean;
  /** Receives the dictated question; optional (setOnText() can set it later). */
  onText?: DictationHandler;
  /** ADR-0101: whether the microphone's Flux voice stream is open now. Absent: never. */
  voiceReady?: () => boolean;
  /**
   * ADR-0101: makes the "You" line still being heard (grey) a normal final line in the transcript, and says
   * how many words it had (they were spoken before the key press). Absent: 0.
   */
  keepOpenYouLine?: () => number;
}

/**
 * Words in a text (counts only).
 *
 * @param text The text.
 * @returns How many words.
 * Called from: useCallDictation()
 */
function wordsIn(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * The call's dictation.
 *
 * @param input Whether the call is connected, an optional receiver, and the voice stream and transcript hooks.
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
  const voiceHandlerRef = useRef<VoiceQuestionHandler | null>(null);
  // True while the user's words go to the question (until its time for more words ends).
  const listeningRef = useRef(false);
  const dictationRef = useRef<Dictation | null>(null);
  // ADR-0101: where this question's words come from: the voice stream (Flux) or the "You" engine.
  const sourceRef = useRef<'voice' | 'stt'>('stt');
  // ADR-0101: the voice stream's current turn text (also while not listening: words before a press).
  const voiceTurnRef = useRef('');
  // ADR-0101: when the question's newest word ended (Unix ms), for the timing trace.
  const lastWordEndRef = useRef<number | null>(null);
  // ADR-0101: the question so far was empty (Voice mode warms the cache at a question's first words).
  const emptyRef = useRef(true);
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
    if (input.onText) handlerRef.current = input.onText;
  });

  // One dictation for the call; the engine callbacks reach it through `route`.
  useEffect(() => {
    const timing = (): VoiceTiming => ({ speechEnd: lastWordEndRef.current });
    const words = createDictation({
      holdMs: VOICE_HOLD_MS,
      fallbackMs: CALL_FALLBACK_MS,
      continueMs: VOICE_CONTINUE_MS,
      unfinished: looksUnfinished,
      onChange: (text) => {
        // ADR-0101 (Voice mode): a question's first words warm the cache while the user is still speaking.
        if (emptyRef.current && text !== '' && voiceRef.current?.diverts()) {
          voiceHandlerRef.current?.prewarm();
        }
        emptyRef.current = text === '';
      },
      onSpeculate: (text) => voiceHandlerRef.current?.speculate(text, targetRef.current, timing()),
      onCancel: () => voiceHandlerRef.current?.cancel(),
      onSend: (text) => {
        // The status bar stops saying "Listening…"; words just after still extend this question.
        setListening(false);
        const handler = voiceHandlerRef.current;
        if (handler) handler.show(text, targetRef.current, timing());
        else handlerRef.current?.(text, targetRef.current);
        voiceRef.current?.afterSend();
      },
      onExtend: (text) => voiceHandlerRef.current?.extend(text, targetRef.current, timing()),
      onStop: (reason) => {
        emptyRef.current = true;
        // ADR-0095: in Voice mode a quiet stretch is normal (listen on, no notice), and its pauses stop
        // the dictation on purpose.
        if (voiceRef.current?.afterStop(reason)) return;
        // Nothing heard for a while: say so, instead of the button simply going quiet (v1.0.3).
        if (reason === 'idle') setNotice(IDLE_NOTICE);
        listeningRef.current = false;
        setListening(false);
      },
    });
    /**
     * ADR-0101: starts listening with the source in use now; a "You" line still open at the start stays in
     * the transcript and its words are not part of the question.
     *
     * @param options What the dictation is started with (continuous for Voice mode).
     */
    const begin = (options: StartOptions = {}) => {
      const fromVoice = inputRef.current.voiceReady?.() === true;
      sourceRef.current = fromVoice ? 'voice' : 'stt';
      const openWords = inputRef.current.keepOpenYouLine?.() ?? 0;
      lastWordEndRef.current = null;
      emptyRef.current = true;
      words.start({
        ...options,
        skipWords: fromVoice ? wordsIn(voiceTurnRef.current) : openWords,
      });
    };
    dictationRef.current = {
      ...words,
      start: begin,
    };
    const voiceMode = createVoiceMode({
      dictation: { start: begin, stop: () => words.stop(), sendNow: () => words.sendNow() },
      onChange: setVoiceState,
    });
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
      // ADR-0101: the answer's prompt cache starts warming at the press.
      voiceHandlerRef.current?.prewarm();
      dictationRef.current?.start();
    },
    [available],
  );

  const setOnText = useCallback((handler: DictationHandler | null) => {
    handlerRef.current = handler;
  }, []);

  const setVoiceHandler = useCallback((handler: VoiceQuestionHandler | null) => {
    voiceHandlerRef.current = handler;
  }, []);

  const route = useMemo<DictationRoute>(() => {
    /**
     * Whether the user's words are for the assistant now (a voice question or Voice mode).
     *
     * @returns True while they are.
     */
    const listeningNow = () =>
      voiceRef.current?.diverts() === true ||
      (listeningRef.current && dictationRef.current?.listening() === true);
    /**
     * Whether this question's words come from the "You" engine (not the voice stream).
     *
     * @returns True for the engine.
     */
    const fromStt = () => sourceRef.current === 'stt';
    return {
      partial(text, tEnd) {
        if (voiceRef.current?.diverts()) {
          // ADR-0095: while Voice mode is on, every word is for the assistant, never a line.
          if (fromStt()) {
            if (text.trim() && tEnd) lastWordEndRef.current = tEnd;
            dictationRef.current?.partial(text);
          }
          return true;
        }
        if (!listeningNow()) return false;
        if (fromStt()) {
          if (text.trim() && tEnd) lastWordEndRef.current = tEnd;
          dictationRef.current?.partial(text);
        }
        return shouldDivert(true, targetRef.current);
      },
      final(text, tEnd) {
        if (voiceRef.current?.diverts()) {
          if (fromStt()) {
            if (text.trim() && tEnd) lastWordEndRef.current = tEnd;
            dictationRef.current?.final(text);
          }
          return true;
        }
        if (!listeningNow()) return false;
        if (fromStt()) {
          if (text.trim() && tEnd) lastWordEndRef.current = tEnd;
          dictationRef.current?.final(text);
        }
        return shouldDivert(true, targetRef.current);
      },
      voice(event) {
        // The current turn's words, also while not listening (words before a press are skipped).
        if (event.type === 'partial') voiceTurnRef.current = event.text;
        else if (event.type === 'final') voiceTurnRef.current = '';
        if (!listeningNow() || fromStt()) return;
        const words = dictationRef.current;
        if (!words) return;
        const ended = feedVoiceEvent(words, event);
        if (ended !== null) lastWordEndRef.current = ended;
      },
      them(text, tStart, tEnd) {
        const ms = tStart && tEnd && tEnd > tStart ? tEnd - tStart : 0;
        voiceRef.current?.them({ words: wordsIn(text), ms });
      },
    };
  }, []);

  const dictation = useMemo<CallDictation>(
    () => ({
      supported: available,
      listening,
      notice,
      start,
      stop,
      setOnText,
      setVoiceHandler,
      voice,
      setVoice,
    }),
    [available, listening, notice, start, stop, setOnText, setVoiceHandler, voice, setVoice],
  );

  return { dictation, route };
}
