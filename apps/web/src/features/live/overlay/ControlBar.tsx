/**
 * File: apps/web/src/features/live/overlay/ControlBar.tsx
 * Purpose: Bar 1 of the call bars (spec S13): the screen-audio and microphone icons, each with its ▾;
 *          desktop 1.5.0 (ADR-0068): the Rec pill after them, where the app can record (ADR-0118: the
 *          Transcript pill that sat between them is gone; bar 2's level and expand buttons and Ctrl+Alt+T open
 *          and close the full transcript); 1.6.3 (ADR-0075): the Auto answer toggle (labelled "AA" since 24 Nov
 *          2026); ADR-0082: the Click-through toggle (as Ctrl+Alt+X; labelled "W"), where clicks can pass; ADR-0094: the model chip (Fast / Smart / Fastest) next to
 *          Auto, which opens the model choice (ADR-0095's Voice toggle after it was removed by ADR-0123: the
 *          user's own questions are answered on Ctrl+Enter / Ctrl+Shift+Space); then move and compact, the call
 *          timer, ⋮ and Exit
 *          (red; web 9 Nov 2026: one press ends the call). ADR-0082: no Answer or Screenshot buttons (their
 *          shortcuts still work). ADR-0122: Chat is back, first in the part that gives way, with its shortcut
 *          (Ctrl+Alt+K) as a key-cap; it opens the chat bar under this bar. The bar is the window's drag handle;
 *          its buttons opt out. ADR-0055 (amended 26 Nov 2026): while the whole overlay passes clicks
 *          (Click-through on), the part that gives way shows only "Click-through on — press Ctrl+Alt+X to turn off".
 *
 *          1.6.3 (ADR-0075): ⋮ and Exit are pinned on the right and never leave the window. ADR-0085: the
 *          device icons and, while recording, the Rec pill are
 *          pinned on the left the same way: never hidden, never cut. When the bar has too little room, the
 *          rest gives way one step at a time, measured rather than guessed: first Rec's key-cap, then the
 *          Click-through pill (it becomes a square "W") and the timer's clock, then the
 *          Auto answer pill (it becomes a square "AA"), the model chip's word (ADR-0094)
 *          and the word "Chat" (ADR-0122); after that
 *          things go: the move icon (the whole bar drags), the Click-through toggle (⋮ and Ctrl+Alt+X still
 *          turn it on), and the timer last (only a picture-in-picture window is that narrow). Every control names itself and its shortcut in BarTooltip.tsx ("Click-through: Off ·
 *          Ctrl+Alt+X"). ADR-0113: the bar keeps its natural width (it no longer stretches to the window),
 *          so resizing the answer panel never makes it give way; only a window narrower than the bar does.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys), lucide-react, react-dom (flushSync), src/core/live/liveChannel.ts,
 *             ./parts.tsx, ./RecordControls.tsx, ./BarTooltip.tsx, ./clickThroughHint.ts, src/features/live/callClock.ts,
 *             src/ui/icons.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S13); ADR-0041, ADR-0045, ADR-0075
 */
'use client';

