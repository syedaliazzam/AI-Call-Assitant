/**
 * File: apps/web/src/features/live/overlay/ControlBar.tsx
 * Purpose: Bar 1 of the stacked overlay (v1.1.0, ADR-0041): screen-audio and microphone status with a
 *          device list; Answer, Screenshot and Chat with their keys; move, collapse and ⋮; and the
 *          call timer, which is also End (it says "End call" under the pointer and asks first). While
 *          Chat is open, its input takes the place of the three buttons. The bar is the window's drag
 *          handle; its buttons opt out.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys), src/core/live/liveChannel.ts, ./parts.tsx, ./ChatInput.tsx,
 *             src/ui/icons.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041
 */
'use client';

import { DEFAULT_GLOBAL_HOTKEYS, hotkeyLabel } from '@kite/shared';
import { useEffect, useState, type RefObject } from 'react';
import { callClock } from '@/features/live/callClock';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import {
  ChevronDownIcon,
  CollapseIcon,
  ExpandIcon,
  MenuIcon,
  MicIcon,
  MonitorIcon,
  MoveIcon,
} from '@/ui/icons';
import { ChatInput } from './ChatInput';
import { BUTTON, BUTTON_BASE, ICON_BUTTON, Keys, shortKeys, StatusIcon } from './parts';

/** Props for ControlBar. */
export interface ControlBarProps {
  /** What the live page shows (null until it answers). */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** True on macOS (for the key hints). */
  mac: boolean;
  /** True when the overlay is collapsed to this bar. */
  collapsed: boolean;
  /** Collapses the overlay, or opens it. */
  onCollapse: (collapsed: boolean) => void;
  /** Whether the menu is open. */
  menuOpen: boolean;
  /** Opens or closes the menu. */
  onMenu: (open: boolean) => void;
  /** Whether the device list is open. */
  devicesOpen: boolean;
  /** Opens or closes the device list. */
  onDevices: (open: boolean) => void;
  /** Whether Chat's input is open. */
  chatOpen: boolean;
  /** Opens or closes Chat's input. */
  onChatOpen: (open: boolean) => void;
  /** The buttons a click outside the menu must not treat as outside. */
  menuButton: RefObject<HTMLButtonElement | null>;
}

/**
 * The timer pill, which is also End: under the pointer or the keyboard it says "End call"; pressing it
 * asks first, in place, because ending a call by accident loses the call.
 *
 * @param props.startedAt When the call connected (Unix ms).
 * @param props.disabled  True before the live page answers, or once the call ended.
 * @param props.onEnd     Ends the call.
 * @returns The pill, or the question.
 * Rendered by: ControlBar
 */
function EndPill({
  startedAt,
  disabled,
  onEnd,
}: {
  /** When the call connected (Unix ms). */
  startedAt: number | undefined;
  /** True before the live page answers, or once the call ended. */
  disabled: boolean;
  /** Ends the call. */
  onEnd: () => void;
}) {
  // The clock is a state the interval advances (no setState in the effect body).
  const [now, setNow] = useState(() => Date.now());
  const [hover, setHover] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / 1_000));

  if (asking) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <button
          type="button"
          autoFocus
          className={`${BUTTON_BASE} bg-ui-end text-ui-on-end`}
          onClick={onEnd}
        >
          End call?
        </button>
        <button type="button" className={BUTTON} onClick={() => setAsking(false)}>
          Keep going
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label="End call"
      className={`${BUTTON_BASE} min-w-[4.25rem] bg-ui-end font-mono tabular-nums text-ui-on-end hover:opacity-90`}
      disabled={disabled}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onClick={() => setAsking(true)}
    >
      <span role="timer" aria-label="Call time" className={hover ? 'font-sans' : ''}>
        {hover ? 'End call' : callClock(seconds)}
      </span>
    </button>
  );
}

/**
 * Bar 1.
 *
 * @param props See ControlBarProps.
 * @returns The bar.
 * Rendered by: CompactView.tsx
 */
export function ControlBar(props: ControlBarProps) {
  const { state, onCommand, mac, collapsed, menuButton, menuOpen, onMenu } = props;
  const ended = !state || state.ended;
  return (
    <div
      role="toolbar"
      aria-label="Overlay controls"
      className="relative flex h-12 shrink-0 items-center gap-1 px-2 [-webkit-app-region:drag]"
    >
      <StatusIcon on={state?.audio.them ?? false} label="Screen audio" icon={<MonitorIcon />} />
      <StatusIcon on={state?.audio.you ?? false} label="Microphone" icon={<MicIcon />} />
      <button
        type="button"
        className={`${BUTTON_BASE} w-6 px-0 text-ui-muted hover:bg-ui-overlay-button`}
        aria-label="Choose microphone and audio source"
        aria-expanded={props.devicesOpen}
        onClick={() => props.onDevices(!props.devicesOpen)}
      >
        <ChevronDownIcon size={14} />
      </button>

      {props.chatOpen ? (
        <ChatInput state={state} onCommand={onCommand} onClose={() => props.onChatOpen(false)} />
      ) : (
        <>
          <button
            type="button"
            className={`${BUTTON_BASE} bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover`}
            onClick={() => onCommand({ type: 'answer' })}
            disabled={ended}
            aria-keyshortcuts={hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.answer, mac)}
          >
            Answer <Keys>{shortKeys(DEFAULT_GLOBAL_HOTKEYS.answer, mac)}</Keys>
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => onCommand({ type: 'screenshot' })}
            disabled={ended || state.capturing}
            aria-keyshortcuts={hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)}
          >
            {state?.capturing ? 'Screenshot…' : 'Screenshot'}{' '}
            <Keys>{shortKeys(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)}</Keys>
          </button>
          <button
            type="button"
            className={BUTTON}
            aria-pressed={props.chatOpen}
            onClick={() => {
              if (collapsed) props.onCollapse(false);
              props.onChatOpen(true);
            }}
            disabled={ended}
            aria-keyshortcuts={hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.chat, mac)}
          >
            Chat <Keys>{shortKeys(DEFAULT_GLOBAL_HOTKEYS.chat, mac)}</Keys>
          </button>
          <span className="min-w-1 flex-1" />
        </>
      )}

      {/* The whole bar drags the window; this is where people look for it. */}
      <span
        role="img"
        aria-label="Drag here to move"
        className="hidden h-8 w-7 shrink-0 cursor-move items-center justify-center text-ui-muted @min-[620px]:inline-flex"
      >
        <MoveIcon />
      </span>
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={collapsed ? 'Open the overlay' : 'Collapse the overlay'}
        aria-pressed={collapsed}
        onClick={() => props.onCollapse(!collapsed)}
      >
        {collapsed ? <ExpandIcon /> : <CollapseIcon />}
      </button>
      <button
        ref={menuButton}
        type="button"
        className={ICON_BUTTON}
        aria-label="Overlay menu"
        aria-expanded={menuOpen}
        onClick={() => onMenu(!menuOpen)}
      >
        <MenuIcon />
      </button>
      <EndPill
        startedAt={state?.startedAt}
        disabled={ended}
        onEnd={() => onCommand({ type: 'end' })}
      />
    </div>
  );
}
