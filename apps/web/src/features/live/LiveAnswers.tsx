/**
 * File: apps/web/src/features/live/LiveAnswers.tsx
 * Purpose: The answer part of the live view: the top bar (Answer · Chat · Screenshot · Clear ·
 *          Compact view · End), the chat box, and the answer panel, plus the hotkeys (through
 *          the platform adapter: in-page shortcuts, and the desktop app's global shortcuts) and
 *          (Day 5) the link to the compact view (core/live/liveChannel.ts).
 * Used by: src/features/live/LivePage.tsx (live view);
 *          tests/integration/harness/answers.tsx (the answer harness test)
 * Depends on: src/features/live (useLiveAnswers, TopBar, ChatBox, AnswerPanel), src/platform
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session), §7.3 (hotkeys);
 *               day-04-answers.md Stage 6
 */
'use client';

import type { TargetChoice } from '@kite/shared';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { splitAnswer } from '@/core/answer/format';
import { getChatTarget, setChatTarget } from '@/core/storage/answerPrefs';
import { updateSession } from '@/core/storage/sessions';
import { getStartInOverlay } from '@/core/storage/overlayPrefs';
import { displayTerms, sentenceCase, transcriptChips } from '@/core/transcript/display';
import {
  openLiveChannel,
  type CompactAudio,
  type CompactState,
  type LiveChannel,
} from '@/core/live/liveChannel';
import type { Session, StoredDocument } from '@/core/storage/types';
import type { Transcript } from '@/core/transcript/transcript';
import { getPlatform } from '@/platform';
import { AnswerPanel } from './AnswerPanel';
import { openOverlay } from './openOverlay';
import { ChatBox } from './ChatBox';
import { TopBar } from './TopBar';
import { isOnline, subscribeOnline } from '@/core/net/online';
import { SignInAgainDialog } from './SignInAgainDialog';
import { useAutoAnswer } from './useAutoAnswer';
import { useLiveAnswers, type AnswerStore } from './useLiveAnswers';

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
}

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
  const answers = useLiveAnswers({
    chatTarget,
    session,
    documents: props.documents,
    ...(props.lessons ? { lessons: props.lessons } : {}),
    transcript: props.transcript,
    callStartedAt: props.callStartedAt,
    store: props.store,
  });
  const [chatOpen, setChatOpen] = useState(false);
  // Desktop app: global shortcuts another app already uses (they work only while Kite has focus).
  const [taken, setTaken] = useState<string[]>([]);
  const mac = useSyncExternalStore(subscribeNever, isMac, () => false);
  const entry = answers.index >= 0 ? (answers.entries[answers.index] ?? null) : null;
  const answering = answers.entries.some((candidate) => candidate.status === 'streaming');
  // Auto-answer (beta, off by default): answers a finished question from Them by itself.
  useAutoAnswer({
    transcript: props.transcript,
    streaming: answering,
    autoAnswer: answers.autoAnswer,
    // This session's own switch turns it on; otherwise the device-wide setting decides.
    ...(props.autoAnswer !== undefined
      ? { enabled: props.autoAnswer }
      : props.session.autoAnswer
        ? { enabled: true }
        : {}),
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
  const compactState = useMemo<CompactState>(() => {
    const parts = entry ? splitAnswer(entry.text) : null;
    return {
      audio: { you: audioYou, them: audioThem },
      chips: transcriptChips(lines, terms),
      lines: lines.slice(-30).map((line) => ({
        id: line.id,
        speaker: line.speaker,
        text: sentenceCase(line.text, terms),
        final: line.final,
      })),
      answer:
        entry && parts
          ? {
              id: entry.id,
              question: sentenceCase(entry.question, terms),
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
      // Newest first (ADR-0030). A cap, because this goes over the channel on every word.
      earlier: answers.entries
        .filter((other) => other.id !== entry?.id && other.text.trim() !== '')
        .slice(-20)
        .reverse()
        .map((other) => ({
          id: other.id,
          question: sentenceCase(other.question, terms),
          headline: splitAnswer(other.text).headline,
        })),
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
    };
  }, [
    lines,
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
  useEffect(() => {
    sessionIdRef.current = props.session.id;
    actions.current = answers;
    onEnd.current = props.onEnd;
    latestPreferences.current = props.session.preferences;
  });
  // The link to the compact view (Day 5): it sends commands; End (unmount) tells it the call
  // ended and asks the platform to close it.
  useEffect(() => {
    const link = openLiveChannel(props.session.id);
    channel.current = link;
    link.onCommand((command) => {
      if (command.type === 'hello') link.publish(compactStateRef.current);
      else if (command.type === 'answer') actions.current.answer();
      else if (command.type === 'screenshot') actions.current.screenshot();
      else if (command.type === 'clear') actions.current.clear();
      else if (command.type === 'prev') actions.current.prev();
      else if (command.type === 'next') actions.current.next();
      else if (command.type === 'rate') actions.current.rate(command.id, command.rating);
      else if (command.type === 'report') actions.current.report(command.id, command.note);
      else if (command.type === 'show') actions.current.show(command.id);
      else if (command.type === 'reanswer')
        actions.current.reanswer(command.id, command.answerType);
      else if (command.type === 'chat-target') {
        setTarget(command.target);
        setChatTarget(props.session.id, command.target);
      } else if (command.type === 'end') onEnd.current();
      else if (command.type === 'chat') actions.current.chat(command.question);
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
  }, [props.session.id]);
  useEffect(() => {
    compactStateRef.current = compactState;
    channel.current?.publish(compactState);
  }, [compactState]);

  // "Start calls in the overlay" (Settings, default on; ADR-0029): this view mounts when the call
  // connects, so that is when the overlay opens and the main window steps aside. A browser asks
  // for a fresh click before it opens a picture-in-picture window, so there the user is told.
  const startInOverlay = props.startInOverlay;
  useEffect(() => {
    if (!(startInOverlay ?? getStartInOverlay())) return;
    openOverlay(props.session.id).then(
      () => getPlatform().minimizeMainWindow(),
      () => setCompactNotice('To follow the call in the overlay, press Overlay.'),
    );
  }, [props.session.id, startInOverlay]);

  // Mounted only during a call, so the desktop app's global shortcuts are on only then.
  useEffect(
    () =>
      getPlatform().onHotkey((action) => {
        if (action === 'answer') actions.current.answer();
        else if (action === 'chat') setChatOpen((open) => !open);
        else if (action === 'clear') actions.current.clear();
        else if (action === 'prev') actions.current.prev();
        else if (action === 'next') actions.current.next();
        else if (action === 'screenshot') actions.current.screenshot();
        else if (action === 'ask-kite') {
          // Leaving this page would end the call, so during a call the shortcut opens the chat
          // box, here and in the overlay, set to a private answer (ADR-0030).
          setChatOpen(true);
          setTarget('kite');
          setChatTarget(sessionIdRef.current, 'kite');
          setAskKiteCount((count) => count + 1);
        }
      }, setTaken),
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      <TopBar
        mac={mac}
        chatOpen={chatOpen}
        answering={answering}
        ending={props.ending}
        onAnswer={answers.answer}
        onScreenshot={() => answers.screenshot()}
        capturing={answers.capturing}
        onToggleChat={() => setChatOpen((open) => !open)}
        onClear={answers.clear}
        onEnd={props.onEnd}
        onCompact={() => {
          setCompactNotice(null);
          openOverlay(props.session.id).catch((error: unknown) =>
            setCompactNotice(
              error instanceof Error ? error.message : 'Kite could not open the overlay.',
            ),
          );
        }}
      />
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
          {taken.length === 1 ? 'it works' : 'they work'} only while Kite is in front. Close that
          app&rsquo;s shortcut, or use the buttons.
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
      {chatOpen && (
        <ChatBox
          onSend={answers.chat}
          onAskScreen={answers.screenshot}
          target={chatTarget}
          onTarget={(target) => {
            setTarget(target);
            setChatTarget(props.session.id, target);
          }}
        />
      )}
      <AnswerPanel
        entry={entry}
        terms={terms}
        index={answers.index}
        total={answers.entries.length}
        mac={mac}
        notice={answers.notice}
        onPrev={answers.prev}
        onNext={answers.next}
        onCancel={answers.clear}
        onRate={answers.rate}
        onSignInAgain={() => setSignInOpen(true)}
        onNote={answers.saveNote}
        copy={props.copy}
        sessionType={props.session.type}
        onReanswer={answers.reanswer}
        entries={answers.entries}
        onShow={answers.show}
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
