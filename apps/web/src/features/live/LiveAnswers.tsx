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
 *          meeting recording's state, its commands and Ctrl+Alt+R.
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
import { updateSession } from '@/core/storage/sessions';
import {
  clampStep,
  FONT_SCALE_RANGE,
  setFontScale,
  setTheme,
  type ThemeChoice,
} from '@/core/storage/appearancePrefs';
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
import type { HygieneState } from '@/core/live/hygiene';
import type { Session, StoredDocument } from '@/core/storage/types';
import type { Transcript } from '@/core/transcript/transcript';
import { getPlatform } from '@/platform';
import { AnswerPanel } from './AnswerPanel';
import { openOverlay, startsCallsInOverlay, type OverlayAtStart } from './openOverlay';
import { isDoublePress } from '@/core/live/doublePress';
import { ChatBox, type ChatBoxHandle } from './ChatBox';
import { KeyChip } from './overlay/parts';
import { TopBar } from './TopBar';
import { isOnline, subscribeOnline } from '@/core/net/online';
import { SignInAgainDialog } from './SignInAgainDialog';
import { useAutoAnswer } from './useAutoAnswer';
import type { CallDictation } from './useCallDictation';
import { openDashboard } from '@/features/sync/dashboardLink';
import { useSyncAccount } from '@/features/sync/SyncScope';
import { useLiveAnswers, type AnswerStore } from './useLiveAnswers';
import type { CallRecording } from './useCallRecording';

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
   * Desktop 1.5.0 (ADR-0068): the call's meeting recording (the Rec pill on both bars, Ctrl+Alt+R and
   * the ⋮ menu's type). Absent where the app cannot record, and in harnesses.
   */
  recording?: CallRecording;
}

/** How many of the latest bubbles the overlay gets: the call window and Review have them all. */
const OVERLAY_GROUPS = 150;

/** How many hidden echo lines in a call before the one-time "Use headphones" hint shows. */
const HEADPHONES_HINT_AFTER = 3;

