/**
 * File: apps/web/src/features/live/overlay/ControlBar.tsx
 * Purpose: Bar 1 of the call bars (spec S13): the screen-audio and microphone icons, each with its ▾;
 *          Answer, Screenshot and Chat with their key-caps; the Transcript pill with its on/off switch
 *          (ADR-0055: it opens and closes the transcript panel, as the live words do); move and compact;
 *          the call timer; ⋮; and Exit (red, asks first). The bar is the window's drag handle; its
 *          buttons opt out. In a narrow window the key-caps give way first, then the word "Transcript".
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys), lucide-react, src/core/live/liveChannel.ts, ./parts.tsx,
 *             src/features/live/callClock.ts, src/ui/icons.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S13); ADR-0041, ADR-0045
 */
'use client';

import { DEFAULT_GLOBAL_HOTKEYS, hotkeyLabel } from '@kite/shared';
import { Clock, ScrollText } from 'lucide-react';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
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
import {
  BUTTON,
  BUTTON_BASE,
  CHEVRON_BUTTON,
  ICON_BUTTON,
  KeyChip,
  PILL,
  StatusIcon,
} from './parts';

/** Which device list is open. */
export type DeviceList = 'audio' | 'mic';

/** Props for ControlBar. */
export interface ControlBarProps {
  /** What the live page shows (null until it answers). */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** True on macOS (for the shortcuts' spoken names). */
  mac: boolean;
  /** True when the overlay is collapsed to this bar. */
  collapsed: boolean;
  /** Collapses the overlay, or opens it. */
  onCollapse: (collapsed: boolean) => void;
  /** Shrinks to the icon, where this shell can (1.2.0); otherwise compact collapses to this bar. */
  onIcon?: (() => void) | undefined;
  /** Whether the menu is open. */
  menuOpen: boolean;
  /** Opens or closes the menu. */
  onMenu: (open: boolean) => void;
  /** Which device list is open, if any. */
  deviceList: DeviceList | null;
  /** Opens or closes a device list. */
  onDeviceList: (list: DeviceList | null) => void;
  /** Whether the chat bar is open. */
  chatOpen: boolean;
  /** Opens or closes the chat bar. */
  onChatOpen: (open: boolean) => void;
  /** The ⋮ button: a click on it is not a click outside the menu. */
  menuButton: RefObject<HTMLButtonElement | null>;
  /** Whether the transcript panel is open (the Transcript pill's switch). */
  transcriptOpen?: boolean;
  /** Opens or closes the transcript panel (remembered with the panels). */
  onTranscript?: (open: boolean) => void;
}

/**
 * The Transcript pill (ADR-0055): the word and a small switch inside; on opens the transcript panel,
 * off closes it. In a narrow window the word gives way to an icon.
 *
 * @param props.open     True while the transcript panel is open.
 * @param props.disabled True before the live page answers, or once the call ended.
 * @param props.onToggle Opens or closes the panel.
 * @returns The pill.
 * Rendered by: ControlBar
 */
function TranscriptPill({
  open,
  disabled,
  onToggle,
}: {
  /** True while the transcript panel is open. */
  open: boolean;
  /** True before the live page answers, or once the call ended. */
  disabled: boolean;
  /** Opens or closes the panel. */
  onToggle: (open: boolean) => void;
}) {
  return (
    // Below 520 px (a narrow picture-in-picture window) it gives way: the live words open the panel.
    <span className="hidden shrink-0 @min-[520px]:inline-flex">
      <button
        type="button"
        role="switch"
        aria-checked={open}
        aria-label="Transcript"
        className={`${PILL} gap-2`}
        onClick={() => onToggle(!open)}
        disabled={disabled}
      >
        <span className="hidden @min-[880px]:inline">Transcript</span>
        <ScrollText aria-hidden="true" size={16} className="@min-[880px]:hidden" />
        <span
          aria-hidden="true"
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-150 ${open ? 'bg-ui-accent-fill' : 'bg-ui-control-strong'}`}
        >
          <span
            className={`absolute left-0.5 size-3 rounded-full bg-white transition-transform duration-150 ${open ? 'translate-x-3' : 'translate-x-0'}`}
          />
        </span>
      </button>
    </span>
  );
}

/**
 * The call's time so far.
 *
 * @param props.startedAt When the call connected (Unix ms).
 * @returns The pill. It gives way first in a very narrow picture-in-picture window, then its icon.
 * Rendered by: ControlBar
 */
function CallTimer({
  startedAt,
}: {
  /** When the call connected (Unix ms). */
  startedAt: number | undefined;
}) {
  // The clock is a state the interval advances (no setState in the effect body).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / 1_000));
  return (
    <span
      role="timer"
      aria-label="Call time"
      className="hidden h-8 shrink-0 items-center gap-1.5 rounded-control bg-ui-overlay-button px-2 text-[13px] font-medium tabular-nums @min-[500px]:inline-flex"
    >
      <Clock aria-hidden="true" size={14} className="hidden @min-[620px]:inline" />
      {callClock(seconds)}
    </span>
  );
}

/**
 * Exit: pressing it asks first, in place, because ending a call by accident loses the call.
 *
 * @param props.disabled True before the live page answers, or once the call ended.
 * @param props.asking   True while it is asking.
 * @param props.onAsking Starts or stops asking.
 * @param props.onEnd    Ends the call.
 * @returns The button, or the question.
 * Rendered by: ControlBar
 */
function ExitButton({
  disabled,
  asking,
  onAsking,
  onEnd,
}: {
  /** True before the live page answers, or once the call ended. */
  disabled: boolean;
  /** True while it is asking. */
  asking: boolean;
  /** Starts or stops asking. */
  onAsking: (asking: boolean) => void;
  /** Ends the call. */
  onEnd: () => void;
}) {
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
        <button type="button" className={BUTTON} onClick={() => onAsking(false)}>
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label="Exit: end call"
      className={`${BUTTON_BASE} bg-ui-end text-ui-on-end hover:opacity-90`}
      disabled={disabled}
      onClick={() => onAsking(true)}
    >
      Exit
    </button>
  );
}

/**
 * One side's icon with a red dot while capturing, and the ▾ that opens its list.
 *
 * @param props.on       True while it is capturing.
 * @param props.label    Which side, for screen readers.
 * @param props.icon     Its icon.
 * @param props.chooser  The ▾ button's name.
 * @param props.open     True while its list is open.
 * @param props.onToggle Opens or closes its list.
 * @returns The icon and the ▾.
 * Rendered by: ControlBar
 */
function DeviceButton({
  on,
  label,
  icon,
  chooser,
  open,
  onToggle,
}: {
  /** True while it is capturing. */
  on: boolean;
  /** Which side, for screen readers. */
  label: string;
  /** Its icon. */
  icon: ReactNode;
  /** The ▾ button's name. */
  chooser: string;
  /** True while its list is open. */
  open: boolean;
  /** Opens or closes its list. */
  onToggle: () => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center">
      <StatusIcon on={on} label={label} icon={icon} />
      <button
        type="button"
        data-popup-button
        className={CHEVRON_BUTTON}
        aria-label={chooser}
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronDownIcon size={14} />
      </button>
    </span>
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
  const { state, onCommand, mac, collapsed, menuButton, menuOpen, onMenu, onIcon } = props;
  const { deviceList, onDeviceList } = props;
  const ended = !state || state.ended;
  // The question is wider than Exit: while it shows, the timer makes room, and in a narrow window the
  // audio icons too, so "Cancel" is never cut off.
  const [asking, setAsking] = useState(false);
  return (
    <div
      role="toolbar"
      aria-label="Overlay controls"
      className="relative flex h-11 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:drag]"
    >
      <span className={`inline-flex shrink-0 items-center ${asking ? '@max-[620px]:hidden' : ''}`}>
        <DeviceButton
          on={state?.audio.them ?? false}
          label="Screen audio"
          icon={<MonitorIcon />}
          chooser="Choose audio source"
          open={deviceList === 'audio'}
          onToggle={() => onDeviceList(deviceList === 'audio' ? null : 'audio')}
        />
        <DeviceButton
          on={state?.audio.you ?? false}
          label="Microphone"
          icon={<MicIcon />}
          chooser="Choose microphone"
          open={deviceList === 'mic'}
          onToggle={() => onDeviceList(deviceList === 'mic' ? null : 'mic')}
        />
      </span>
      <span className="w-1 shrink-0" />

      <button
        type="button"
        className={PILL}
        onClick={() => onCommand({ type: 'answer' })}
        disabled={ended}
        aria-keyshortcuts={hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.answer, mac)}
      >
        Answer <KeyChip hotkey="answer" visibleAt="@min-[700px]:inline-flex" />
      </button>
      <button
        type="button"
        className={PILL}
        onClick={() => onCommand({ type: 'screenshot' })}
        disabled={ended || state.capturing}
        aria-keyshortcuts={hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)}
      >
        {state?.capturing ? 'Screenshot…' : 'Screenshot'}{' '}
        <KeyChip hotkey="screenshot" visibleAt="@min-[820px]:inline-flex" />
      </button>
      <button
        type="button"
        className={PILL}
        aria-pressed={props.chatOpen}
        onClick={() => {
          if (collapsed) props.onCollapse(false);
          props.onChatOpen(!props.chatOpen);
        }}
        disabled={ended}
        aria-keyshortcuts={hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.chat, mac)}
      >
        Chat <KeyChip hotkey="chat" visibleAt="@min-[760px]:inline-flex" />
      </button>
      {props.onTranscript && (
        <TranscriptPill
          open={props.transcriptOpen ?? false}
          disabled={ended}
          onToggle={(open) => {
            if (collapsed) props.onCollapse(false);
            props.onTranscript?.(open);
          }}
        />
      )}
      <span className="min-w-1 flex-1" />

      {/* The whole bar drags the window; this is where people look for it. */}
      <span
        role="img"
        aria-label="Drag here to move"
        className="hidden h-8 w-8 shrink-0 cursor-move items-center justify-center rounded-control bg-ui-overlay-button @min-[620px]:inline-flex"
      >
        <MoveIcon />
      </span>
      {onIcon ? (
        <>
          {collapsed && (
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label="Open the overlay"
              onClick={() => props.onCollapse(false)}
            >
              <ExpandIcon />
            </button>
          )}
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label="Shrink to an icon"
            onClick={onIcon}
          >
            <CollapseIcon />
          </button>
        </>
      ) : (
        // A shell before 1.2.0 cannot make the window that small: compact collapses to this bar.
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={collapsed ? 'Open the overlay' : 'Collapse the overlay'}
          aria-pressed={collapsed}
          onClick={() => props.onCollapse(!collapsed)}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </button>
      )}
      {!asking && <CallTimer startedAt={state?.startedAt} />}
      <button
        ref={menuButton}
        type="button"
        data-popup-button
        className={ICON_BUTTON}
        aria-label="Overlay menu"
        aria-expanded={menuOpen}
        onClick={() => onMenu(!menuOpen)}
      >
        <MenuIcon />
      </button>
      <ExitButton
        disabled={ended}
        asking={asking}
        onAsking={setAsking}
        onEnd={() => onCommand({ type: 'end' })}
      />
    </div>
  );
}
