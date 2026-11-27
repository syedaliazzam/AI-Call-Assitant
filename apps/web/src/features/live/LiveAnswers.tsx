/**
 * File: apps/web/src/features/live/LiveAnswers.tsx
 * Purpose: The answers panel of the full call window (v1.0.2, reference layout; v1.0.4, ADR-0040;
 *          the same in the desktop main window and the browser split view): the top bar (TopBar.tsx,
 *          in the layout's full-width slot), the answers newest first, the message box, and the large
 *          Answer and Screenshot buttons with their keys; plus the hotkeys (through the platform
 *          adapter: in-page shortcuts, and the desktop app's global shortcuts), the link to the
 *          overlay (core/live/liveChannel.ts: state out, commands in, including the script bar and
 *          dictation), going between the overlay and this window (⋮, Back to compact, Esc), and the
 *          duplicate-safe "Answer this" for transcript bubbles (registered with the live page). v1.1.0
 *          (ADR-0041): also what the stacked overlay's panels and menu need. Desktop 1.5.0 (ADR-0068): the
 *          meeting recording's state, its commands and Ctrl+Alt+R. ADR-0122: Ctrl+Alt+K during an overlay call
 *          opens the overlay's chat bar. ADR-0123: Ctrl+Enter answers the other person on a call and the user's
 *          own newest spoken question on their own; Ctrl+Shift+Space always the user's own; no Voice mode.
 *          ADR-0055 (amended 26 Nov 2026): while Click-through is on (the whole overlay passes clicks) this
 *          window shows "Turn click-through off"; the mode ends with the call, and the tray's item turns it off.
 * Used by: src/features/live/LivePage.tsx (live view);
 *          tests/integration/harness/answers.tsx (the answer harness test)
 * Depends on: src/features/live (useLiveAnswers, TopBar, ChatBox, AnswerPanel, useCallDictation),
 *             src/features/session-setup/AnswerPreferencesDialog.tsx, src/platform
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session), §7.3 (hotkeys);
 *               day-04-answers.md Stage 6
 */
'use client';

import { type OverlayPreset, type TargetChoice } from '@kite/shared';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { splitAnswer } from '@/core/answer/format';
import { answeredGroupIds, type SpeechSpan } from '@/core/answer/repeatGuard';
import { getChatTarget, setChatTarget } from '@/core/storage/answerPrefs';
import { getAutoAnswer } from '@/core/storage/autoAnswer';
import { hintSeen, markHintSeen } from '@/core/storage/hintPrefs';
import { groupLines, groupWords } from '@/core/transcript/group';
import { speakerNames } from '@/core/transcript/turns';
import { looksGarbled } from '@/core/transcript/questionKind';
import { isUnclearGroup } from '@/core/transcript/unclear';
import { AnswerPreferencesDialog } from '@/features/session-setup/AnswerPreferencesDialog';
import type { MenuItem } from '@/ui/Menu';
import { updateSessionPreferences } from '@/core/storage/sessions';
import {
  answerModelAccess,
  DEFAULT_MODEL_ACCESS,
  type AnswerModelAccess,
} from '@/core/session/modelAccess';
import { modelOff } from '@/core/session/modelChoices';
import { mustMoveToHaiku, offeredModel } from '@/core/session/retireModels';
import { callTimings } from '@/core/live/callTimings';
import {
  clampStep,
  FONT_SCALE_RANGE,
  setFontScale,
  setTheme,
  stepZoom,
  type ThemeChoice,
} from '@/core/storage/appearancePrefs';
import { isVoiceCancelKey } from '@/platform/keymap';
import { voiceQuestionTarget } from '@/core/voice/dictation';
import { useAppearance } from '@/features/appearance/useAppearance';
import { displayTerms, sentenceCase, transcriptChips } from '@/core/transcript/display';
import { liveQuestion } from '@/core/transcript/liveQuestion';
import {
  openLiveChannel,
  type CompactAudio,
  type CompactCommand,
  type CompactLevels,
  type CompactState,
  type LiveChannel,
} from '@/core/live/liveChannel';
import { beforeVoiceQuestion, type HygieneState } from '@/core/live/hygiene';
import type { AnswerModel, Session, StoredDocument } from '@/core/storage/types';
import type { Transcript } from '@/core/transcript/transcript';
import { getPlatform } from '@/platform';
import { AnswerPanel } from './AnswerPanel';
import { openOverlay, startsCallsInOverlay, type OverlayAtStart } from './openOverlay';
import { ChatBox, type ChatBoxHandle } from './ChatBox';
import { KeyChip } from './overlay/parts';
import { clickThroughKeyLabel } from './overlay/clickThroughHint';
import { Button } from '@/ui/Button';
import { TopBar } from './TopBar';
import { isOnline, subscribeOnline } from '@/core/net/online';
import { SignInAgainDialog } from './SignInAgainDialog';
import { useAutoAnswer } from './useAutoAnswer';
import type { CallDictation } from './useCallDictation';
import { openDashboard } from '@/features/sync/dashboardLink';
import { useLiveAnswers, type AnswerStore } from './useLiveAnswers';
import { usePressTarget } from './usePressTarget';
import type { CallRecording } from './useCallRecording';
import type { CallNotice } from '@/core/live/callNotice';