/** How often the overlay's level bars get new levels, in ms: they change every 50 ms. */
const LEVELS_EVERY_MS = 120;

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
  // ADR-0051: with account sync, Edit session opens the dashboard in the browser.
  const synced = useSyncAccount() !== null;
  // Read only: the layout around this panel paints the theme (v1.1.0).
  const appearance = useAppearance('call', false);
  // The overlay's menu can change how answers are written during a call (ADR-0029).
  const [style, setStyle] = useState(props.session.preferences.style);
  const session = useMemo(
    () => ({ ...props.session, preferences: { ...props.session.preferences, style } }),
    [props.session, style],
  );
  // The chat box's switch, remembered per session (ADR-0030).
  const [chatTarget, setTarget] = useState<TargetChoice>(() => getChatTarget(props.session.id));
  // Grows with each press of the Ask Kite shortcut, so the overlay opens its chat box too.
  const [askKiteCount, setAskKiteCount] = useState(0);
  // v1.1.0: likewise the Chat shortcut pressed in another app.
  const [chatCount, setChatCount] = useState(0);
  // The chat bar's screenshot shortcut, pressed in another app (the overlay holds the typed words).
  const [screenshotSendCount, setScreenshotSendCount] = useState(0);
  const lastChatPress = useRef<number | null>(null);
  const chatBox = useRef<ChatBoxHandle>(null);
  // v1.1.0: the overlay's ⋮ can turn auto-answer on or off for this call.
  const [autoChoice, setAutoChoice] = useState<boolean | null>(null);
  const [headphonesClosed, setHeadphonesClosed] = useState(false);
  const answers = useLiveAnswers({
    chatTarget,
    session,
    documents: props.documents,
    ...(props.lessons ? { lessons: props.lessons } : {}),
    transcript: props.transcript,
    callStartedAt: props.callStartedAt,
    store: props.store,
    paused: props.hygiene === 'paused',
  });
  // Grows with each Chat or Ask Kite shortcut: the message box (always shown) takes the typing.
  const [focusSignal, setFocusSignal] = useState(0);
  // ⋮ "Clear answers" hides the answers asked until then from the list (Unix ms; 0: none hidden).
  const [hiddenBefore, setHiddenBefore] = useState(0);
  // Clear also takes the live question off the overlay until a new one is asked (Unix ms).
  const [questionClearedAt, setQuestionClearedAt] = useState(0);
  // The overlay as the slim script bar (v1.0.2; Ctrl+Alt+S or a ⋮ menu).
  const [scriptBar, setScriptBar] = useState(false);
  // v1.3.2: Click-through (the ⋮ menu or Ctrl+Alt+X): the overlay passes clicks and keys outside its bars.
  const [clickThrough, setClickThrough] = useState(false);
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
  const mac = useSyncExternalStore(subscribeNever, isMac, () => false);
  const entry = answers.index >= 0 ? (answers.entries[answers.index] ?? null) : null;
  const answering = answers.entries.some((candidate) => candidate.status === 'streaming');
  // Auto-answer (beta, off by default): answers a finished question from Them by itself.
  // The choice made in this call first; then this session's own switch; then the device's setting.
  const autoOn = autoChoice ?? props.autoAnswer ?? (props.session.autoAnswer || getAutoAnswer());
  useAutoAnswer({
    transcript: props.transcript,
    streaming: answering,
    autoAnswer: answers.autoAnswer,
    answeredState: answers.answeredState,
    enabled: autoOn,
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
      themName: speakerNames({ contactName: props.session.contactName }).them,
      language,
      autoAnswer: autoOn,
      chatCount,
      screenshotSendCount,
      hygiene: props.hygiene ?? 'ok',
      headphonesHint,
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
              askedAt: entry.askedAt,
              rating: entry.rating,
              reported: entry.reported ?? false,
              auto: entry.auto ?? false,
              status: entry.status,
              mode: entry.mode,
              error: entry.status === 'error' ? (entry.error ?? null) : null,
              unavailable: entry.unavailable ?? false,
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
      scriptBar,
      clickThrough,
      dictationSupported: props.dictation?.supported ?? false,
      dictating: props.dictation?.listening ?? false,
      dictationNotice: props.dictation?.notice ?? null,
      startedAt: props.callStartedAt,
      ...(recordingCompact ? { recording: recordingCompact } : {}),
    };
  }, [
    recordingCompact,
    groups,
    visibleLines,
    answeredSpanList,
    language,
    autoOn,
    chatCount,
    screenshotSendCount,
    props.hygiene,
    headphonesHint,
    props.session.id,
    props.session.contactName,
    props.micDeviceId,
    props.themSourceLabel,
    scriptBar,
    clickThrough,
    props.callStartedAt,
    props.dictation?.supported,
    props.dictation?.listening,
    props.dictation?.notice,
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
  ]);
  const compactStateRef = useRef(compactState);
  const channel = useRef<LiveChannel | null>(null);

  // The hotkeys call the latest actions (a ref, so the listener is added only once).
  const actions = useRef(answers);
  const onEnd = useRef(props.onEnd);
  const latestPreferences = useRef(props.session.preferences);
  const sessionIdRef = useRef(props.session.id);
  const dictationRef = useRef(props.dictation);
  const chatTargetRef = useRef(chatTarget);
  /** Clear: stops a streaming answer, goes back to the newest one, and clears the live question. */
  const clearView = useRef(() => {
    actions.current.clear();
  });
  // v1.1.0: the words on screen and the live question; the answer stays.
  const onClearTranscript = useRef(props.onClearTranscript);
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
    latestPreferences.current = props.session.preferences;
    onClearTranscript.current = props.onClearTranscript;
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
      else if (command.type === 'answer') actions.current.answer();
      else if (command.type === 'screenshot') actions.current.screenshot();
      else if (command.type === 'clear') clearView.current();
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
      } else if (command.type === 'script-bar') setScriptBar(command.on);
      else if (command.type === 'click-through') setClickThrough(command.on);
      else if (command.type === 'dictate') {
        if (command.on) dictationRef.current?.start(chatTargetRef.current);
        else dictationRef.current?.stop();
      } else if (command.type === 'prev') actions.current.prev();
      else if (command.type === 'next') actions.current.next();
      else if (command.type === 'rate') actions.current.rate(command.id, command.rating);
      else if (command.type === 'report') actions.current.report(command.id, command.note);
      else if (command.type === 'reanswer')
        actions.current.reanswer(command.id, command.answerType);
      else if (command.type === 'chat-target') {
        setTarget(command.target);
        setChatTarget(props.session.id, command.target);
      } else if (command.type === 'end') onEnd.current();
      else if (command.type.startsWith('record-')) recordCommand(command);
      else if (command.type === 'chat') actions.current.chat(command.question);
      else if (command.type === 'chat-screenshot') actions.current.screenshot(command.question);
      else if (command.type === 'style') {
        setStyle(command.style);
        // Kept with the session, so a reconnect and the review show what was used last.
        const preferences = { ...latestPreferences.current, style: command.style };
        updateSession(props.session.id, { preferences }).catch(() => undefined);
      }
    });
    return () => {
      link.publish({ ...compactStateRef.current, ended: true });
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
      getPlatform().onHotkey((action) => {
        if (action === 'answer') actions.current.answer();
        else if (action === 'chat') {
          setFocusSignal((count) => count + 1);
          setChatCount((count) => count + 1);
          // Pressed twice (spec S14): the microphone comes on too.
          const now = Date.now();
          if (isDoublePress(lastChatPress.current, now)) {
            dictationRef.current?.start(chatTargetRef.current);
          }
          lastChatPress.current = now;
        } else if (action === 'screenshot-send') {
          setScreenshotSendCount((count) => count + 1);
          chatBox.current?.sendWithScreenshot();
        } else if (action === 'clear') clearView.current();
        else if (action === 'clear-transcript') clearTranscript.current();
        else if (action === 'prev') actions.current.prev();
        else if (action === 'next') actions.current.next();
        else if (action === 'screenshot') actions.current.screenshot();
        else if (action === 'script-bar') {
          // Ctrl+Alt+S (v1.0.2): the overlay becomes the script bar, or full again. The overlay
          // must be open for it to show.
          setScriptBar((on) => !on);
          openOverlay(sessionIdRef.current).catch(() => undefined);
        } else if (action === 'click-through') {
          // v1.3.2: Ctrl+Alt+X from any app turns Click-through on or off.
          setClickThrough((on) => !on);
        } else if (action === 'record') {
          // Desktop 1.5.0 (ADR-0068): Ctrl+Alt+R from any app: the bars ask Start or Stop (consent
          // is a click, never the shortcut alone).
          overlayProps.current.recording?.prompt();
        } else if (action === 'ask-kite') {
          // Leaving this page would end the call, so during a call the shortcut opens the chat
          // box, here and in the overlay, set to a private answer (ADR-0030).
          setFocusSignal((count) => count + 1);
          setTarget('kite');
          setChatTarget(sessionIdRef.current, 'kite');
          setAskKiteCount((count) => count + 1);
        }
      }, setTaken),
    [],
  );

  // The dictated question goes where a typed one would (ADR-0038); for "For the call" the words
  // also stay in the transcript as "You" (useCallDictation decides that).
  const dictation = props.dictation;
  useEffect(() => {
    if (!dictation) return;
    dictation.setOnText((text) => actions.current.chat(text));
    return () => dictation.setOnText(null);
  }, [dictation]);

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
            // ADR-0051: with account sync, editing happens in the dashboard, in the system browser.
            onSelect: () =>
              synced
                ? openDashboard(`/sessions/${sessionId}/edit`)
                : getPlatform().openPagesWindow(`/sessions/${sessionId}/edit`),
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
        // The cards asked until now leave the list, except the newest (selected): never empty.
        if (!answering) setHiddenBefore(Date.now());
        clearView.current();
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
      onAnswer={answers.answer}
      answering={answering}
      onScreenshot={() => answers.screenshot()}
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
      {taken.length > 0 && (
        <p
          role="status"
          className="rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
        >
          Another app already uses {taken.join(', ')}, so{' '}
          {taken.length === 1 ? 'it works' : 'they work'} only while Paramount AI is in front. Close
          that app&rsquo;s shortcut, or use the buttons.
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
          hiddenBefore={hiddenBefore}
          onShowHidden={() => setHiddenBefore(0)}
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
          onShow={answers.show}
        />
      </div>
      <ChatBox
        ref={chatBox}
        onSend={answers.chat}
        onAskScreen={answers.screenshot}
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
          onClick={answers.answer}
          disabled={answering || props.ending}
          title="Answer the latest question"
        >
          Answer
          <KeyChip hotkey="answer" visibleAt="@min-[520px]:inline-flex" onPrimary />
        </button>
        <button
          type="button"
          className={`${BIG_BUTTON} border border-ui-border bg-ui-surface text-ui-text hover:bg-ui-hover`}
          onClick={() => answers.screenshot()}
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
          // Kept with the session, like the overlay's menu (ADR-0029).
          const preferences = { ...latestPreferences.current, style: next };
          updateSession(props.session.id, { preferences }).catch(() => undefined);
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
