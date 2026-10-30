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
      </Button>
      <Button
        variant="secondary"
        onClick={props.onToggleChat}
        aria-pressed={props.chatOpen}
        title="Type a question"
      >
        Chat
      </Button>
      <Button
        variant="secondary"
        onClick={props.onScreenshot}
        disabled={props.capturing}
        title={`Answer from a screenshot of your screen (${mod}${props.mac ? '⇧' : 'Shift+'}Enter)`}
      >
        {props.capturing ? 'Taking screenshot…' : 'Screenshot'}
      </Button>
      <Button
        variant="ghost"
        onClick={props.onClear}
        title={`${props.answering ? 'Stop the answer' : 'Clear the answer'} (${mod}Backspace)`}
      >
        Clear
      </Button>
      <Button
        variant="ghost"
        onClick={props.onCompact}
        title="A small window that stays on top of the meeting"
      >
        Compact view
      </Button>
      <span className="flex-1" />
      <Button variant="danger" onClick={props.onEnd} disabled={props.ending}>
        {props.ending ? 'Ending…' : 'End'}
      </Button>
    </div>
  );
}
