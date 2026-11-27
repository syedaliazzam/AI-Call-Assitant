/**
 * File: apps/web/src/features/live/TopBar.tsx
 * Purpose: The full call window's top bar (v1.0.4, ADR-0040): the same controls as the overlay's, on
 *          the solid dark tokens: the microphone, Answer, Screenshot and Chat with their keys, the
 *          call timer, Back to compact, the ⋮ menu (Script bar, Answer preferences, Clear answers,
 *          Reset overlay size and position, End call) and End. Desktop 1.5.0 (ADR-0068): the Rec pill
 *          and its popover after Chat, where the app can record.
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/ui (Menu, icons), @kite/shared (hotkeys), src/features/live/overlay/parts.tsx
 *             (KeyChip), src/features/live/callClock.ts, src/features/live/useCallDictation.ts
 *             (CallDictation), src/features/live/overlay/RecordControls.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); ADR-0040
 */
'use client';

import { type TargetChoice } from '@kite/shared';
import { useEffect, useState } from 'react';
import type { CompactCommand, CompactRecording } from '@/core/live/liveChannel';
import { MenuIcon, MicIcon } from '@/ui/icons';
import { Menu, type MenuItem } from '@/ui/Menu';
import { shownKeyLabel, useHeldHotkeys } from '@/ui/shownKeys';
import { callClock } from './callClock';
import { KeyChip } from './overlay/parts';
import { pressRecPill, RecordPopover, RecPill } from './overlay/RecordControls';
import { usePrivateOffWhileRecording } from './PrivateOffWarning';
import type { CallDictation } from './useCallDictation';

/** Props for TopBar. */
export interface TopBarProps {
  /** When the call connected (Unix ms), for the timer. */
  callStartedAt: number;
  /** The ⋮ menu's actions, in order. */
  menu: readonly MenuItem[];
  /** Ends the call. */
  onEnd: () => void;
  /** True while End waits for the last line. */
  ending: boolean;
  /** True on macOS (for the key hints). */
  mac: boolean;
  /** Answers the latest question. */
  onAnswer: () => void;
  /** True while an answer streams. */
  answering: boolean;
  /** Answers from a screenshot. */
  onScreenshot: () => void;
  /** True while a screenshot is being taken. */
  capturing: boolean;
  /** Puts the typing in the message box. */
  onChat: () => void;
  /** Goes back to the overlay. */
  onBack: () => void;
  /** The microphone; absent when questions cannot be dictated in this call. */
  dictation?: CallDictation | undefined;
  /** Who a dictated question is for. */
  target: TargetChoice;
  /**
   * True for the browser call view: only the timer, ⋮ and End. The other controls are already there:
   * the big Answer and Screenshot buttons, the message box with its microphone, and Minimize.
   */
  slim?: boolean | undefined;
  /** Desktop 1.5.0 (ADR-0068): the meeting recording, where this app can record. */
  recording?: CompactRecording | undefined;
  /** Desktop 1.5.0: sends a recording command (the same as the overlay's). */
  onRecordCommand?: ((command: CompactCommand) => void) | undefined;
}

/**
 * The Rec pill and its popover in the top bar (desktop 1.5.0, ADR-0068). Ctrl+Alt+R opens the question
 * here too (the overlay may be hidden while this window is in front); a new notice opens by itself.
 * @param props.recording The recording's state.
 * @param props.onCommand Sends a recording command.
 * @param props.mac       True on macOS.
 * @param props.disabled  True while the call ends.
 * @returns The pill and, when open, its popover.
 * Rendered by: TopBar
 */
function TopBarRecord({
  recording,
  onCommand,
  mac,
  disabled,
}: {
  /** The recording's state. */
  recording: CompactRecording;
  /** Sends a recording command. */
  onCommand: (command: CompactCommand) => void;
  /** True on macOS. */
  mac: boolean;
  /** True while the call ends. */
  disabled: boolean;
}) {
  const [open, setOpen] = useState<'question' | 'notice' | null>(null);
  // 1.5.2 (ADR-0070): the Rec pill says "Visible in recording" while Private is off.
  const privateOff = usePrivateOffWhileRecording(recording);
  const [seenPrompts, setSeenPrompts] = useState(recording.promptCount);
  if (recording.promptCount !== seenPrompts) {
    setSeenPrompts(recording.promptCount);
    if (recording.promptCount > seenPrompts) setOpen('question');
  }
  const [seenNotice, setSeenNotice] = useState(recording.notice);
  if (recording.notice !== seenNotice) {
    setSeenNotice(recording.notice);
    if (recording.notice && open !== 'question') setOpen('notice');
    else if (!recording.notice && open === 'notice') setOpen(null);
  }
  return (
    <span className="relative inline-flex">
      <RecPill
        recording={recording}
        open={open === 'question'}
        // ADR-0082: starts at once when consent was ticked at Connect; otherwise asks.
        onToggle={() =>
          pressRecPill(recording, onCommand, () => setOpen(open === 'question' ? null : 'question'))
        }
        disabled={disabled}
        mac={mac}
        keyAt="inline-flex"
        visibleInRecording={privateOff.visible}
      />
      {open && (
        <RecordPopover
          recording={recording}
          mode={open}
          onCommand={onCommand}
          onClose={() => setOpen(null)}
          left={0}
        />
      )}
    </span>
  );
}