/** Props for LiveAnswers. */
export interface LiveAnswersProps {
  /** The session. */
  session: Session;
  /** Its documents. */
  documents: readonly StoredDocument[];
  /** The approved lessons for this session type (Day 5 Stage 7); none when omitted. */
  lessons?: readonly string[];
  /** The live transcript. */
  transcript: Transcript;
  /** Whether each side of the call is coming through (shown in the overlay). */
  audio?: CompactAudio;
  /** Opens the overlay when the call starts, overriding the saved setting (the harness). */
  startInOverlay?: boolean;
  /**
   * What Connect did with the overlay (ADR-0053): 'opened' (it is open; this window steps aside),
   * 'failed' (it could not open; say how to open it), 'off' (calls do not start in it). Absent when
   * this panel is mounted without LivePage (harnesses): it then opens the overlay itself, as before.
   */
  overlayAtStart?: OverlayAtStart;
  /** Turns auto-answer on or off for this call, overriding the saved setting (the harness). */
  autoAnswer?: boolean;
  /** When this call connected (Unix ms). */
  callStartedAt: number;
  /** ADR-0077: the call's record id, saved with each answer. */
  callId?: string;
  /** True while End waits for the last line. */
  ending: boolean;
  /** Ends the call. */
  onEnd: () => void;
  /** Where answers, ratings and notes are saved (default: this device; tests may replace it). */
  store?: AnswerStore;
  /** Puts text on the clipboard (tests replace it). */
  copy?: (text: string) => Promise<void>;
  /**
   * Talking to Kite during the call (item 8, ADR-0038): the microphone controls, from the live
   * page's useCallDictation(). Absent in tests and harnesses that do not dictate.
   */
  dictation?: CallDictation;
  /**
   * Receives the duplicate-safe "Answer this" for the transcript's bubbles, and the speech already
   * answered (v1.0.2), whenever they change: the transcript is drawn by the live page, outside
   * this panel.
   */
  onAnswerThis?: (bridge: AnswerThisBridge) => void;
  /**
   * Where the top bar goes: the layout's full-width band (v1.0.4). Without one (harnesses) it stays
   * at the top of this panel.
   */
  topBarSlot?: HTMLElement | null;
  /** True for the browser call view: the top bar shows only the timer, ⋮ and End (TopBar `slim`). */
  slimTopBar?: boolean;
  /** v1.1.0: the audio levels, for the overlay's level bars. */
  levels?: CompactLevels;
  /** v1.1.0: lines that started before this time are off the overlay too (Unix ms; 0: none). */
  transcriptClearedAt?: number;
  /** v1.1.0: clears the words on screen (the overlay's Clear). */
  onClearTranscript?: () => void;
  /** v1.1.0: changes the answer language (the overlay's Language). */
  onLanguage?: (code: string) => void;
  /** v1.1.0: switches the microphone (the overlay's device list). */
  onMic?: (deviceId: string) => void;
  /** v1.1.0: the microphone in use ('' for the system's default). */
  micDeviceId?: string;
  /** 1.5.1 (ADR-0069): the call's notice about what it hears (LivePage.tsx), shown in the overlay. */
  callNotice?: CallNotice | null;
  /** v1.1.0: where "Them" comes from, in words. */
  themSourceLabel?: string | null;
  /** v1.1.0: "Still in a call?" or paused (ADR-0044). */
  hygiene?: HygieneState;
  /** v1.1.0: yes, still in a call. */
  onStillHere?: () => void;
  /** v1.1.0: listen again after a pause. */
  onResume?: () => void;
  /** v1.1.0: an answer was asked for (it counts as activity for the hygiene prompts). */
  onActivity?: () => void;
  /** v1.1.0: how many echo lines were hidden in this call (the one-time headphones hint). */
  echoCount?: number;
  /**
   * ADR-0093: a name the other person gave when introducing themselves, offered on the overlay as
   * "Rename Them to Sarah?". Absent when there is nothing to offer.
   */
  nameOffer?: string | null;
  /** ADR-0093: the overlay's Rename on the offer (the live page renames the other person for this call). */
  onRenameThem?: (name: string) => void;
  /** ADR-0093: the overlay's Not now on the offer. */
  onDismissName?: () => void;
  /**
   * Desktop 1.5.0 (ADR-0068): the call's meeting recording (the Rec pill on both bars, Ctrl+Alt+R and
   * the ⋮ menu's type). Absent where the app cannot record, and in harnesses.
   */
  recording?: CallRecording;
  /**
   * ADR-0076: the question rules ('newest' in calls with cloud transcription; default 'legacy'), for
   * presses and auto-answer.
   */
  rules?: 'newest' | 'legacy';
  /** ADR-0076 (E3 rule 2): waits until the other side is transcribed up to a press (capped). */
  catchUp?: (atUnix: number) => Promise<{ waitedMs: number; timedOut: boolean }>;
  /** Batch C (P1-1): the other side's turn events (Flux), for the speculative answer's hold. */
  themTurns?: (listener: (event: 'start' | 'eager' | 'end' | 'resumed') => void) => () => void;
}

/** How many of the latest bubbles the overlay gets: the call window and Review have them all. */
const OVERLAY_GROUPS = 150;

/**
 * ADR-0118: how many phrase chips the overlay's transcript bar gets (three words each): enough to fill a wide
 * bar; a narrow one shows the newest that fit and scrolls the rest out (it had 6, of which it showed 4).
 */
const OVERLAY_CHIPS = 10;

/** How many hidden echo lines in a call before the one-time "Use headphones" hint shows. */
const HEADPHONES_HINT_AFTER = 3;

/**
 * How often the overlay's level bars get new levels, in ms: they change every 50 ms. 1.5.1 (ADR-0069):
 * 250 (was 120): each message re-renders the overlay, which competed with the live speech engine.
 */
const LEVELS_EVERY_MS = 250;

/** What the transcript's "Answer this" buttons need from the answers (v1.0.2). */
export interface AnswerThisBridge {
  /**
   * Answers a bubble's question (guarded like Answer: answered speech shows its answer).
   *
   * @param question The bubble's words.
   * @param span     The bubble's speech.
   */
  answerThis: (question: string, span: SpeechSpan) => void;
  /** The speech already answered in this call. */
  answeredSpans: readonly SpeechSpan[];
}

/** The theme's name in the ⋮ menu. */
const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/**
 * The theme ⋮ moves to next.
 *
 * @param theme The theme now.
 * @returns The next one.
 * Called from: LiveAnswers
 */
function nextTheme(theme: ThemeChoice): ThemeChoice {
  if (theme === 'system') return 'light';
  return theme === 'light' ? 'dark' : 'system';
}

/** The large buttons under the message box (reference layout): text with the key on the right. */
const BIG_BUTTON =
  'inline-flex h-12 items-center justify-center gap-2 rounded-card px-4 text-[16px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/**
 * No-op subscription: the OS never changes while the page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Whether the shortcuts use ⌘ (macOS), for the labels. Server render: not a Mac.
 *
 * @returns True on macOS.
 */
const isMac = () => getPlatform().hotkeyModifier() === '⌘';

/**
 * The answer part of the live view.
 *
 * @param props See LiveAnswersProps.
 * @returns The top bar, chat box and answer panel.
 * Rendered by: LivePage.tsx; the answer harness page
 */