import { hotkeyAccelerator, hotkeyLabel } from '@kite/shared';
import { Clock } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { callClock } from '@/features/live/callClock';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import {
  ChatIcon,
  ChevronDownIcon,
  CollapseIcon,
  ExpandIcon,
  MenuIcon,
  MicIcon,
  MonitorIcon,
  MoveIcon,
} from '@/ui/icons';
import { BarTooltip } from './BarTooltip';
import { clickThroughHint } from './clickThroughHint';
import { ModelChip, modelOf } from './ModelChoice';
import {
  BUTTON_BASE,
  CHEVRON_BUTTON,
  ICON_BUTTON,
  KeyChip,
  ownResizeObserver,
  PILL,
  StatusIcon,
  tipShortcut,
} from './parts';
import { RecPill } from './RecordControls';
import { usePrivateOffWhileRecording } from '../PrivateOffWarning';

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
  /**
   * The ⋮ button: Esc gives it the focus back. (ADR-0105: a press on it while a menu is open closes that menu,
   * like any press outside it; data-popup-button only marks the buttons that open one.)
   */
  menuButton: RefObject<HTMLButtonElement | null>;
  /**
   * ADR-0082: turns Click-through on or off from its toggle on this bar (v1.3.2 to 1.6.3 an indicator showed
   * only while it was on). Absent where clicks cannot pass (a browser, an older shell): no toggle then.
   * ADR-0055 (amended 26 Nov 2026): once on, the whole overlay passes clicks (passAll), so only the shortcut
   * turns it off; the toggle can still turn it off while another app holds that shortcut.
   */
  onClickThrough?: (on: boolean) => void;
  /** Desktop 1.5.0 (ADR-0068): whether the Rec pill's popover is open. */
  recordOpen?: boolean;
  /** Desktop 1.5.0: opens or closes the Rec pill's popover. */
  onRecord?: () => void;
  /** Desktop 1.5.0: the Rec pill (its popover sits under it). */
  recButton?: RefObject<HTMLButtonElement | null>;
  /** 1.6.3: true on the overlay's bottom row (ADR-0056): tooltips open above the bar, not below. */
  up?: boolean;
  /** ADR-0094: whether the model chip's popover is open. */
  modelOpen?: boolean;
  /**
   * ADR-0094: opens or closes the model chip's popover. Absent, or a live page that does not say its model:
   * no chip.
   */
  onModel?: () => void;
  /** ADR-0094: the model chip (its popover sits under it). */
  modelButton?: RefObject<HTMLButtonElement | null>;
  /**
   * ADR-0122: opens or closes the chat bar under this bar (as Ctrl+Alt+K does during a call). Absent: no Chat
   * button.
   */
  onChat?: () => void;
  /** ADR-0122: whether the chat bar is open (the Chat button shows it). */
  chatOpen?: boolean;
  /**
   * ADR-0055 (amended 26 Nov 2026): true while the whole overlay passes clicks (Click-through on, its shortcut
   * free): the part that gives way shows only a hint that takes no clicks, with the shortcut that turns it off.
   */
  passAll?: boolean;
}

/**
 * 1.6.3 (ADR-0075): how far bar 1 has given way to fit its window, 0 (everything) to FIT_MOST. Each
 * step hides what the one before did, and more.
 */
const FIT = {
  /** From here: no key-cap on the Rec pill (ADR-0122: nor on Chat). */
  noRecKey: 1,
  /** From here: Click-through's "W" pill gives way to a square; no clock icon (ADR-0118: no Transcript word any more). */
  noWords: 2,
  /** From here: Auto answer's "AA" pill is a square, the model chip its icon (ADR-0094) and Chat its icon (ADR-0122). */
  iconAuto: 3,
  /** From here: no move icon (the whole bar still drags the window). */
  noMove: 4,
  /** ADR-0085: from here no Click-through toggle on the bar (⋮ and Ctrl+Alt+X still turn it on). */
  noClickThrough: 5,
  /** From here: no call timer (a narrow picture-in-picture window only). */
  noTimer: 6,
} as const;

/** The last step. */
const FIT_MOST = FIT.noTimer;

/**
 * A control's name with its shortcut, for its tooltip: "Answer · Ctrl+Enter" (1.6.3, ADR-0075).
 *
 * @param name   The control's name.
 * @param hotkey The shortcut's accelerator, if it has one.
 * @param mac    True on macOS.
 * @returns The tooltip's words.
 * Called from: ControlBar
 */
function tipText(name: string, hotkey: string | undefined, mac: boolean): string {
  return hotkey ? `${name} · ${tipShortcut(hotkey, mac)}` : name;
}

