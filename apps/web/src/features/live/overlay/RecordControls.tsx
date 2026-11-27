/**
 * File: apps/web/src/features/live/overlay/RecordControls.tsx
 * Purpose: The meeting recording's controls on the call bars (desktop 1.5.0, ADR-0068): the Rec pill
 *          (after the Transcript pill, same style, with its key-cap Ctrl Alt R): grey "○ Rec" when off,
 *          a red pulsing "● Rec mm:ss" while recording (the time takes the key-cap's place; 1.6.3, ADR-0075:
 *          with Private off only a small amber dot, the words are on the warning bar); and its popover: "Everyone has agreed to be
 *          recorded?" with Start recording (and a display picker when there are several), or "Stop
 *          recording?" with Stop; or a short notice (Private turned on, low space, a stop). The same
 *          parts serve the overlay and the full call window's top bar.
 * Used by: src/features/live/overlay/ControlBar.tsx, src/features/live/CompactView.tsx,
 *          src/features/live/TopBar.tsx
 * Depends on: @kite/shared (hotkeys), src/core/live/liveChannel.ts, src/features/live/callClock.ts,
 *             ./parts.tsx
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 */
'use client';

import { hotkeyLabel } from '@kite/shared';
import { forwardRef, useEffect, useState, type CSSProperties, type Ref } from 'react';
import type { CompactCommand, CompactRecording } from '@/core/live/liveChannel';
import { callClock } from '@/features/live/callClock';
import { shownAccelerator, useHeldHotkeys } from '@/ui/shownKeys';
import { KeyChip, PILL, tipShortcut } from './parts';
import { VISIBLE_IN_RECORDING_TEXT } from '../PrivateOffWarning';

/** What the popover shows: the Start or Stop question, or the notice. */
export type RecordPopoverMode = 'question' | 'notice';

/** The words of a recording type. */
export const RECORDING_TYPE_WORDS = { screen: 'Screen + audio', audio: 'Audio only' } as const;

/** Shown in the Start question when the session does not save its transcript. */
export const NO_STEREO_WARNING =
  'Save transcript is off: the recording is kept, the separate sound for re-transcription is not.';

/**
 * The time recorded so far, ticking once a second.
 * @param startedAt When the part started (Unix ms), or null.
 * @returns "m:ss", or '' when not recording.
 */
function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? '' : callClock(Math.max(0, Math.floor((now - startedAt) / 1_000)));
}

/** Props for RecPill. */
export interface RecPillProps {
  /** The recording's state. */
  recording: CompactRecording;
  /** True while its popover is open. */
  open: boolean;
  /** Opens or closes the popover. */
  onToggle: () => void;
  /** True once the call has ended (or before the live page answers). */
  disabled: boolean;
  /** True on macOS (the shortcut's spoken name). */
  mac: boolean;
  /** The container width from which the key-cap shows, as a Tailwind class. */
  keyAt?: string;
  /** 1.6.3 (ADR-0075): false to leave out the key-cap (bar 1 measures its room); default true. */
  showKey?: boolean;
  /**
   * 1.6.3: true on bar 1, which draws its own tooltips in the page (data-tip, ADR-0042); otherwise the
   * browser's title tooltip.
   */
  pageTip?: boolean;
  /** The button (the popover sits under it). */
  buttonRef?: Ref<HTMLButtonElement>;
  /**
   * 1.5.2 (ADR-0070): a screen recording runs with Private off, so Paramount AI is in the video. 1.6.3
   * (ADR-0075): the pill shows a small amber dot and says it to screen readers; the warning bar has the
   * words and the fix.
   */
  visibleInRecording?: boolean;
}

/**
 * ADR-0082: what a press on the Rec pill does. With "Everyone on the call has agreed to be recorded" ticked
 * at Connect for this call, a press while off starts recording at once (the ⋮ menu's type, the picked
 * display); otherwise it opens the Start or Stop question as before. Ctrl+Alt+R always asks.
 *
 * @param recording The recording's state.
 * @param onCommand Sends a command to the live page.
 * @param ask       Opens (or closes) the question.
 * Called from: CompactView.tsx, TopBar.tsx; tests
 */
export function pressRecPill(
  recording: Pick<CompactRecording, 'state' | 'consented' | 'kind' | 'displayId'>,
  onCommand: (command: CompactCommand) => void,
  ask: () => void,
): void {
  if (recording.state === 'off' && recording.consented === true) {
    onCommand({
      type: 'record-start',
      displayId: recording.kind === 'screen' ? recording.displayId : null,
    });
    return;
  }
  ask();
}

/**
 * The Rec pill.
 * @param props See RecPillProps.
 * @returns The button.
 * Rendered by: ControlBar.tsx, TopBar.tsx
 */
