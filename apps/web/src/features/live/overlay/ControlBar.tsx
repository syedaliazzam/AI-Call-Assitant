/**
 * File: apps/web/src/features/live/overlay/ControlBar.tsx
 * Purpose: Bar 1 of the call bars (spec S13): the screen-audio and microphone icons, each with its ▾;
 *          Answer, Screenshot and Chat with their key-caps; the Transcript pill with its on/off switch
 *          (ADR-0055: it opens and closes the transcript panel, as the live words do); desktop 1.5.0
 *          (ADR-0068): the Rec pill after the Transcript pill, where the app can record; 1.6.3 (ADR-0075):
 *          the Auto answer toggle; then move and compact, the call timer, ⋮ and Exit (red; web 9 Nov 2026:
 *          one press ends the call). The bar is the window's drag handle; its buttons opt out.
 *
 *          1.6.3 (ADR-0075): ⋮ and Exit are pinned on the right and never leave the window. When the bar
 *          has too little room, the left side gives way one step at a time, measured rather than guessed
 *          (the Rec pill, Auto answer and Click-through change its width): first the key-caps (Rec's,
 *          then Screenshot's and Chat's, then Answer's), then the words "Transcript" and "Click-through
 *          on" and the timer's clock, then Answer, Screenshot and Chat become icons, then the word
 *          "Auto"; only then do things go: the Transcript pill (the live words and Ctrl+Alt+T open the
 *          transcript too), the move icon (the whole bar drags), and the timer last (only a
 *          picture-in-picture window is that narrow). A button shown as an icon names itself
 *          and its shortcut in a tooltip drawn in the page (a browser's title tooltip is a separate window
 *          that Private may not hide, ADR-0042).
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys), lucide-react, react-dom (flushSync), src/core/live/liveChannel.ts,
 *             ./parts.tsx, ./RecordControls.tsx, src/features/live/callClock.ts, src/ui/icons.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S13); ADR-0041, ADR-0045, ADR-0075
 */
'use client';

import { DEFAULT_GLOBAL_HOTKEYS, hotkeyLabel } from '@kite/shared';
import { Camera, Clock, ScrollText } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { callClock } from '@/features/live/callClock';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import {
  BoltIcon,
  ChatIcon,
  ChevronDownIcon,
  CollapseIcon,
  ExpandIcon,
  MenuIcon,
  MicIcon,
  MonitorIcon,
  MoveIcon,
  SparkIcon,
} from '@/ui/icons';
import { BUTTON_BASE, CHEVRON_BUTTON, ICON_BUTTON, KeyChip, PILL, StatusIcon } from './parts';
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
  /** Whether the chat bar is open. */
  chatOpen: boolean;
  /** Opens or closes the chat bar. */
  onChatOpen: (open: boolean) => void;
  /** The ⋮ button: a click on it is not a click outside the menu. */
  menuButton: RefObject<HTMLButtonElement | null>;
  /**
   * The reference app's bar 1 (ADR-0055, accounts with account sync): with the Transcript pill.
   * Otherwise the classic bar.
   */
  referenceLook?: boolean;
  /** Whether the transcript panel is open (the Transcript pill's switch). */
  transcriptOpen?: boolean;
  /** Opens or closes the transcript panel (remembered with the panels). */
  onTranscript?: (open: boolean) => void;
  /**
   * v1.3.2: turns Click-through off from the "Click-through on" indicator, shown while it is on (the bars
   * still take clicks, so the mouse can always turn it off).
   */
  onClickThroughOff?: () => void;
  /** Desktop 1.5.0 (ADR-0068): whether the Rec pill's popover is open. */
  recordOpen?: boolean;
  /** Desktop 1.5.0: opens or closes the Rec pill's popover. */
  onRecord?: () => void;
  /** Desktop 1.5.0: the Rec pill (its popover sits under it). */
  recButton?: RefObject<HTMLButtonElement | null>;
  /** 1.6.3: true on the overlay's bottom row (ADR-0056): tooltips open above the bar, not below. */
  up?: boolean;
}

/**
 * 1.6.3 (ADR-0075): how far bar 1 has given way to fit its window, 0 (everything) to FIT_MOST. Each
 * step hides what the one before did, and more.
 */