/** A button in the bar: its normal size and focus ring; the caller adds its colours. */
const BUTTON_BASE =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-control px-2.5 text-[13px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11';

/** A quiet button in the bar. */
const BUTTON = `${BUTTON_BASE} border border-ui-border bg-ui-surface text-ui-text hover:bg-ui-hover`;

/**
 * The top bar.
 *
 * @param props See TopBarProps.
 * @returns The bar.
 * Rendered by: LiveAnswers.tsx
 */
export function TopBar(props: TopBarProps) {
  // ADR-0128: re-render once the desktop app reports the keys it holds (the buttons' titles read them).
  useHeldHotkeys();
  // The timer ticks from a clock state the interval advances (no setState in the effect body).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((nowMs - props.callStartedAt) / 1_000));
  const { dictation, mac, slim } = props;

  if (slim) {
    return (
      <div role="toolbar" aria-label="Call controls" className="flex items-center gap-2">
        <span
          className="inline-flex h-8 items-center rounded-control border border-ui-border bg-ui-surface px-3 font-mono text-[14px] tabular-nums text-ui-text"
          aria-label="Call time"
          role="timer"
        >
          {callClock(elapsed)}
        </span>
        <Menu label={<MenuIcon />} ariaLabel="More" variant="ghost" items={props.menu} />
        <button
          type="button"
          className={`${BUTTON_BASE} bg-ui-end text-ui-on-end hover:opacity-90`}
          onClick={props.onEnd}
          disabled={props.ending}
        >
          {props.ending ? 'Ending…' : 'End'}
        </button>
      </div>
    );
  }

  return (
    <div role="toolbar" aria-label="Call controls" className="flex flex-wrap items-center gap-1.5">
      {dictation && (
        <button
          type="button"
          className={`${BUTTON_BASE} w-8 px-0 ${dictation.listening ? 'animate-pulse bg-ui-danger text-white' : 'text-ui-success hover:bg-ui-hover'}`}
          aria-label={dictation.listening ? 'Stop listening' : 'Speak a question'}
          aria-pressed={dictation.listening}
          title={
            dictation.listening
              ? 'Listening… speak your question (press to stop)'
              : (dictation.notice ??
                'Speak a question: it is sent when you pause (it becomes text only)')
          }
          onClick={() => (dictation.listening ? dictation.stop() : dictation.start(props.target))}
        >
          <MicIcon />
        </button>
      )}
      <button
        type="button"
        className={`${BUTTON_BASE} bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover`}
        onClick={props.onAnswer}
        disabled={props.answering || props.ending}
        title={`Answer the latest question (${shownKeyLabel('answer', mac)})`}
      >
        Answer <KeyChip hotkey="answer" onPrimary />
      </button>
      <button
        type="button"
        className={BUTTON}
        onClick={props.onScreenshot}
        disabled={props.capturing || props.ending}
        title={`Answer from a screenshot (${shownKeyLabel('screenshot', mac)})`}
      >
        {props.capturing ? 'Screenshot…' : 'Screenshot'} <KeyChip hotkey="screenshot" />
      </button>
      <button
        type="button"
        className={BUTTON}
        onClick={props.onChat}
        disabled={props.ending}
        // ADR-0082: Ctrl+Shift+Space is the voice question now, so this button names no key.
        title="Type a question"
      >
        Chat
      </button>
      {props.recording && props.onRecordCommand && (
        <TopBarRecord
          recording={props.recording}
          onCommand={props.onRecordCommand}
          mac={mac}
          disabled={props.ending}
        />
      )}
      <span
        className="px-1.5 font-mono text-[14px] tabular-nums text-ui-text"
        aria-label="Call time"
        role="timer"
      >
        {callClock(elapsed)}
      </span>
      <span className="min-w-1 flex-1" />
      <button
        type="button"
        className={BUTTON}
        onClick={props.onBack}
        title="Back to the compact overlay (Esc)"
      >
        Back to compact
      </button>
      <Menu label={<MenuIcon />} ariaLabel="More" variant="ghost" items={props.menu} />
      <button
        type="button"
        className={`${BUTTON_BASE} bg-ui-end text-ui-on-end hover:opacity-90`}
        onClick={props.onEnd}
        disabled={props.ending}
      >
        {props.ending ? 'Ending…' : 'End'}
      </button>
    </div>
  );
}