/** Ctrl+Shift+Arrows: the six positions (ADR-0056; ADR-0095 moved them from Ctrl+Alt+Arrows). */
const POSITION_ACCELERATOR = 'CommandOrControl+Shift+Arrows';

/**
 * ADR-0122: Chat on bar 1, with its shortcut (Ctrl+Alt+K; ⌘⌥K on a Mac) as a key-cap: opens or closes the chat
 * bar under bar 1 ("Enter a message…", Send, ×). It gives way like the others: first its key-cap, then its
 * word (the icon stays). A click gives the keyboard back to the meeting (data-releases-focus): only a click into
 * the chat bar's box takes it.
 *
 * @param props.open     True while the chat bar is open.
 * @param props.disabled True before the live page answers, or once the call ended.
 * @param props.keyCap   False to leave out the key-cap.
 * @param props.word     False to show the icon only.
 * @param props.mac      True on macOS (the shortcut's name).
 * @param props.onToggle Opens or closes the chat bar.
 * @returns The button.
 * Rendered by: ControlBar
 */
function ChatButton({
  open,
  disabled,
  keyCap,
  word,
  mac,
  onToggle,
}: {
  /** True while the chat bar is open. */
  open: boolean;
  /** True before the live page answers, or once the call ended. */
  disabled: boolean;
  /** False to leave out the key-cap. */
  keyCap: boolean;
  /** False to show the icon only. */
  word: boolean;
  /** True on macOS (the shortcut's name). */
  mac: boolean;
  /** Opens or closes the chat bar. */
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Chat"
      aria-expanded={open}
      aria-keyshortcuts={hotkeyLabel(hotkeyAccelerator('ask-kite', mac), mac)}
      data-tip={tipText(
        open ? 'Close chat' : 'Chat: type a question',
        hotkeyAccelerator('ask-kite', mac),
        mac,
      )}
      data-chat-button=""
      data-releases-focus=""
      className={`${word ? `${PILL} gap-1.5` : ICON_BUTTON} ${open ? 'text-ui-text ring-1 ring-inset ring-ui-accent-fill' : ''}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <ChatIcon />
      {word && 'Chat'}
      {word && keyCap && <KeyChip hotkey="ask-kite" />}
    </button>
  );
}

/** The short label the Auto answer toggle shows in place of a bolt (its full name is in the tooltip). */
const AUTO_ANSWER_LABEL = 'AA';

/**
 * 1.6.3 (ADR-0075): Auto answer on bar 1 (it had a floating pill of its own): green when on, muted when
 * off. Same command as before. Since 24 Nov 2026 it shows the short label "AA" instead of a bolt and the
 * word "Auto"; the full name "Auto answer" stays in its aria-label and tooltip, so screen readers and the
 * hover tip still say what it is.
 *
 * @param props.on       True while auto answer is on.
 * @param props.disabled True before the live page answers.
 * @param props.wide     True for the pill with the dot beside the label; false for the square button with
 *                       the dot in its corner (when the bar has given way).
 * @param props.onToggle Turns it on or off.
 * @returns The toggle.
 * Rendered by: ControlBar
 */
function AutoAnswerToggle({
  on,
  disabled,
  wide,
  onToggle,
}: {
  /** True while auto answer is on. */
  on: boolean;
  /** True before the live page answers. */
  disabled: boolean;
  /** True for the pill shape (dot beside the label); false for the square (dot in the corner). */
  wide: boolean;
  /** Turns it on or off. */
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Auto answer"
      data-tip={`Auto answer: ${on ? 'On' : 'Off'}`}
      data-auto-answer={on ? 'on' : 'off'}
      className={`${wide ? `${PILL} gap-1.5` : `${ICON_BUTTON} relative`} ${on ? 'text-ui-text ring-1 ring-inset ring-ui-indicator' : 'text-ui-muted'}`}
      onClick={onToggle}
      disabled={disabled}
    >
      {/* Hidden from screen readers: they read the aria-label "Auto answer", not "AA". Green when on, as the
          bolt was. */}
      <span aria-hidden="true" className={`inline-flex ${on ? 'text-ui-indicator' : ''}`}>
        {AUTO_ANSWER_LABEL}
      </span>
      {/* Beside the label; in the corner of the square toggle, so it stays as wide as the others. */}
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${wide ? '' : 'absolute right-1 top-1'} ${on ? 'bg-ui-indicator' : 'bg-ui-muted opacity-60'}`}
      />
    </button>
  );
}