const FIT = {
  /** From here: no key-cap on the Rec pill. */
  noRecKey: 1,
  /** From here: no key-caps on Screenshot and Chat either. */
  noShotChatKeys: 2,
  /** From here: no key-cap on Answer either. */
  noKeys: 3,
  /** From here: the Transcript pill's word and "Click-through on" give way to icons; no clock icon. */
  noWords: 4,
  /** From here: Answer, Screenshot and Chat are icons. */
  iconPills: 5,
  /** From here: Auto answer is its bolt only. */
  iconAuto: 6,
  /** From here: no Transcript pill (the live words' level button and Ctrl+Alt+T open the transcript). */
  noTranscript: 7,
  /** From here: no move icon (the whole bar still drags the window). */
  noMove: 8,
  /** From here: no call timer (a narrow picture-in-picture window only). */
  noTimer: 9,
} as const;

/** The last step. */
const FIT_MOST = FIT.noTimer;

/**
 * A button's name with its shortcut, for its tooltip: "Answer (Ctrl+↵)".
 *
 * @param name   The button's name.
 * @param hotkey The shortcut's accelerator, if it has one.
 * @param mac    True on macOS.
 * @returns The tooltip's words.
 * Called from: ControlBar
 */
function tipText(name: string, hotkey: string | undefined, mac: boolean): string {
  return hotkey ? `${name} (${hotkeyLabel(hotkey, mac)})` : name;
}

/**
 * The Transcript pill (ADR-0055): the word and a small switch inside; on opens the transcript panel,
 * off closes it. When the bar is short of room the word gives way to an icon.
 *
 * @param props.open     True while the transcript panel is open.
 * @param props.disabled True before the live page answers, or once the call ended.
 * @param props.word     False to show the icon instead of the word.
 * @param props.onToggle Opens or closes the panel.
 * @returns The pill.
 * Rendered by: ControlBar
 */
