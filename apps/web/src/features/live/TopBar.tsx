/**
 * File: apps/web/src/features/live/TopBar.tsx
 * Purpose: The live view's action bar: Answer · Chat · Screenshot (Day 5) · Clear · End, each
 *          with its keyboard shortcut in the tooltip.
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session), §7.3 (hotkeys);
 *               day-04-answers.md Stage 6
 */
'use client';

import { FOCUSED_HOTKEYS, hotkeyLabel } from '@kite/shared';
import { Button } from '@/ui/Button';

/** Props for TopBar. */
export interface TopBarProps {
  /** True on macOS (shortcuts use ⌘ instead of Ctrl). */
  mac: boolean;
  /** True while the chat box is open. */
  chatOpen: boolean;
  /** True while an answer is streaming (Clear then cancels it). */
  answering: boolean;
  /** True while End waits for the last line. */
  ending: boolean;
  /** Answer the latest question. */
  onAnswer: () => void;
  /** Take a screenshot and answer from it. */
  onScreenshot: () => void;
  /** True while a screenshot is being taken. */
  capturing: boolean;
  /** Open or close the chat box. */
  onToggleChat: () => void;
  /** Cancel the answer streaming, or hide the one shown. */
  onClear: () => void;
  /** End the call. */
  onEnd: () => void;
  /** Open the compact view (Day 5). */
  onCompact: () => void;
}

/**
 * A keyboard shortcut hint inside a button: mono, smaller, hidden from screen readers (the
 * button's title says the shortcut), so the button's name stays its label.
 *
 * @param props.children The keys, for example "Ctrl+↵".
 * @returns The hint.
 * Rendered by: TopBar
 */
function Hint({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="text-[13px] font-medium opacity-75">
      {children}
    </span>
  );
}

/**
 * The live view's action bar.
 *
 * @param props See TopBarProps.
 * @returns The bar.
 * Rendered by: LiveAnswers.tsx
 */
export function TopBar(props: TopBarProps) {
  const mod = props.mac ? '⌘' : 'Ctrl+';
  return (
    <div role="toolbar" aria-label="Call actions" className="flex flex-wrap items-center gap-2">
      <Button onClick={props.onAnswer} title={`Answer the latest question (${mod}Enter)`}>
        Answer
        <Hint>{props.mac ? '⌘↵' : 'Ctrl+↵'}</Hint>
      </Button>
      <Button
        variant="secondary"
        onClick={props.onToggleChat}
        aria-pressed={props.chatOpen}
        title={`Type a question (${hotkeyLabel(FOCUSED_HOTKEYS.chat, props.mac)})`}
      >
        Chat
        <Hint>{hotkeyLabel(FOCUSED_HOTKEYS.chat, props.mac)}</Hint>
      </Button>
      <Button
        variant="secondary"
        onClick={props.onScreenshot}
        disabled={props.capturing}
        title={`Answer from a screenshot of your screen (${mod}${props.mac ? '⇧' : 'Shift+'}Enter)`}
      >
        {props.capturing ? 'Taking screenshot…' : 'Screenshot'}
        <Hint>{props.mac ? '⌘⇧↵' : 'Ctrl+Shift+↵'}</Hint>
      </Button>
      <Button
        variant="secondary"
        onClick={props.onClear}
        title={`${props.answering ? 'Stop the answer' : 'Clear the answer'} (${mod}Backspace)`}
      >
        Clear
        <Hint>{props.mac ? '⌘⌫' : 'Ctrl+⌫'}</Hint>
      </Button>
      <Button
        variant="secondary"
        onClick={props.onCompact}
        title="A small window that stays on top of the meeting"
      >
        Overlay
      </Button>
      <span className="flex-1" />
      <Button variant="danger" onClick={props.onEnd} disabled={props.ending}>
        {props.ending ? 'Ending…' : 'End'}
      </Button>
    </div>
  );
}