export function RecPill({
  recording,
  open,
  onToggle,
  disabled,
  mac,
  keyAt,
  buttonRef,
  visibleInRecording = false,
  showKey = true,
  pageTip = false,
}: RecPillProps) {
  const elapsed = useElapsed(recording.state === 'on' ? recording.startedAt : null);
  // ADR-0128: re-render once the desktop app reports the keys it holds.
  useHeldHotkeys();
  const on = recording.state === 'on';
  const busy = recording.state === 'starting' || recording.state === 'stopping';
  const label =
    recording.state === 'starting'
      ? 'Starting…'
      : recording.state === 'stopping'
        ? 'Saving…'
        : on
          ? `Rec ${elapsed}`
          : 'Rec';
  return (
    <button
      ref={buttonRef}
      type="button"
      data-popup-button
      className={`${PILL} gap-1.5 tabular-nums ${on ? 'text-ui-danger' : ''}`}
      onClick={onToggle}
      disabled={disabled || busy}
      aria-expanded={open}
      aria-label={
        on
          ? `Recording, ${elapsed}${visibleInRecording ? `, ${VISIBLE_IN_RECORDING_TEXT}` : ''}. Stop recording`
          : 'Start recording'
      }
      aria-keyshortcuts={hotkeyLabel(shownAccelerator('record', mac), mac)}
      {...(pageTip
        ? // 1.6.3 (ADR-0075): bar 1's tooltip, "Stop recording · Ctrl+Alt+R".
          {
            'data-tip': `${on ? 'Stop recording' : 'Start recording'} · ${tipShortcut(shownAccelerator('record', mac), mac)}`,
          }
        : {
            title: `${on ? 'Stop recording' : 'Start recording'} (${hotkeyLabel(shownAccelerator('record', mac), mac)})`,
          })}
    >
      <span
        aria-hidden="true"
        className={
          on
            ? 'size-2.5 rounded-full bg-ui-end motion-safe:animate-pulse'
            : 'size-2.5 rounded-full border-[1.5px] border-current opacity-70'
        }
      />
      {label}
      {on && visibleInRecording && (
        // 1.6.3 (ADR-0075): one warning only. The bar under bar 1 says it (with "Turn Private back on");
        // here a small amber dot, no words.
        <span
          aria-hidden="true"
          data-visible-in-recording=""
          className="size-1.5 shrink-0 rounded-full bg-ui-warning"
        />
      )}
      {/* While recording the pill shows the time instead: bar 1 has no room for both (measured). */}
      {!on && showKey && <KeyChip hotkey="record" {...(keyAt ? { visibleAt: keyAt } : {})} />}
    </button>
  );
}

/** Props for RecordPopover. */
export interface RecordPopoverProps {
  /** The recording's state. */
  recording: CompactRecording;
  /** The question, or the notice. */
  mode: RecordPopoverMode;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Closes the popover. */
  onClose: () => void;
  /** Where it sits (left edge under the pill, in px). */
  left: number;
  /** True to open above its anchor (the overlay's bottom row). */
  up?: boolean;
}

/** The popover's look (the overlay's menus). */
const POPOVER =
  'k-overlay-menu absolute z-30 flex w-80 flex-col gap-3 rounded-menu border border-ui-border p-3 text-[13px] text-ui-text shadow-modal [-webkit-app-region:no-drag]';

/** A button in the popover. */
const ACTION =
  'inline-flex h-8 items-center justify-center rounded-control px-3 text-[13px] font-semibold focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/**
 * The popover: the Start question, the Stop question, or a notice.
 * @param props See RecordPopoverProps.
 * @param ref   Its element (the overlay grows to fit it).
 * @returns The popover.
 * Rendered by: CompactView.tsx, TopBar.tsx
 */
export const RecordPopover = forwardRef<HTMLDivElement, RecordPopoverProps>(function RecordPopover(
  { recording, mode, onCommand, onClose, left, up = false },
  ref,
) {
  const [displayId, setDisplayId] = useState<string | null>(
    recording.displayId ?? recording.displays.find((d) => d.primary)?.id ?? null,
  );
  const style: CSSProperties = up
    ? { left, bottom: 'calc(100% + 6px)' }
    : { left, top: 'calc(100% + 6px)' };

  if (mode === 'notice') {
    return (
      <div ref={ref} role="status" className={POPOVER} style={style}>
        <p>{recording.notice}</p>
        <div className="flex justify-end">
          <button
            type="button"
            className={`${ACTION} bg-ui-overlay-button hover:bg-ui-overlay-button-hover`}
            onClick={() => {
              onCommand({ type: 'record-notice-seen' });
              onClose();
            }}
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  if (recording.state === 'on') {
    return (
      <div ref={ref} role="dialog" aria-label="Stop recording?" className={POPOVER} style={style}>
        <p className="font-semibold text-ui-heading">Stop recording?</p>
        <p className="text-ui-muted">
          What was recorded is saved on this computer. Starting again makes a new part of this
          meeting.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={`${ACTION} bg-ui-overlay-button hover:bg-ui-overlay-button-hover`}
            onClick={onClose}
          >
            Keep recording
          </button>
          <button
            type="button"
            className={`${ACTION} bg-ui-end text-ui-on-end hover:opacity-90`}
            onClick={() => {
              onCommand({ type: 'record-stop' });
              onClose();
            }}
          >
            Stop recording
          </button>
        </div>
      </div>
    );
  }

  const screen = recording.kind === 'screen';
  return (
    <div ref={ref} role="dialog" aria-label="Start recording" className={POPOVER} style={style}>
      <p className="font-semibold text-ui-heading">Everyone has agreed to be recorded?</p>
      <p className="text-ui-muted">
        {RECORDING_TYPE_WORDS[recording.kind]}, saved on this computer only. Recording without
        consent may be against the law where you or they are.
      </p>
      {screen && recording.displays.length > 1 && (
        <label className="flex items-center justify-between gap-2">
          <span>Screen</span>
          <select
            className="h-8 max-w-[12rem] rounded-control border border-ui-border bg-ui-bg px-2 text-[13px]"
            value={displayId ?? ''}
            onChange={(event) => setDisplayId(event.target.value || null)}
          >
            {recording.displays.map((display) => (
              <option key={display.id} value={display.id}>
                {display.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {!recording.stereo && <p className="text-ui-warning">{NO_STEREO_WARNING}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={`${ACTION} bg-ui-overlay-button hover:bg-ui-overlay-button-hover`}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${ACTION} bg-ui-end text-ui-on-end hover:opacity-90`}
          onClick={() => {
            onCommand({ type: 'record-start', displayId: screen ? displayId : null });
            onClose();
          }}
        >
          Start recording
        </button>
      </div>
    </div>
  );
});