function TranscriptPill({
  open,
  disabled,
  word,
  onToggle,
}: {
  /** True while the transcript panel is open. */
  open: boolean;
  /** True before the live page answers, or once the call ended. */
  disabled: boolean;
  /** False to show the icon instead of the word. */
  word: boolean;
  /** Opens or closes the panel. */
  onToggle: (open: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      aria-label="Transcript"
      data-tip={`Transcript: ${open ? 'On' : 'Off'}`}
      className={`${PILL} gap-2`}
      onClick={() => onToggle(!open)}
      disabled={disabled}
    >
      {word ? 'Transcript' : <ScrollText aria-hidden="true" size={16} />}
      <span
        aria-hidden="true"
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-(--k-dur) ${open ? 'bg-ui-accent-fill' : 'bg-ui-control-strong'}`}
      >
        <span
          className={`absolute left-0.5 size-3 rounded-full bg-white transition-transform duration-(--k-dur) ${open ? 'translate-x-3' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );
}

/**
 * 1.6.3 (ADR-0075): Auto answer on bar 1 (it had a floating pill of its own): a bolt and "Auto", green
 * when on, muted when off. Same command as before.
 *
 * @param props.on       True while auto answer is on.
 * @param props.disabled True before the live page answers.
 * @param props.word     False to show the bolt only.
 * @param props.onToggle Turns it on or off.
 * @returns The toggle.
 * Rendered by: ControlBar
 */
function AutoAnswerToggle({
  on,
  disabled,
  word,
  onToggle,
}: {
  /** True while auto answer is on. */
  on: boolean;
  /** True before the live page answers. */
  disabled: boolean;
  /** False to show the bolt only. */
  word: boolean;
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
      className={`${word ? `${PILL} gap-1.5` : `${ICON_BUTTON} relative`} ${on ? 'text-ui-text ring-1 ring-inset ring-ui-indicator' : 'text-ui-muted'}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span aria-hidden="true" className={`inline-flex ${on ? 'text-ui-indicator' : ''}`}>
        <BoltIcon size={15} />
      </span>
      {word && 'Auto'}
      {/* Beside the word; in the corner of the icon-only toggle, so it stays as wide as the others. */}
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${word ? '' : 'absolute right-1 top-1'} ${on ? 'bg-ui-indicator' : 'bg-ui-muted opacity-60'}`}
      />
    </button>
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
      data-tip="End the call"
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

/** A tooltip: its words, and the middle of the button it names (px from the bar's left edge). */
interface Tip {
  /** The words. */
  text: string;
  /** The button's middle, from the bar's left edge. */
  x: number;
}

/** How long the pointer rests on a button before its tooltip shows, in ms. */
const TIP_DELAY_MS = 300;

/**
 * 1.6.3 (ADR-0075): how far bar 1 gives way, measured. Steps up while the left side's content is wider
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
  const fitted = useRef({ content: -1, room: -1 });

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
      fitted.current = { content: contentBox.offsetWidth, room: roomBox.clientWidth };
      return;
    }
    // Measured from the page, as CompactView's heights are: one more step, then measured again.
    setStep(drawnAt + 1);
  }, [step, pass, seenKey]);

  useEffect(() => {
    const roomBox = room.current;
    const contentBox = content.current;
    // jsdom (unit tests) has no ResizeObserver: the bar then shows everything.
    if (!roomBox || !contentBox || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const was = fitted.current;
      if (contentBox.offsetWidth === was.content && roomBox.clientWidth === was.room) return;
      // Synchronously, so the bar never paints a frame cut off (observers run before paint).
      flushSync(() => {
        setStep(0);
        setPass((count) => count + 1);
      });
    });
    observer.observe(roomBox);
    observer.observe(contentBox);
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
  const clickThroughOn = (state?.clickThrough ?? false) && props.onClickThroughOff !== undefined;

  const bar = useRef<HTMLDivElement>(null);
  // What changes the left side's width on a re-render; a change starts the fitting again.
  const fitKey = [
    recording?.state ?? 'none',
    privateOff.visible,
    autoOn,
    clickThroughOn,
    props.onTranscript !== undefined,
    collapsed,
    onIcon !== undefined,
    state?.capturing ?? false,
  ].join('|');
  const { step, room, content } = useFitStep(fitKey);
  const recKey = step < FIT.noRecKey;
  const shotChatKeys = step < FIT.noShotChatKeys;
  const keys = step < FIT.noKeys;
  const words = step < FIT.noWords;
  const pillWords = step < FIT.iconPills;

  // The tooltip (drawn in the page; ADR-0042). One for the whole bar: the button under the pointer or
  // with the keyboard focus names itself.
  const [tip, setTip] = useState<Tip | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipElement = useRef<HTMLSpanElement>(null);
  const [tipLeft, setTipLeft] = useState(0);
  useEffect(
    () => () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    [],
  );
  /**
   * Shows the tooltip of the button an event is on, now or after the pointer rests.
   *
   * @param target What the event is on.
   * @param delay  How long to wait first, in ms.
   */
  const showTip = (target: EventTarget, delay: number) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    const named = target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;
    const barBox = bar.current;
    if (!named || !barBox || !barBox.contains(named)) {
      setTip(null);
      return;
    }
    tipTimer.current = setTimeout(() => {
      const box = named.getBoundingClientRect();
      const barLeft = barBox.getBoundingClientRect().left;
      setTip({ text: named.dataset.tip ?? '', x: box.left + box.width / 2 - barLeft });
    }, delay);
  };
  /** Hides the tooltip. */
  const hideTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    setTip(null);
  };
  // Centred under (or above) its button, but inside the bar.
  useLayoutEffect(() => {
    if (!tip || !tipElement.current || !bar.current) return;
    const width = tipElement.current.offsetWidth;
    const barWidth = bar.current.clientWidth;
    setTipLeft(Math.max(4, Math.min(tip.x - width / 2, barWidth - width - 4)));
  }, [tip]);

  const answerKey = DEFAULT_GLOBAL_HOTKEYS.answer;
  const shotKey = DEFAULT_GLOBAL_HOTKEYS.screenshot;
  const chatKey = DEFAULT_GLOBAL_HOTKEYS.chat;
  const shotName = state?.capturing ? 'Screenshot…' : 'Screenshot';

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Overlay controls"
      className="relative flex h-11 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:drag]"
      onPointerOver={(event: PointerEvent) => showTip(event.target, TIP_DELAY_MS)}
      onPointerLeave={hideTip}
      onPointerDown={hideTip}
      onFocus={(event: FocusEvent) => {
        // Only for the keyboard: a click focuses its button too, and the pointer has its own delay.
        if (event.target instanceof Element && event.target.matches(':focus-visible')) {
          showTip(event.target, 0);
        }
      }}
      onBlur={hideTip}
    >
      {/* 1.6.3: the left side may give way; it never pushes ⋮ and Exit out of the window. Full height,
          so the focus rings are not clipped. */}
      <div ref={room} className="flex min-w-0 flex-1 items-center self-stretch overflow-hidden">
        <div
          ref={content}
          data-fit-step={step}
          data-fit-key={fitKey}
          className="flex shrink-0 items-center gap-1 pr-0.5"
        >
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
          {pillWords && <span className="w-1 shrink-0" />}

          <button
            type="button"
            className={pillWords ? PILL : ICON_BUTTON}
            onClick={() => onCommand({ type: 'answer' })}
            disabled={ended}
            aria-label="Answer"
            aria-keyshortcuts={hotkeyLabel(answerKey, mac)}
            data-tip={tipText('Answer', answerKey, mac)}
          >
            {pillWords ? 'Answer' : <SparkIcon />}
            {keys && <KeyChip hotkey="answer" />}
          </button>
          <button
            type="button"
            className={pillWords ? PILL : ICON_BUTTON}
            onClick={() => onCommand({ type: 'screenshot' })}
            disabled={ended || state.capturing}
            aria-label={shotName}
            aria-keyshortcuts={hotkeyLabel(shotKey, mac)}
            data-tip={tipText(shotName, shotKey, mac)}
          >
            {pillWords ? shotName : <Camera aria-hidden="true" size={16} strokeWidth={1.75} />}
            {shotChatKeys && <KeyChip hotkey="screenshot" />}
          </button>
          <button
            type="button"
            className={pillWords ? PILL : ICON_BUTTON}
            aria-pressed={props.chatOpen}
            onClick={() => {
              if (collapsed) props.onCollapse(false);
              props.onChatOpen(!props.chatOpen);
            }}
            disabled={ended}
            aria-label="Chat"
            aria-keyshortcuts={hotkeyLabel(chatKey, mac)}
            data-tip={tipText('Chat', chatKey, mac)}
          >
            {pillWords ? 'Chat' : <ChatIcon />}
            {shotChatKeys && <KeyChip hotkey="chat" />}
          </button>
          {props.onTranscript && step < FIT.noTranscript && (
            <TranscriptPill
              open={props.transcriptOpen ?? false}
              disabled={ended}
              word={words}
              onToggle={(open) => {
                if (collapsed) props.onCollapse(false);
                props.onTranscript?.(open);
              }}
            />
          )}
          {recording && props.onRecord && (
            // Desktop 1.5.0 (ADR-0068): after the Transcript pill, in the same style.
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
          <AutoAnswerToggle
            on={autoOn}
            disabled={!state}
            word={step < FIT.iconAuto}
            onToggle={() => onCommand({ type: 'auto-answer', on: !autoOn })}
          />
        </div>
      </div>

      {/* 1.6.3: pinned on the right, always whole. */}
      <div className="flex shrink-0 items-center gap-1">
        {step < FIT.noMove && (
          // The whole bar drags the window; this is where people look for it.
          <span
            role="img"
            aria-label="Drag here to move"
            data-tip="Drag to move"
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
        {clickThroughOn && (
          // v1.3.2: says that clicks outside the bars go to the app behind; a click turns it off.
          <button
            type="button"
            onClick={props.onClickThroughOff}
            aria-label="Click-through on. Turn off"
            aria-keyshortcuts={hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS['click-through'], mac)}
            data-tip={tipText(
              'Click-through on: turn off',
              DEFAULT_GLOBAL_HOTKEYS['click-through'],
              mac,
            )}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-ui-border px-2 text-[12px] font-medium text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-ui-accent-fill" />
            {words && 'Click-through on'}
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

      {tip && (
        <span
          ref={tipElement}
          role="tooltip"
          data-bar-tip=""
          className="k-overlay-menu pointer-events-none absolute z-40 whitespace-nowrap rounded-control border border-ui-border px-2 py-1 text-[12px] font-medium text-ui-text shadow-modal"
          style={
            props.up
              ? { left: tipLeft, bottom: 'calc(100% + 4px)' }
              : { left: tipLeft, top: 'calc(100% + 4px)' }
          }
        >
          {tip.text}
        </span>
      )}
    </div>
  );
}
