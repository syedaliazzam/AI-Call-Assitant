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

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { splitAnswer } from '@/core/answer/format';
import { openLiveChannel, type CompactState, type LiveChannel } from '@/core/live/liveChannel';
import type { Session, StoredDocument } from '@/core/storage/types';
import type { Transcript } from '@/core/transcript/transcript';
import { getPlatform } from '@/platform';
import { createRoot } from 'react-dom/client';
import { AnswerPanel } from './AnswerPanel';
import { CompactLive } from './CompactLive';
import { ChatBox } from './ChatBox';
import { TopBar } from './TopBar';
import { useLiveAnswers, type AnswerStore } from './useLiveAnswers';

/** Props for LiveAnswers. */
export interface LiveAnswersProps {
  /** The session. */
  session: Session;
  /** Its documents. */
  documents: readonly StoredDocument[];
  /** The live transcript. */
  transcript: Transcript;
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
  const answers = useLiveAnswers({
    session: props.session,
    documents: props.documents,
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
  const [compactNotice, setCompactNotice] = useState<string | null>(null);
  const lines = useSyncExternalStore(
    props.transcript.subscribe,
    props.transcript.lines,
    props.transcript.lines,
  );
  const last = lines.at(-1);

  // What the compact view shows (Day 5): the latest line and the answer shown here.
  const compactState = useMemo<CompactState>(() => {
    const parts = entry ? splitAnswer(entry.text) : null;
    return {
      line: last ? { speaker: last.speaker, text: last.text } : null,
      answer:
        entry && parts
          ? {
              headline: parts.headline,
              bullets: parts.bullets,
              status: entry.status,
              mode: entry.mode,
            }
          : null,
      answering,
      capturing: answers.capturing,
      notice: answers.notice,
      ended: false,
    };
  }, [last, entry, answering, answers.capturing, answers.notice]);
  const compactStateRef = useRef(compactState);
  const channel = useRef<LiveChannel | null>(null);

  // The hotkeys call the latest actions (a ref, so the listener is added only once).
  const actions = useRef(answers);
  useEffect(() => {
    actions.current = answers;
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
      else if (command.type === 'chat') actions.current.chat(command.question);
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

  // Mounted only during a call, so the desktop app's global shortcuts are on only then.
  useEffect(
    () =>
      getPlatform().onHotkey((action) => {
        if (action === 'answer') actions.current.answer();
        else if (action === 'clear') actions.current.clear();
        else if (action === 'prev') actions.current.prev();
        else if (action === 'next') actions.current.next();
        else if (action === 'screenshot') actions.current.screenshot();
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
          getPlatform()
            .openCompactView(props.session.id, (container) => {
              // Browser: the compact view in the picture-in-picture window (same page, so it
              // reaches this live view over the session channel like the desktop window does).
              const root = createRoot(container);
              root.render(<CompactLive sessionId={props.session.id} closeOnEnd={false} />);
              return () => root.unmount();
            })
            .catch((error: unknown) =>
              setCompactNotice(
                error instanceof Error ? error.message : 'Kite could not open the compact view.',
              ),
            );
        }}
      />
      {compactNotice && (
        <p role="status" className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {compactNotice}
        </p>
      )}
      {taken.length > 0 && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Another app already uses {taken.join(', ')}, so{' '}
          {taken.length === 1 ? 'it works' : 'they work'} only while Kite is in front. Close that
          app&rsquo;s shortcut, or use the buttons.
        </p>
      )}
      {chatOpen && <ChatBox onSend={answers.chat} onAskScreen={answers.screenshot} />}
      <AnswerPanel
        entry={entry}
        index={answers.index}
        total={answers.entries.length}
        mac={mac}
        notice={answers.notice}
        onPrev={answers.prev}
        onNext={answers.next}
        onCancel={answers.clear}
        onRate={answers.rate}
        onNote={answers.saveNote}
        copy={props.copy}
      />
      {answers.saveFailed && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          An answer, rating or note could not be saved on this computer (is the disk full?).
        </p>
      )}
    </div>
  );
}