export function LiveAnswers(props: LiveAnswersProps) {
  // Read only: the layout around this panel paints the theme (v1.1.0).
  const appearance = useAppearance('call', false);
  // The overlay's menu can change how answers are written during a call (ADR-0029).
  const [style, setStyle] = useState(props.session.preferences.style);
  // ADR-0094: the overlay's model chip and ⋮ Model row can switch the model during a call. It follows the
  // session too when that changes (Edit session in another window), while rendering as React advises.
  // ADR-0121: a session still set to a hidden model (Groq) is asked as Claude Haiku from the first answer,
  // before its stored choice has moved (below), so no request names a model no list offers.
  const [model, setModel] = useState<AnswerModel>(() =>
    offeredModel(props.session.preferences.model),
  );
  const [seenSessionModel, setSeenSessionModel] = useState(props.session.preferences.model);
  if (props.session.preferences.model !== seenSessionModel) {
    setSeenSessionModel(props.session.preferences.model);
    setModel(offeredModel(props.session.preferences.model));
  }
  // ADR-0094: Smart is off once the server says an admin has turned the deeper model off (it then shows
  // disabled in the overlay). ADR-0095: Groq, and ADR-0099: the Gemini and GPT models, are off until the server
  // says they may be used. The server enforces all of them on every answer whatever this says.
  const [access, setAccess] = useState<AnswerModelAccess>(DEFAULT_MODEL_ACCESS);
  // ADR-0095: whether the server has answered yet (a Groq, Gemini or GPT session shows its model until the
  // server says it is off).
  const [accessKnown, setAccessKnown] = useState(false);
  useEffect(() => {
    let active = true;
    void answerModelAccess().then((next) => {
      if (!active) return;
      setAccess(next);
      setAccessKnown(true);
    });
    return () => {
      active = false;
    };
  }, []);
  // ADR-0101: a session still set to Groq while Groq is off moves to Claude Haiku in its stored preferences
  // (the overlay already shows Claude Haiku, and the server answers it with Claude Haiku, never asking Groq).
  // ADR-0104: the same for a retired model (Gemini 3.6 Flash).
  // ADR-0121: the same for a hidden model (Groq); `model` already says 'fast' for it, so the stored choice is
  // checked as well.
  const sessionIdForModel = props.session.id;
  const storedModel = props.session.preferences.model;
  useEffect(() => {
    if (!accessKnown) return;
    if (!mustMoveToHaiku(model, access) && !mustMoveToHaiku(storedModel, access)) return;
    updateSessionPreferences(sessionIdForModel, { model: 'fast' }).catch(() => undefined);
  }, [accessKnown, access, model, storedModel, sessionIdForModel]);
  // The answers use the new style and model from the next answer: one already streaming keeps its request.
  const session = useMemo(
    () => ({ ...props.session, preferences: { ...props.session.preferences, style, model } }),
    [props.session, style, model],
  );
  // ADR-0094: what the overlay shows: Fast when Smart is asked for but turned off (the server answers with
  // the fast model then). ADR-0095: the same for Groq once the server has said it is off; ADR-0099: and for the
  // Gemini and GPT models.
  const shownModel: AnswerModel =
    (model === 'smart' && !access.smart) || (accessKnown && modelOff(model, access))
      ? 'fast'
      : model;
  // The chat box's switch, remembered per session (ADR-0030).
  const [chatTarget, setTarget] = useState<TargetChoice>(() => getChatTarget(props.session.id));
  // Grows with each press of the Ask Kite shortcut, so the overlay opens its chat box too.
  const [askKiteCount, setAskKiteCount] = useState(0);
  const chatBox = useRef<ChatBoxHandle>(null);
  // v1.1.0: the overlay's ⋮ can turn auto-answer on or off for this call.
  const [autoChoice, setAutoChoice] = useState<boolean | null>(null);
  const [headphonesClosed, setHeadphonesClosed] = useState(false);
  // ADR-0123: no Voice mode any more (its button, menu switch and tip are gone): the user's own spoken questions
  // are answered on a key press instead (Ctrl+Enter on your own, Ctrl+Shift+Space always).
  const answers = useLiveAnswers({
    // ADR-0123: with no other-side source, Ctrl+Enter answers the user's own questions.
    themConnected: props.audio?.them ?? true,
    chatTarget,
    session,
    documents: props.documents,
    ...(props.lessons ? { lessons: props.lessons } : {}),
    transcript: props.transcript,
    callStartedAt: props.callStartedAt,
    ...(props.callId ? { callId: props.callId } : {}),
    store: props.store,
    paused: props.hygiene === 'paused',
    ...(props.rules ? { rules: props.rules } : {}),
    ...(props.catchUp ? { catchUp: props.catchUp } : {}),
    ...(props.themTurns ? { themTurns: props.themTurns } : {}),
  });
  // Grows with each Chat or Ask Kite shortcut: the message box (always shown) takes the typing.
  const [focusSignal, setFocusSignal] = useState(0);
  // Clear also takes the live question off the overlay until a new one is asked (Unix ms).
  const [questionClearedAt, setQuestionClearedAt] = useState(0);
  // The overlay as the slim script bar (v1.0.2; Ctrl+Alt+S or a ⋮ menu).
  const [scriptBar, setScriptBar] = useState(false);
  // v1.3.2: Click-through (W, the ⋮ menu or Ctrl+Alt+X). ADR-0055 (amended 26 Nov 2026): the whole overlay
  // passes every click and key to the app behind it.
  const [clickThrough, setClickThrough] = useState(false);
  // ADR-0055 (amended 26 Nov 2026): it is off as soon as the call is ending (safety net (c)), so a closing
  // overlay never leaves clicks passing; the page unmounts with the call, so a new call starts with it off.
  // Reset while rendering (React's pattern for state that follows a prop), so it stays off even if the
  // ending were called off; and it cannot come on again while the call ends.
  if (props.ending && clickThrough) setClickThrough(false);
  const clickThroughOn = clickThrough && !props.ending;
  // ADR-0055 (amended 26 Nov 2026): another app holds the Click-through shortcut this call, so it cannot
  // turn the mode off: the overlay then keeps its bars clickable in the mode.
  const [clickThroughKeyTaken, setClickThroughKeyTaken] = useState(false);
  // The Answer preferences dialog (⋮ menu).
  const [prefsOpen, setPrefsOpen] = useState(false);
  // The desktop shell can place the overlay (Reset size and position, presets; ADR-0035).
  const placement = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().overlayPlacement(),
    () => false,
  );
  // Desktop app: global shortcuts another app already uses (they work only while Kite has focus).
  const [taken, setTaken] = useState<string[]>([]);
  // ADR-0110 (amended 25 Nov 2026): taken ones the page does not handle (show or hide, moves, Click-through,
  // Rec): they do not work at all during this call.
  const [takenUnavailable, setTakenUnavailable] = useState<string[]>([]);
  // ADR-0076 (G4): the Answer shortcut's label when another app holds it (a lasting overlay warning).
  const [answerTaken, setAnswerTaken] = useState<string | null>(null);
  const mac = useSyncExternalStore(subscribeNever, isMac, () => false);
  const entry = answers.index >= 0 ? (answers.entries[answers.index] ?? null) : null;
  // ADR-0112: a silent retry's card is hidden, but an answer is still on its way.
  const answering =
    answers.retrying || answers.entries.some((candidate) => candidate.status === 'streaming');
  // Auto-answer (beta, off by default): answers a finished question from Them by itself.
  // The choice made in this call first; then this session's own switch; then the device's setting.
  const autoOn = autoChoice ?? props.autoAnswer ?? (props.session.autoAnswer || getAutoAnswer());
  useAutoAnswer({
    transcript: props.transcript,
    streaming: answering,
    autoAnswer: answers.autoAnswer,
    answeredState: answers.answeredState,
    enabled: autoOn,
    ...(props.rules ? { rules: props.rules } : {}),
    autoNewest: answers.autoNewest,
  });
  const [compactNotice, setCompactNotice] = useState<string | null>(null);
  // Day 6 Stage 4e: no connection pauses answers (banner); a signed-out answer offers to sign
  // in again in a dialog, so the call is never left.
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);
  const [signInOpen, setSignInOpen] = useState(false);
  const lines = useSyncExternalStore(
    props.transcript.subscribe,
    props.transcript.lines,
    props.transcript.lines,
  );

  // What the overlay shows (Day 5, ADR-0029): audio, the latest words and lines, and the answer
  // shown here with its place in the history.
  const terms = useMemo(() => displayTerms(props.session), [props.session]);
  const audioYou = props.audio?.you ?? true;
  const audioThem = props.audio?.them ?? true;
  const clearedAt = props.transcriptClearedAt ?? 0;
  const visibleLines = useMemo(
    () => (clearedAt > 0 ? lines.filter((line) => line.tStart >= clearedAt) : lines),
    [lines, clearedAt],
  );
  const groups = useMemo(() => groupLines(visibleLines, { terms }), [visibleLines, terms]);
  const groupsRef = useRef(groups);
  const answeredSpanList = answers.answeredSpans;
  const language = props.session.preferences.language;
  const echoCount = props.echoCount ?? 0;
  // v1.4 (ADR-0062): the same one-time hint also shows at once when the sound plays through speakers
  // (from the output's name), before any echo has had to be hidden. Headphones are recommended, never
  // required.
  const [onSpeakers, setOnSpeakers] = useState(false);
  useEffect(() => {
    let active = true;
    void getPlatform()
      .outputKind?.()
      .then((kind) => {
        if (active) setOnSpeakers(kind === 'speakers');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const headphonesHint =
    !headphonesClosed &&
    (onSpeakers || echoCount >= HEADPHONES_HINT_AFTER) &&
    !hintSeen('headphones');
  // Desktop 1.5.0 (ADR-0068): the recording's state for the bars (a plain value, for the memo below).
  const recordingCompact = props.recording?.compact;
  // ADR-0101: where the voice shortcut works (browser only; the platform says).
  const [voiceHint] = useState(() => getPlatform().voiceShortcutHint());
  // ADR-0123: who Ctrl+Enter answers right now, for the hint on bar 2 (the press reads the same rule).
  const target = usePressTarget(lines, audioThem);
  const compactState = useMemo<CompactState>(() => {
    const parts = entry ? splitAnswer(entry.text) : null;
    const answeredIds = answeredGroupIds(
      groups,
      answeredSpanList.map((item) => item.span),
    );
    return {
      audio: { you: audioYou, them: audioThem },
      // Noise stays out of the chips, as it collapses in the transcript (ADR-0044).
      chips: transcriptChips(
        visibleLines.filter((line) => !line.final || !looksGarbled(line.text)),
        terms,
        OVERLAY_CHIPS,
      ),
      liveQuestion: liveQuestion(
        visibleLines.filter((line) => !line.final || !looksGarbled(line.text)),
        terms,
        questionClearedAt,
      ),
      groups: groups.slice(-OVERLAY_GROUPS).map((group) => ({
        id: group.id,
        speaker: group.speaker,
        finalText: group.finalText,
        provisionalText: group.provisionalText,
        tStart: group.tStart,
        tEnd: group.tEnd,
        question: group.question,
        answered: answeredIds.has(group.id),
        unclear: isUnclearGroup(group),
      })),
      // ADR-0093: the call's name for the other person, else "Interviewer" or "Them" by session type.
      themName: speakerNames({ contactName: props.session.contactName, type: props.session.type })
        .them,
      ...(props.nameOffer ? { nameOffer: props.nameOffer } : {}),
      language,
      autoAnswer: autoOn,
      hygiene: props.hygiene ?? 'ok',
      headphonesHint,
      ...(props.callNotice ? { callNotice: props.callNotice } : {}),
      ...(answerTaken ? { answerKeyTaken: answerTaken } : {}),
      sessionId: props.session.id,
      micDeviceId: props.micDeviceId ?? '',
      ...(props.themSourceLabel ? { themSourceLabel: props.themSourceLabel } : {}),
      answer:
        entry && parts
          ? {
              id: entry.id,
              question: sentenceCase(entry.question, terms),
              ...(entry.cleanQuestion ? { cleanQuestion: entry.cleanQuestion } : {}),
              text: entry.text,
              headline: parts.headline,
              ...(entry.meta ? { meta: entry.meta } : {}),
              claims: entry.claims ?? [],
              // ADR-0121: the reply reached its output limit (the overlay card says so).
              ...(entry.cutOff ? { cutOff: true } : {}),
              askedAt: entry.askedAt,
              rating: entry.rating,
              reported: entry.reported ?? false,
              auto: entry.auto ?? false,
              // ADR-0123: the user's own words ("Your question:" on the card).
              ...(entry.yours ? { yours: true } : {}),
              status: entry.status,
              mode: entry.mode,
              error: entry.status === 'error' ? (entry.error ?? null) : null,
              unavailable: entry.unavailable ?? false,
              // Batch C (P1-4): the press gave up waiting for their last words.
              ...(entry.incomplete ? { incomplete: true } : {}),
              // Batch D (P1-G): their audio was lost around the question.
              ...(entry.audioLost ? { audioLost: true } : {}),
              // Mac 1.8.1 / Windows 1.7.5: the screenshot's small preview and its screen (memory only).
              ...(entry.preview ? { preview: entry.preview } : {}),
              ...(entry.screen
                ? { screen: { number: entry.screen.number, count: entry.screen.count } }
                : {}),
            }
          : null,
      chatTarget,
      askKiteCount,
      sessionType: props.session.type,
      index: answers.index,
      total: answers.entries.length,
      answering,
      capturing: answers.capturing,
      notice: answers.notice,
      ended: false,
      style,
      model: shownModel,
      smartAllowed: access.smart,
      groqAllowed: access.groq,
      // ADR-0102: the GPT models' switch for every account; the Gemini rows and switch only for an account in
      // the Gemini rollout (ADR-0099).
      openaiAllowed: access.openai,
      ...(access.moreModels ? { moreModels: true, geminiAllowed: access.gemini } : {}),
      scriptBar,
      clickThrough: clickThroughOn,
      ...(clickThroughKeyTaken ? { clickThroughKeyTaken: true } : {}),
      dictationSupported: props.dictation?.supported ?? false,
      dictating: props.dictation?.listening ?? false,
      // ADR-0101: in a browser, where the voice shortcut works (shown while a voice question listens).
      ...(voiceHint ? { voiceShortcutHint: voiceHint } : {}),
      dictationNotice: props.dictation?.notice ?? null,
      // ADR-0123: no voiceMode or voiceTip any more (Voice mode has no control), so the overlay shows neither.
      pressTarget: target,
      startedAt: props.callStartedAt,
      ...(recordingCompact ? { recording: recordingCompact } : {}),
    };
  }, [
    voiceHint,
    recordingCompact,
    groups,
    visibleLines,
    answeredSpanList,
    language,
    autoOn,
    props.hygiene,
    headphonesHint,
    props.callNotice,
    answerTaken,
    props.session.id,
    props.session.contactName,
    props.nameOffer,
    props.micDeviceId,
    props.themSourceLabel,
    scriptBar,
    clickThroughOn,
    clickThroughKeyTaken,
    props.callStartedAt,
    props.dictation?.supported,
    props.dictation?.listening,
    props.dictation?.notice,
    target,
    questionClearedAt,
    terms,
    entry,
    answers.index,
    answers.entries,
    chatTarget,
    askKiteCount,
    props.session.type,
    audioYou,
    audioThem,
    answering,
    answers.capturing,
    answers.notice,
    style,
    shownModel,
    access,
  ]);
  const compactStateRef = useRef(compactState);
  const channel = useRef<LiveChannel | null>(null);

  // The hotkeys call the latest actions (a ref, so the listener is added only once).
  const actions = useRef(answers);
  const onEnd = useRef(props.onEnd);
  const sessionIdRef = useRef(props.session.id);
  const dictationRef = useRef(props.dictation);
  const chatTargetRef = useRef(chatTarget);
  /**
   * ADR-0094: switches this session's answer model, from the overlay's chip or ⋮ Model row. It applies from
   * the next answer (one already streaming finishes on the model it was sent with), is saved as the
   * session's model (so AI preferences show it afterwards; this device's session only, never another
   * user's or the global settings), and the new model's prompt cache is warmed in the background
   * (useLiveAnswers). Smart and Groq (ADR-0095), and the Gemini and GPT models (ADR-0099), are asked of the
   * server first: when one is off, nothing changes and the overlay shows it disabled.
   *
   * @param next The model picked.
   */
  const switchModel = useRef((next: AnswerModel) => {
    const apply = () => {
      setModel(next);
      // The tier only (never text), so the call's trace shows when the model changed.
      callTimings.noteTrace('model', { model: next });
      updateSessionPreferences(sessionIdRef.current, { model: next }).catch(() => undefined);
    };
    if (next === 'fast') {
      apply();
      return;
    }
    void answerModelAccess().then((now) => {
      setAccess(now);
      setAccessKnown(true);
      if (!modelOff(next, now)) apply();
    });
  });
  /**
   * ADR-0082: Clear answers (Ctrl+Backspace, the overlay answer panel's Clear, ⋮ Clear answers): every answer
   * asked until now leaves the screen, here and in the overlay; they stay saved for the review.
   */
  const clearAnswers = useRef(() => {
    actions.current.clearAnswers();
  });
  // ADR-0082 (Ctrl+Alt+Enter): the screenshot taken before the spoken question, sent with it.
  const voiceShot = useRef<string | null>(null);
  // ADR-0107: the card that used voiceShot (Voice mode); a new question after it no longer carries the shot.
  const voiceShotCard = useRef<string | null>(null);
  /**
   * ADR-0082: the voice question (Ctrl+Shift+Space) and the screenshot and voice question (Ctrl+Alt+Enter).
   * Listens to the microphone ("Listening…" on the overlay's status bar) and sends the question after a
   * pause. Its words never become a "You" line and never count as a reply: dictation keeps them out of the
   * transcript for every target but "For the call", so that one is never used here. Pressed again while
   * listening, it cancels (as Escape does).
   *
   * @param withScreenshot True to take the screenshot first and send it with the question.
   */
  const voiceQuestion = useRef(async (withScreenshot: boolean) => {
    const dictation = dictationRef.current;
    if (!dictation?.supported) return;
    // ADR-0101: listening paused ("Still in a call?" went unanswered) is resumed for the question, and the
    // question itself counts as being in the call.
    resumeForVoice.current();
    // ADR-0095: Voice mode already listens for every question. Ctrl+Alt+Enter then takes the screenshot, and
    // the next question spoken goes with it; Ctrl+Shift+Space has nothing to start.
    if (dictation.voice !== 'off') {
      if (!withScreenshot) return;
      const image = await actions.current.captureScreen();
      if (image) {
        voiceShot.current = image;
        voiceShotCard.current = null;
      }
      return;
    }
    if (dictation.listening) {
      voiceShot.current = null;
      dictation.stop();
      return;
    }
    voiceShot.current = null;
    if (withScreenshot) {
      // The screen as it is now, before the user speaks (the notice says why when it fails).
      const image = await actions.current.captureScreen();
      if (!image) return;
      voiceShot.current = image;
      voiceShotCard.current = null;
    }
    dictationRef.current?.start(voiceQuestionTarget(chatTargetRef.current));
  });
  /**
   * ADR-0101: before a voice question (or Voice mode) listens: a paused listen ("Still in a call?" went
   * unanswered) is resumed, and the prompt counts as answered ("yes, still in a call").
   */
  const hygieneRef = useRef({
    hygiene: props.hygiene,
    onResume: props.onResume,
    onStillHere: props.onStillHere,
  });
  useEffect(() => {
    hygieneRef.current = {
      hygiene: props.hygiene,
      onResume: props.onResume,
      onStillHere: props.onStillHere,
    };
  });
  const resumeForVoice = useRef(() => {
    const { hygiene, onResume, onStillHere } = hygieneRef.current;
    const first = beforeVoiceQuestion(hygiene);
    if (first === 'resume') onResume?.();
    else if (first === 'still-here') onStillHere?.();
  });
  /** ADR-0082: Escape (or the shell's held Escape) while a voice question listens: stop, send nothing. */
  const cancelVoice = useRef(() => {
    voiceShot.current = null;
    dictationRef.current?.stop();
  });
  // v1.1.0: the words on screen and the live question; the answer stays.
  const onClearTranscript = useRef(props.onClearTranscript);
  // ADR-0093: the rename offer's buttons on the overlay (the handler is added once).
  const renameThem = useRef(props.onRenameThem);
  const dismissName = useRef(props.onDismissName);
  const clearTranscript = useRef(() => {
    setQuestionClearedAt(Date.now());
    onClearTranscript.current?.();
  });
  const overlayProps = useRef(props);
  /**
   * Desktop 1.5.0 (ADR-0068): a recording command, from either bar's Rec pill or the ⋮ menu. Consent was
   * given in the question that sent 'record-start'.
   * @param command The command.
   */
  const recordCommand = useCallback((command: CompactCommand) => {
    const recording = overlayProps.current.recording;
    if (!recording) return;
    if (command.type === 'record-start') void recording.start({ displayId: command.displayId });
    else if (command.type === 'record-stop') void recording.stop();
    else if (command.type === 'record-kind') recording.setKind(command.kind);
    else if (command.type === 'record-notice-seen') recording.clearNotice();
    else if (command.type === 'record-prompt') recording.prompt();
  }, []);
  // Whether the overlay has been open in this call: only then does Escape go back to it.
  const overlayOpened = useRef(false);
  useEffect(() => {
    sessionIdRef.current = props.session.id;
    dictationRef.current = props.dictation;
    chatTargetRef.current = chatTarget;
    actions.current = answers;
    onEnd.current = props.onEnd;
    onClearTranscript.current = props.onClearTranscript;
    renameThem.current = props.onRenameThem;
    dismissName.current = props.onDismissName;
    overlayProps.current = props;
    groupsRef.current = groups;
  });
  // A request for an answer counts as someone being on the call (ADR-0044).
  const entryCount = answers.entries.length;
  const onActivity = props.onActivity;
  useEffect(() => {
    if (entryCount > 0) onActivity?.();
  }, [entryCount, onActivity]);
  // The link to the compact view (Day 5): it sends commands; End (unmount) tells it the call
  // ended and asks the platform to close it.
  useEffect(() => {
    const link = openLiveChannel(props.session.id);
    channel.current = link;
    link.onCommand((command) => {
      if (command.type === 'hello') link.publish(compactStateRef.current);
      // 1.5.1: the overlay's buttons (the call timing log records what asked).
      else if (command.type === 'answer') actions.current.answer('button');
      else if (command.type === 'screenshot')
        actions.current.screenshot(undefined, 'screenshot-button');
      // ADR-0082: the answer panel's Clear and Ctrl+Backspace clear the answers.
      else if (command.type === 'clear') clearAnswers.current();
      else if (command.type === 'stop') actions.current.stop();
      else if (command.type === 'clear-transcript') clearTranscript.current();
      else if (command.type === 'answer-this') {
        const group = groupsRef.current.find((candidate) => candidate.id === command.groupId);
        if (group) {
          actions.current.answerThis(groupWords(group), { start: group.tStart, end: group.tEnd });
        }
      } else if (command.type === 'language') overlayProps.current.onLanguage?.(command.code);
      else if (command.type === 'auto-answer') setAutoChoice(command.on);
      else if (command.type === 'mic') overlayProps.current.onMic?.(command.deviceId);
      else if (command.type === 'still-here') overlayProps.current.onStillHere?.();
      // ADR-0076 (G4): Settings at Hotkeys, in the pages window (never this window: the call stays).
      else if (command.type === 'hotkey-settings')
        getPlatform().openPagesWindow('/settings#hotkeys');
      else if (command.type === 'resume') overlayProps.current.onResume?.();
      else if (command.type === 'headphones-seen') {
        markHintSeen('headphones');
        setHeadphonesClosed(true);
      } else if (command.type === 'call-window') {
        // ⋮ (v1.0.4): the full call window, at the newest answer. The shell hides the overlay.
        actions.current.showLatest();
        void getPlatform()
          .showCallWindow()
          .catch(() => undefined);
      } else if (command.type === 'rename-them') renameThem.current?.(command.name);
      else if (command.type === 'dismiss-name') dismissName.current?.();
      else if (command.type === 'script-bar') setScriptBar(command.on);
      else if (command.type === 'click-through') setClickThrough(command.on);
      else if (command.type === 'dictate') {
        if (command.on) dictationRef.current?.start(chatTargetRef.current);
        else dictationRef.current?.stop();
      } else if (command.type === 'voice') {
        // ADR-0123: Ctrl+Alt+Enter (screenshot: true) is still the screenshot and voice question; without a
        // screenshot (an overlay from before ADR-0123) it is Ctrl+Shift+Space: the user's own last question.
        if (command.screenshot) void voiceQuestion.current(true);
        else actions.current.ownQuestion('own-question-key');
      }
      // ADR-0123: Ctrl+Shift+Space with the overlay focused: the user's own last spoken question.
      else if (command.type === 'own-question') actions.current.ownQuestion('own-question-key');
      // ADR-0123: Voice mode has no control any more; 'voice-mode' and 'voice-tip-seen' are ignored.
      // ADR-0122: Ctrl+Alt+K with the overlay focused opens its chat bar, as the global key does.
      else if (command.type === 'open-chat') setAskKiteCount((count) => count + 1);
      else if (command.type === 'voice-cancel') cancelVoice.current();
      else if (command.type === 'prev') actions.current.prev();
      else if (command.type === 'next') actions.current.next();
      else if (command.type === 'rate') actions.current.rate(command.id, command.rating);
      else if (command.type === 'report') actions.current.report(command.id, command.note);
      else if (command.type === 'reanswer')
        actions.current.reanswer(command.id, command.answerType);
      // Mac 1.8.1 / Windows 1.7.5: "Wrong screen?" on the overlay's card.
      else if (command.type === 'wrong-screen') actions.current.retakeScreen(command.id);
      else if (command.type === 'chat-target') {
        setTarget(command.target);
        setChatTarget(props.session.id, command.target);
      } else if (command.type === 'end') onEnd.current();
      else if (command.type.startsWith('record-')) recordCommand(command);
      else if (command.type === 'chat') actions.current.chat(command.question);
      else if (command.type === 'chat-screenshot')
        actions.current.screenshot(command.question, 'screenshot-chat');
      else if (command.type === 'style') {
        setStyle(command.style);
        // Kept with the session, so a reconnect and the review show what was used last. Only the style is
        // written (ADR-0094): the model may have changed since the call started.
        updateSessionPreferences(props.session.id, { style: command.style }).catch(() => undefined);
      } else if (command.type === 'model') switchModel.current(command.model);
    });
    return () => {
      // ADR-0055 (amended 26 Nov 2026): Click-through never outlives the call (safety net (c)).
      link.publish({ ...compactStateRef.current, clickThrough: false, ended: true });
      link.close();
      channel.current = null;
      void getPlatform()
        .closeCompactView()
        .catch(() => undefined);
    };
  }, [props.session.id, recordCommand]);
  useEffect(() => {
    compactStateRef.current = compactState;
    channel.current?.publish(compactState);
  }, [compactState]);
  // The level bars get their own small message, a few times a second.
  const levelsSentAt = useRef(0);
  const levels = props.levels;
  useEffect(() => {
    if (!levels) return;
    const now = performance.now();
    if (now - levelsSentAt.current < LEVELS_EVERY_MS) return;
    levelsSentAt.current = now;
    channel.current?.publishLevels(levels);
  }, [levels]);

  // "Start calls in the overlay" (Settings, default on; ADR-0029). Since ADR-0053 Connect opens
  // the overlay itself, inside its click (a browser's picture-in-picture window needs one), and
  // this view mounts once the call is connected: the main window then steps aside, or the user is
  // told how to open the overlay. Mounted without LivePage (harnesses), it opens the overlay here.
  const startInOverlay = props.startInOverlay;
  const overlayAtStart = props.overlayAtStart;
  useEffect(() => {
    const opened = () => {
      overlayOpened.current = true;
      getPlatform().minimizeMainWindow();
    };
    const failed = () =>
      setCompactNotice('To follow the call in the overlay, press Back to compact.');
    if (overlayAtStart === 'opened') opened();
    else if (overlayAtStart === 'failed') failed();
    else if (overlayAtStart === undefined && (startInOverlay ?? startsCallsInOverlay())) {
      openOverlay(props.session.id).then(opened, failed);
    }
  }, [props.session.id, startInOverlay, overlayAtStart]);

  // Mounted only during a call, so the desktop app's global shortcuts are on only then.
  useEffect(
    () =>
      getPlatform().onHotkey(
        (action) => {
          // ADR-0123: on a call the other person's newest question; on your own, yours.
          if (action === 'answer') actions.current.answer('hotkey');
          // ADR-0123: Ctrl+Shift+Space answers the user's own last spoken question, in both modes (ADR-0082 to
          // ADR-0123 it listened for a new voice question). Ctrl+Alt+Enter is still the screenshot and voice
          // question.
          else if (action === 'chat') actions.current.ownQuestion('own-question-key');
          else if (action === 'screenshot-send') void voiceQuestion.current(true);
          else if (action === 'voice-cancel') cancelVoice.current();
          else if (action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') {
            stepZoom(action);
          } else if (action === 'clear') clearAnswers.current();
          else if (action === 'clear-transcript') clearTranscript.current();
          else if (action === 'prev') actions.current.prev();
          else if (action === 'next') actions.current.next();
          else if (action === 'screenshot')
            actions.current.screenshot(undefined, 'screenshot-hotkey');
          else if (action === 'script-bar') {
            // Ctrl+Alt+S (v1.0.2): the overlay becomes the script bar, or full again. The overlay
            // must be open for it to show.
            setScriptBar((on) => !on);
            openOverlay(sessionIdRef.current).catch(() => undefined);
          } else if (action === 'click-through') {
            // v1.3.2: Ctrl+Alt+X from any app turns Click-through on or off. ADR-0055 (amended 26 Nov 2026):
            // the one way back from the overlay itself, since the whole overlay passes clicks while it is on.
            setClickThrough((on) => !on);
          } else if (action === 'click-through-off') {
            // ADR-0055 (amended 26 Nov 2026): the tray's "Turn click-through off" (a newer shell): only off.
            setClickThrough(false);
          } else if (action === 'record') {
            // Desktop 1.5.0 (ADR-0068): Ctrl+Alt+R from any app: the bars ask Start or Stop (consent
            // is a click, never the shortcut alone).
            overlayProps.current.recording?.prompt();
          } else if (action === 'ask-kite') {
            // ADR-0122: while the overlay is in use it opens the overlay's chat bar (it counts the presses), without
            // taking the keyboard from the meeting. (ADR-0082 to ADR-0122 the overlay had no message box, and Ask
            // AI opened in the dashboard.)
            if (overlayOpened.current) {
              setAskKiteCount((count) => count + 1);
              return;
            }
            // Leaving this page would end the call, so during a call the shortcut opens the chat
            // box here, set to a private answer (ADR-0030).
            setFocusSignal((count) => count + 1);
            setTarget('kite');
            setChatTarget(sessionIdRef.current, 'kite');
            setAskKiteCount((count) => count + 1);
          }
        },
        (labels, answer, unavailable, takenActions) => {
          setTaken(labels);
          setAnswerTaken(answer ?? null);
          setTakenUnavailable(unavailable ?? []);
          setClickThroughKeyTaken(takenActions?.includes('click-through') ?? false);
        },
      ),
    [],
  );

  // The dictated question goes where a typed one would (ADR-0038); for "For the call" the words
  // also stay in the transcript as "You" (useCallDictation decides that).
  // ADR-0082: after Ctrl+Alt+Enter it goes with the screenshot taken before it.
  const dictation = props.dictation;
  useEffect(() => {
    if (!dictation) return;
    dictation.setOnText((text) => {
      const image = voiceShot.current;
      voiceShot.current = null;
      if (image) actions.current.askAboutScreen(text, image);
      else actions.current.chat(text);
    });
    // ADR-0101: a voice question is answered as soon as the user stops: held hidden at the first
    // end-of-speech signal, shown when they have really finished, cancelled silently if they go on, and asked
    // again on the same card with the whole question if they go on just after it was shown. The screenshot
    // taken before a Ctrl+Alt+Enter question goes with every one of these. ADR-0121: except the held one: a
    // question with a screenshot is sent only when it is shown, so a cancelled attempt never sends the image.
    /** The card of the question being asked now, and whether its answer is still held hidden. */
    let card: { id: string; held: boolean } | null = null;
    /**
     * ADR-0107: the screenshot for a new question. In Voice mode the Ctrl+Alt+Enter screenshot belongs to the
     * next question only: once a card has used it and a different question starts, it is dropped (before,
     * every later voice question carried the old screen).
     *
     * @returns The screenshot to send with the new question, or null.
     */
    const shotForNewQuestion = () => {
      if (voiceShotCard.current !== null && voiceShotCard.current !== card?.id) {
        voiceShot.current = null;
        voiceShotCard.current = null;
      }
      return voiceShot.current;
    };
    /**
     * Notes which card used the screenshot.
     *
     * @param id    The card voiceAsk() made, or null when it made none.
     * @param image The screenshot sent with it, or null.
     */
    const usedShot = (id: string | null, image: string | null) => {
      if (id && image) voiceShotCard.current = id;
    };
    /**
     * ADR-0121: true while a question with a screenshot waits out its hold without a request. A held request
     * that the user talks over is cancelled, but it was already sent with the whole image (about 2,000 input
     * tokens, billed, and counted against the daily limit) and each new attempt sent it again. With a
     * screenshot the question is therefore sent once, when it is shown (at most VOICE_HOLD_MS, 0.3 s, later;
     * at once on a strong end of speech); without one, nothing changes.
     */
    let shotWaiting = false;
    dictation.setVoiceHandler({
      speculate: (text, _target, timing) => {
        const image = shotForNewQuestion();
        if (image) {
          // ADR-0121: nothing is sent yet; show() sends it with the screenshot once the hold is over.
          shotWaiting = true;
          return;
        }
        const id = actions.current.voiceAsk(text, {
          image,
          held: true,
          speechEnd: timing.speechEnd,
        });
        usedShot(id, image);
        card = id ? { id, held: true } : null;
      },
      show: (text, _target, timing) => {
        shotWaiting = false;
        if (card?.held) {
          actions.current.voiceShow(card.id);
          card = { id: card.id, held: false };
          return;
        }
        const image = shotForNewQuestion();
        const id = actions.current.voiceAsk(text, {
          image,
          held: false,
          speechEnd: timing.speechEnd,
        });
        usedShot(id, image);
        card = id ? { id, held: false } : null;
      },
      cancel: () => {
        if (shotWaiting) {
          // ADR-0121: the user went on speaking before a screenshot question was sent: nothing to cancel,
          // nothing paid; the screenshot stays free for the whole question.
          shotWaiting = false;
          card = null;
          return;
        }
        if (card?.held) actions.current.voiceCancel(card.id);
        // ADR-0107: the user went on speaking: the same question continues, so the screenshot stays free for it.
        if (card && voiceShotCard.current === card.id) voiceShotCard.current = null;
        card = null;
      },
      extend: (text, _target, timing) => {
        shotWaiting = false;
        // The same question, asked again on its card: it keeps its screenshot.
        const image = voiceShot.current;
        const id = actions.current.voiceAsk(text, {
          image,
          held: false,
          speechEnd: timing.speechEnd,
          ...(card ? { replaces: card.id } : {}),
        });
        usedShot(id, image);
        card = id ? { id, held: false } : null;
      },
      prewarm: () => actions.current.prewarm(),
    });
    return () => {
      dictation.setOnText(null);
      dictation.setVoiceHandler(null);
    };
  }, [dictation]);

  // ADR-0082: listening ended without a question (nothing heard, cancelled): the screenshot is dropped.
  const listening = props.dictation?.listening ?? false;
  useEffect(() => {
    if (!listening) voiceShot.current = null;
  }, [listening]);

  // ADR-0082: while a voice question listens, Escape cancels it: from any app where the shell can hold it
  // (desktop 1.6.4), and in this window.
  useEffect(() => {
    if (!listening) return;
    const platform = getPlatform();
    platform.setVoiceCancelHotkey(true);
    const onKey = (event: KeyboardEvent) => {
      if (!isVoiceCancelKey(event)) return;
      // Before the Escape that goes back to the overlay.
      event.preventDefault();
      cancelVoice.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      platform.setVoiceCancelHotkey(false);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [listening]);

  // ADR-0082: Ctrl+Alt+Enter is a call shortcut. A desktop app from 1.2.0 to 1.6.3 holds it only while the
  // page asks (it was the chat bar's key), so the page asks for the whole call; 1.6.4 holds it anyway.
  useEffect(() => {
    const platform = getPlatform();
    platform.setChatHotkey(true);
    return () => platform.setChatHotkey(false);
  }, []);

  // The transcript's "Answer this" buttons (drawn by the live page) use this panel's guarded ask.
  const onAnswerThis = props.onAnswerThis;
  const answerThis = answers.answerThis;
  const answeredSpans = useMemo(
    () => answers.answeredSpans.map((entry) => entry.span),
    [answers.answeredSpans],
  );
  useEffect(() => {
    onAnswerThis?.({ answerThis, answeredSpans });
  }, [onAnswerThis, answerThis, answeredSpans]);

  const sessionId = props.session.id;
  /** Back to the overlay (v1.0.4): it opens and this window steps aside, or says why it could not. */
  const backToCompact = useCallback(() => {
    setCompactNotice(null);
    openOverlay(sessionId).then(
      () => {
        overlayOpened.current = true;
        getPlatform().minimizeMainWindow();
      },
      (error: unknown) =>
        setCompactNotice(
          error instanceof Error ? error.message : 'Paramount AI could not open the overlay.',
        ),
    );
  }, [sessionId]);

  // Escape goes back to the overlay (v1.0.4), once it has been open in this call. A menu, a dialog,
  // or a box with text in it keeps its own Escape; a browser may refuse, as Escape does not count as
  // a click for picture-in-picture, and the notice then says to press Back to compact.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !overlayOpened.current) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (tag === 'INPUT' && (target as HTMLInputElement).value !== '') return;
      if (document.querySelector('dialog[open], [role="dialog"], [role="menu"]')) return;
      backToCompact();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backToCompact]);

  /**
   * Moves the overlay to a preset place at its default size (desktop app, ADR-0035).
   *
   * @param preset Where.
   */
  const place = (preset: OverlayPreset) => {
    getPlatform().placeOverlay(preset);
  };

  // The ⋮ menu, in the reference order; desktop-only entries only where the shell can do them. The
  // browser's own strip has the language; everything here works in a browser too (v1.1.0, item 23).
  const menu: MenuItem[] = [
    {
      label: `Theme: ${THEME_LABELS[appearance.theme]}`,
      onSelect: () => setTheme(nextTheme(appearance.theme), 'call'),
    },
    {
      label: `Larger text (${Math.round(appearance.fontScale * 100)}%)`,
      onSelect: () =>
        setFontScale(clampStep(appearance.fontScale + FONT_SCALE_RANGE.step, FONT_SCALE_RANGE)),
    },
    {
      label: 'Smaller text',
      onSelect: () =>
        setFontScale(clampStep(appearance.fontScale - FONT_SCALE_RANGE.step, FONT_SCALE_RANGE)),
    },
    {
      label: `Auto answer: ${autoOn ? 'on' : 'off'}`,
      onSelect: () => setAutoChoice(!autoOn),
    },
    // Never in this window: leaving this page would end the call. So not at all in a desktop shell
    // before 1.1.0, which has no other window to open it in.
    ...(getPlatform().kind === 'desktop' && !getPlatform().hasHomePanel()
      ? []
      : [
          {
            label: 'Edit session',
            // ADR-0051: editing happens in the dashboard, in the system browser.
            onSelect: () => openDashboard(`/sessions/${sessionId}/edit`),
          },
        ]),
    ...(placement
      ? [
          {
            label: scriptBar ? 'Full overlay' : 'Script bar',
            onSelect: () => {
              setScriptBar((on) => !on);
              backToCompact();
            },
          },
        ]
      : []),
    { label: 'Answer preferences', onSelect: () => setPrefsOpen(true) },
    {
      label: 'Clear answers',
      onSelect: () => {
        // ADR-0082: the same as Ctrl+Backspace (the overlay follows).
        clearAnswers.current();
      },
    },
    ...(placement
      ? [{ label: 'Reset overlay size and position', onSelect: () => place('top-center') }]
      : []),
    { label: 'End call', onSelect: props.onEnd, danger: true },
  ];

  const topBar = (
    <TopBar
      callStartedAt={props.callStartedAt}
      menu={menu}
      onEnd={props.onEnd}
      ending={props.ending}
      mac={mac}
      onAnswer={() => answers.answer('button')}
      answering={answering}
      onScreenshot={() => answers.screenshot(undefined, 'screenshot-button')}
      capturing={answers.capturing}
      onChat={() => setFocusSignal((count) => count + 1)}
      onBack={backToCompact}
      dictation={dictation?.supported ? dictation : undefined}
      target={chatTarget}
      slim={props.slimTopBar}
      recording={props.recording?.compact}
      onRecordCommand={recordCommand}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {props.topBarSlot ? createPortal(topBar, props.topBarSlot) : topBar}
      {compactNotice && (
        <p role="status" className="bg-ui-surface px-3 py-2 text-[13px] text-ui-text">
          {compactNotice}
        </p>
      )}
      {clickThroughOn && (
        // ADR-0055 (amended 26 Nov 2026), safety net (b): the overlay passes every click while Click-through is
        // on, so this window (the desktop's call window) can always turn it off.
        <div
          role="status"
          data-click-through-notice=""
          className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
        >
          <p>
            Click-through is on: every click on the overlay goes to the app behind it.
            {clickThroughKeyTaken
              ? ' Click W on bar 1, or turn it off here.'
              : ` Press ${clickThroughKeyLabel(mac)}, or turn it off here.`}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setClickThrough(false)}>
            Turn click-through off
          </Button>
        </div>
      )}
      {(taken.length > 0 || takenUnavailable.length > 0) && (
        <p
          role="status"
          className="rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
        >
          {taken.length > 0 && (
            <>
              Another app already uses {taken.join(', ')}, so{' '}
              {taken.length === 1 ? 'it works' : 'they work'} only while Paramount AI is in
              front.{' '}
            </>
          )}
          {takenUnavailable.length > 0 && (
            <>
              {/* ADR-0110 (amended 25 Nov 2026): these have no in-page fallback. */}
              Another app already uses {takenUnavailable.join(', ')}, so{' '}
              {takenUnavailable.length === 1 ? 'it does' : 'they do'} not work during this
              call.{' '}
            </>
          )}
          Close that app&rsquo;s shortcut, or use the buttons.
        </p>
      )}
      {!online && (
        <div
          role="alert"
          className="rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
        >
          <p className="text-[13px] font-medium text-ui-warning">No connection</p>
          <p className="mt-1">
            Answers are paused until the connection is back. The transcript keeps going on this
            computer.
          </p>
        </div>
      )}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={appearance.fontScale === 1 ? undefined : { zoom: appearance.fontScale }}
      >
        <AnswerPanel
          entries={answers.entries}
          shownId={entry?.id ?? null}
          // ADR-0082: cleared answers are no longer in the list at all (Clear answers).
          hiddenBefore={0}
          onShowHidden={() => undefined}
          terms={terms}
          mac={mac}
          notice={answers.notice}
          onCancel={answers.clear}
          onRate={answers.rate}
          onReport={answers.report}
          onSignInAgain={() => setSignInOpen(true)}
          {...(props.copy ? { copy: props.copy } : {})}
          sessionType={props.session.type}
          onReanswer={answers.reanswer}
          onWrongScreen={answers.retakeScreen}
          capturing={answers.capturing}
          onShow={answers.show}
        />
      </div>
      <ChatBox
        ref={chatBox}
        onSend={answers.chat}
        onAskScreen={(question) => answers.screenshot(question, 'screenshot-chat')}
        target={chatTarget}
        focusSignal={focusSignal}
        onTarget={(target) => {
          setTarget(target);
          setChatTarget(props.session.id, target);
        }}
        {...(dictation?.supported
          ? {
              dictation: {
                listening: dictation.listening,
                notice: dictation.notice,
                onToggle: () =>
                  dictation.listening ? dictation.stop() : dictation.start(chatTarget),
              },
            }
          : {})}
      />
      {/* The large buttons, with their keys (reference layout). */}
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <button
          type="button"
          className={`${BIG_BUTTON} bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover`}
          onClick={() => answers.answer('button')}
          disabled={answering || props.ending}
          title="Answer the latest question"
        >
          Answer
          <KeyChip hotkey="answer" visibleAt="@min-[520px]:inline-flex" onPrimary />
        </button>
        <button
          type="button"
          className={`${BIG_BUTTON} border border-ui-border bg-ui-surface text-ui-text hover:bg-ui-hover`}
          onClick={() => answers.screenshot(undefined, 'screenshot-button')}
          disabled={answers.capturing || props.ending}
          title="Answer from a screenshot of your screen"
        >
          {answers.capturing ? 'Screenshot…' : 'Screenshot'}
          <KeyChip hotkey="screenshot" visibleAt="@min-[520px]:inline-flex" />
        </button>
      </div>
      <AnswerPreferencesDialog
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        style={style}
        onApply={(next) => {
          setPrefsOpen(false);
          setStyle(next);
          // Kept with the session, like the overlay's menu (ADR-0029); only the style (ADR-0094).
          updateSessionPreferences(props.session.id, { style: next }).catch(() => undefined);
        }}
      />
      <SignInAgainDialog
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        onSignedIn={() => setSignInOpen(false)}
      />
      {answers.saveFailed && (
        <p
          role="alert"
          className="rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
        >
          An answer, rating or note could not be saved on this computer (is the disk full?).
        </p>
      )}
    </div>
  );
}