/**
 * Ctrl+Alt+X: Click-through on or off (v1.3.2); ⌃⌥X on a Mac since 1.8.1.
 *
 * @param mac True on a Mac.
 * @returns The accelerator.
 */
const CLICK_THROUGH_ACCELERATOR = (mac: boolean) => hotkeyAccelerator('click-through', mac);

/** The short label the Click-through toggle shows in place of a pointer (its full name is in the tooltip). */
const CLICK_THROUGH_LABEL = 'W';

/**
 * ADR-0082: Click-through on bar 1, as Ctrl+Alt+X and the ⋮ menu, with a dot that is lit while it is on.
 * ADR-0055 (amended 26 Nov 2026): while on, every click on the whole overlay goes to the app behind it, this
 * toggle's spot too (bar 1 then shows ClickThroughHint in its place); only while another app holds the
 * shortcut do the bars keep their clicks, so this toggle can turn it off. Since 24 Nov 2026 it shows the short label "W" instead
 * of a pointer and the word "Click-through"; the full name stays in its aria-label and tooltip.
 *
 * @param props.on       True while Click-through is on.
 * @param props.disabled True before the live page answers.
 * @param props.wide     True for the pill with the dot beside the label; false for the square button with
 *                       the dot in its corner (when the bar has given way).
 * @param props.mac      True on macOS (the shortcut's name).
 * @param props.onToggle Turns it on or off.
 * @returns The toggle.
 * Rendered by: ControlBar
 */
