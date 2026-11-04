/**
 * File: apps/web/src/features/live/TopBar.tsx
 * Purpose: The full call window's top bar (v1.0.4, ADR-0040): the same controls as the overlay's, on
 *          the solid dark tokens: the microphone, Answer, Screenshot and Chat with their keys, the
 *          call timer, Back to compact, the ⋮ menu (Script bar, Answer preferences, Clear answers,
 *          Reset overlay size and position, End call) and End.
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/ui (Menu, icons), @kite/shared (hotkeys), src/features/live/overlay/parts.tsx
 *             (shortKeys), src/features/live/callClock.ts, src/features/live/useCallDictation.ts
 *             (CallDictation)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); ADR-0040
 */
'use client';

import { DEFAULT_GLOBAL_HOTKEYS, hotkeyLabel, type TargetChoice } from '@kite/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { MenuIcon, MicIcon } from '@/ui/icons';
import { Menu, type MenuItem } from '@/ui/Menu';
import { callClock } from './callClock';
import { shortKeys } from './overlay/parts';
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
}

/** A button in the bar: its normal size and focus ring; the caller adds its colours. */
const BUTTON_BASE =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-control px-2.5 text-[13px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11';

/** A quiet button in the bar. */
const BUTTON = `${BUTTON_BASE} border border-ui-border bg-ui-surface text-ui-text hover:bg-ui-hover`;

/**
 * A shortcut on a button, hidden from screen readers (the title still says it).
 *
 * @param props.children The keys.
 * @returns The label.
 */
function Keys({
  children,
}: {
  /** The keys. */
  children: ReactNode;
}) {
  return (
    <kbd
      aria-hidden="true"
      className="whitespace-nowrap rounded-full bg-black/10 px-1.5 text-[12px] font-normal"
    >
      {children}
    </kbd>
  );
}

/**
 * The top bar.
 *
 * @param props See TopBarProps.
 * @returns The bar.
 * Rendered by: LiveAnswers.tsx
 */
export function TopBar(props: TopBarProps) {
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
        title={`Answer the latest question (${hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.answer, mac)})`}
      >
        Answer <Keys>{shortKeys(DEFAULT_GLOBAL_HOTKEYS.answer, mac)}</Keys>
      </button>
      <button
        type="button"
        className={BUTTON}
        onClick={props.onScreenshot}
        disabled={props.capturing || props.ending}
        title={`Answer from a screenshot (${hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)})`}
      >
        {props.capturing ? 'Screenshot…' : 'Screenshot'}{' '}
        <Keys>{shortKeys(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)}</Keys>
      </button>
      <button
        type="button"
        className={BUTTON}
        onClick={props.onChat}
        disabled={props.ending}
        title={`Type a question (${hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.chat, mac)})`}
      >
        Chat <Keys>{shortKeys(DEFAULT_GLOBAL_HOTKEYS.chat, mac)}</Keys>
      </button>
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