function ClickThroughToggle({
  on,
  disabled,
  wide,
  mac,
  onToggle,
}: {
  /** True while Click-through is on. */
  on: boolean;
  /** True before the live page answers. */
  disabled: boolean;
  /** True for the pill shape (dot beside the label); false for the square (dot in the corner). */
  wide: boolean;
  /** True on macOS (the shortcut's name). */
  mac: boolean;
  /** Turns it on or off. */
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Click-through"
      aria-keyshortcuts={hotkeyLabel(CLICK_THROUGH_ACCELERATOR(mac), mac)}
      data-tip={tipText(
        on
          ? 'Click-through: On (clicks go to the app behind)'
          : 'Click-through: Off (turn on to click the app behind the overlay)',
        CLICK_THROUGH_ACCELERATOR(mac),
        mac,
      )}
      data-click-through={on ? 'on' : 'off'}
      className={`${wide ? `${PILL} gap-1.5` : `${ICON_BUTTON} relative`} ${on ? 'text-ui-text ring-1 ring-inset ring-ui-accent-fill' : 'text-ui-muted'}`}
      onClick={onToggle}
      disabled={disabled}
    >
      {/* Hidden from screen readers: they read the aria-label "Click-through", not "W". Accent-coloured
          when on, as the pointer was. */}
      <span aria-hidden="true" className={`inline-flex ${on ? 'text-ui-accent' : ''}`}>
        {CLICK_THROUGH_LABEL}
      </span>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${wide ? '' : 'absolute right-1 top-1'} ${on ? 'bg-ui-accent-fill' : 'bg-ui-muted opacity-60'}`}
      />
    </button>
  );
}

/**
 * ADR-0055 (amended 26 Nov 2026), safety net (a): bar 1's hint while the whole overlay passes clicks. It is text,
 * not a button (nothing on the overlay can be pressed then), and it says the one key that turns the mode off.
 * It is cut with "…" rather than pushing the pinned controls out when the bar is narrow.
 *
 * @param props.mac True on macOS (⌘ ⌥ X instead of Ctrl+Alt+X).
 * @returns The hint.
 * Rendered by: ControlBar
 */
function ClickThroughHint({
  mac,
}: {
  /** True on macOS. */
  mac: boolean;
}) {
  return (
    <p
      role="status"
      data-click-through-hint=""
      className="min-w-0 truncate rounded-control px-2 text-[13px] font-medium text-ui-accent"
    >
      {clickThroughHint(mac)}
    </p>
  );
}

/**
 * The call's time so far, short ("0:33").
 *
 * @param props.startedAt When the call connected (Unix ms).
 * @param props.clock     False to leave out the clock icon.
 * @returns The pill.
 * Rendered by: ControlBar
 */
function CallTimer({
  startedAt,
  clock,
}: {
  /** When the call connected (Unix ms). */
  startedAt: number | undefined;
  /** False to leave out the clock icon. */
  clock: boolean;
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
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control bg-ui-overlay-button px-2 text-[13px] font-medium tabular-nums"
    >
      {clock && <Clock aria-hidden="true" size={14} />}
      {callClock(seconds)}
    </span>
  );
}

/**
 * Exit: one press ends the call and closes the overlay (web 9 Nov 2026, the developer's choice: it asked "End
 * call?" first before).
 *
 * @param props.disabled True before the live page answers, or once the call ended.
 * @param props.onEnd    Ends the call.
 * @returns The button.
 * Rendered by: ControlBar
 */
function ExitButton({
  disabled,
  onEnd,
}: {
  /** True before the live page answers, or once the call ended. */
  disabled: boolean;
  /** Ends the call. */
  onEnd: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Exit: end call"
      data-tip="Exit: end the call"
      className={`${BUTTON_BASE} bg-ui-end text-ui-on-end hover:opacity-90`}
      disabled={disabled}
      onClick={onEnd}
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
        data-tip={chooser}
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
 * 1.6.3 (ADR-0075): how far bar 1 gives way, measured. ADR-0113: bar 1 is as wide as everything it shows,
 * up to the window's width, so it gives way only when the window is narrower than that (never because the
 * answer panel was resized); a change in the window's width starts again from everything shown. Steps up while the left side's content is wider
 * than its room (in the layout effect, so before anything is painted); starts again from everything
 * shown when the room or the content changes for any other reason (a resized window, the Rec pill
 * starting, the timer reaching 10:00).
 *
 * @param key What changes the content's width on a re-render (the Rec pill, Auto, Click-through…).
 * @returns The step (0 to FIT_MOST), and the refs for the left side's box (its room) and its content.
 * Called from: ControlBar
 */
function useFitStep(key: string): {
  /** How far the bar gives way. */
  step: number;
  /** The left side's box. */
  room: RefObject<HTMLDivElement | null>;
  /** The left side's content. */
  content: RefObject<HTMLDivElement | null>;
} {
  const room = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  // Bumped by the observer to measure again even when the step is already 0.
  const [pass, setPass] = useState(0);
  // A new key starts from everything shown (while rendering, as React advises for state that follows a
  // changed value).
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setStep(0);
  }
  // The widths at the last step that fitted, so the observer can ignore the changes the steps make.
  // ADR-0113: and the page's width then (the bars are only as wide as they need, so a wider window no
  // longer widens the room by itself: a new page width starts again from everything shown).
  const fitted = useRef({ content: -1, room: -1, page: -1 });

  // After each new step, key or pass (a re-render that changes the content's width otherwise changes
  // the key or is seen by the observer below). A layout effect, so the steps happen before anything is
  // painted.
  useLayoutEffect(() => {
    const roomBox = room.current;
    const contentBox = content.current;
    if (!roomBox || !contentBox) return;
    // The step the content was drawn at (data-fit-step), read from the page like its width.
    const drawnAt = Number(contentBox.dataset.fitStep ?? 0);
    if (contentBox.offsetWidth <= roomBox.clientWidth || drawnAt >= FIT_MOST) {
      fitted.current = {
        content: contentBox.offsetWidth,
        room: roomBox.clientWidth,
        page: roomBox.ownerDocument.documentElement.clientWidth,
      };
      return;
    }
    // Measured from the page, as CompactView's heights are: one more step, then measured again.
    setStep(drawnAt + 1);
  }, [step, pass, seenKey]);

  useEffect(() => {
    const roomBox = room.current;
    const contentBox = content.current;
    // jsdom (unit tests) has no ResizeObserver: the bar then shows everything. ADR-0107: the observer of
    // the bar's own window (one from the opener never reports elements of the picture-in-picture window).
    const Observer = roomBox ? ownResizeObserver(roomBox) : undefined;
    if (!roomBox || !contentBox || !Observer) return;
    const page = roomBox.ownerDocument.documentElement;
    const observer = new Observer(() => {
      const was = fitted.current;
      if (
        contentBox.offsetWidth === was.content &&
        roomBox.clientWidth === was.room &&
        page.clientWidth === was.page
      ) {
        return;
      }
      // Synchronously, so the bar never paints a frame cut off (observers run before paint).
      flushSync(() => {
        setStep(0);
        setPass((count) => count + 1);
      });
    });
    observer.observe(roomBox);
    observer.observe(contentBox);
    // ADR-0113: the window's width (the page's root follows it).
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  return { step, room, content };
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
  // 1.5.2 (ADR-0070): a screen recording with Private off. 1.6.3: the Rec pill shows only an amber dot
  // for it; the words are on the warning bar.
  const privateOff = usePrivateOffWhileRecording(state?.recording);
  const { deviceList, onDeviceList } = props;
  const ended = !state || state.ended;
  const autoOn = state?.autoAnswer ?? false;
  const recording = state?.recording && props.onRecord ? state.recording : null;
  const clickThroughOn = (state?.clickThrough ?? false) && props.onClickThrough !== undefined;
  // ADR-0094: the model chip, when the live page says its model.
  const modelChoice = props.onModel ? modelOf(state) : null;

  const bar = useRef<HTMLDivElement>(null);
  // What changes the left side's width on a re-render; a change starts the fitting again.
  const fitKey = [
    recording?.state ?? 'none',
    privateOff.visible,
    autoOn,
    clickThroughOn,
    props.onClickThrough !== undefined,
    collapsed,
    onIcon !== undefined,
    state?.capturing ?? false,
    // ADR-0094: "Smart" is wider than "Fast".
    modelChoice?.model ?? 'no-model',
    // ADR-0122: the Chat button appearing or going.
    props.onChat ? 'chat' : 'no-chat',
    // ADR-0055 (amended 26 Nov 2026): the hint replaces the part that gives way.
    props.passAll ? 'pass-all' : 'bars',
  ].join('|');
  const { step, room, content } = useFitStep(fitKey);
  const recKey = step < FIT.noRecKey;
  const words = step < FIT.noWords;

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Overlay controls"
      className="relative flex h-11 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:drag]"
    >
      {/* ADR-0085: pinned on the left, always whole: what is captured (ADR-0118: no Transcript switch), and the
          recording while it runs. */}
      <div data-bar-pinned="" className="flex shrink-0 items-center gap-1">
        <span className="inline-flex shrink-0 items-center">
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

        {recording && props.onRecord && (
          // Desktop 1.5.0 (ADR-0068): after the device icons (ADR-0118: the Transcript pill is gone).
          <RecPill
            recording={recording}
            open={props.recordOpen ?? false}
            onToggle={props.onRecord}
            disabled={ended}
            mac={mac}
            buttonRef={props.recButton}
            visibleInRecording={privateOff.visible}
            showKey={recKey}
            pageTip
          />
        )}
      </div>
      {/* 1.6.3: the rest may give way; it never pushes the pinned controls out of the window. Full height,
          so the focus rings are not clipped. */}
      <div ref={room} className="flex min-w-0 flex-1 items-center self-stretch overflow-hidden">
        {props.passAll && <ClickThroughHint mac={mac} />}
        <div
          ref={content}
          data-fit-step={step}
          data-fit-key={fitKey}
          className="flex shrink-0 items-center gap-1 pr-0.5"
        >
          {/* ADR-0055 (amended 26 Nov 2026): none of these can be pressed while the whole overlay passes
              clicks, so the hint stands in for them (the content box stays, empty, for the fitting). */}
          {!props.passAll && props.onChat && (
            // ADR-0122: first in the part that gives way, so the pinned controls never leave the window.
            <ChatButton
              open={props.chatOpen ?? false}
              disabled={ended}
              keyCap={recKey}
              word={step < FIT.iconAuto}
              mac={mac}
              onToggle={props.onChat}
            />
          )}
          {!props.passAll && (
            <AutoAnswerToggle
              on={autoOn}
              disabled={!state}
              wide={step < FIT.iconAuto}
              onToggle={() => onCommand({ type: 'auto-answer', on: !autoOn })}
            />
          )}
          {!props.passAll && modelChoice && props.onModel && (
            // ADR-0094: next to Auto; it gives way to its icon with Auto, and never pushes the pinned
            // controls out (it is inside the part that gives way).
            <ModelChip
              model={modelChoice.model}
              word={step < FIT.iconAuto}
              open={props.modelOpen ?? false}
              disabled={ended}
              buttonRef={props.modelButton}
              onToggle={props.onModel}
            />
          )}
          {!props.passAll && props.onClickThrough && step < FIT.noClickThrough && (
            <ClickThroughToggle
              on={clickThroughOn}
              disabled={!state}
              wide={words}
              mac={mac}
              onToggle={() => props.onClickThrough?.(!clickThroughOn)}
            />
          )}
        </div>
      </div>

      {/* 1.6.3: pinned on the right, always whole. */}
      <div className="flex shrink-0 items-center gap-1">
        {step < FIT.noMove && (
          // The whole bar drags the window; this is where people look for it.
          <span
            role="img"
            aria-label="Drag here to move"
            data-tip={tipText('Drag to move', POSITION_ACCELERATOR, mac)}
            className="inline-flex h-8 w-8 shrink-0 cursor-move items-center justify-center rounded-control bg-ui-overlay-button"
          >
            <MoveIcon />
          </span>
        )}
        {onIcon ? (
          <>
            {collapsed && (
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label="Open the overlay"
                data-tip="Open the overlay"
                onClick={() => props.onCollapse(false)}
              >
                <ExpandIcon />
              </button>
            )}
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label="Shrink to an icon"
              data-tip="Shrink to an icon"
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
            data-tip={collapsed ? 'Open the overlay' : 'Collapse the overlay'}
            aria-pressed={collapsed}
            onClick={() => props.onCollapse(!collapsed)}
          >
            {collapsed ? <ExpandIcon /> : <CollapseIcon />}
          </button>
        )}
        {step < FIT.noTimer && <CallTimer startedAt={state?.startedAt} clock={words} />}
        <button
          ref={menuButton}
          type="button"
          data-popup-button
          className={ICON_BUTTON}
          aria-label="Overlay menu"
          data-tip="Menu"
          aria-expanded={menuOpen}
          onClick={() => onMenu(!menuOpen)}
        >
          <MenuIcon />
        </button>
        <ExitButton disabled={ended} onEnd={() => onCommand({ type: 'end' })} />
      </div>

      {/* 1.6.3: one tooltip for the bar, above everything, inside the window. */}
      <BarTooltip bar={bar} up={props.up ?? false} />
    </div>
  );
}
