/**
 * File: apps/web/src/features/live/PrivateOffWarning.tsx
 * Purpose: Warns while a screen recording runs with Private off (1.5.2, ADR-0070): Paramount AI's windows then
 *          appear in the video. "Private is off: Paramount AI will appear in your recording" with one click
 *          to turn Private back on, in the overlay (a bar of its own, like the call notices) and in the full
 *          call window; and whether the Rec pill should say "Visible in recording".
 * Used by: src/features/live/CompactView.tsx (overlay), src/features/live/LivePage.tsx (call window),
 *          src/features/live/overlay/ControlBar.tsx and TopBar.tsx (the Rec pill's hint)
 * Depends on: src/features/privacy/usePrivate.ts (the shell's setting, kept in step across windows),
 *             src/core/live/liveChannel.ts (CompactRecording), src/ui/Button.tsx
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md (Private with recordings), ADR-0070
 */
'use client';

import type { CompactRecording } from '@/core/live/liveChannel';
import { usePrivate } from '@/features/privacy/usePrivate';
import { Button } from '@/ui/Button';

/** The warning's words. */
export const PRIVATE_OFF_TEXT = 'Private is off: Paramount AI will appear in your recording';

/** The button's words. */
export const PRIVATE_BACK_ON_TEXT = 'Turn Private back on';

/** The Rec pill's hint. */
export const VISIBLE_IN_RECORDING_TEXT = 'Visible in recording';

/**
 * Whether Paramount AI shows in the recording running now: a screen recording, on a computer where Private
 * can hide the windows, with Private off.
 *
 * @param recording The recording's state (absent outside the desktop app).
 * @param privateOn Whether Private is on, or null while unknown or not supported.
 * @returns True to warn.
 * Called from: usePrivateOffWhileRecording(); tests
 */
export function visibleInRecording(
  recording: Pick<CompactRecording, 'state' | 'kind'> | undefined | null,
  privateOn: boolean | null,
): boolean {
  return recording?.state === 'on' && recording.kind === 'screen' && privateOn === false;
}

/**
 * The warning's state for a window.
 *
 * @param recording The recording's state.
 * @returns Whether to warn, and turning Private back on.
 * Called from: CompactView.tsx, LivePage.tsx, ControlBar.tsx, TopBar.tsx
 */
export function usePrivateOffWhileRecording(
  recording: Pick<CompactRecording, 'state' | 'kind'> | undefined | null,
): { visible: boolean; turnOn: () => void } {
  const { state, change } = usePrivate();
  const privateOn = state?.supported ? state.on : null;
  return {
    visible: visibleInRecording(recording, privateOn),
    turnOn: () => void change(true),
  };
}

/** Props for PrivateOffWarning. */
export interface PrivateOffWarningProps {
  /** Turns Private back on. */
  onTurnOn: () => void;
  /** 'overlay': the dark bar style of the overlay's notices; 'window': a notice in the call window. */
  look: 'overlay' | 'window';
  /** Extra classes (the overlay passes its bar's width and piece style). */
  className?: string;
  /** The overlay's bar attribute (data-bars), so the bar takes clicks in Click-through mode. */
  barsAttribute?: string;
}

/**
 * The warning, with its one-click fix.
 *
 * @param props See PrivateOffWarningProps.
 * @returns The warning.
 * Rendered by: CompactView.tsx, LivePage.tsx
 */
export function PrivateOffWarning({
  onTurnOn,
  look,
  className = '',
  barsAttribute,
}: PrivateOffWarningProps) {
  if (look === 'overlay') {
    return (
      <div
        className={`flex shrink-0 items-center gap-2 px-3 py-1.5 text-[13px] ${className}`}
        data-private-off-warning=""
        {...(barsAttribute ? { [barsAttribute]: '' } : {})}
      >
        <span
          role="alert"
          className="min-w-0 flex-1 truncate text-ui-warning"
          title={PRIVATE_OFF_TEXT}
        >
          {PRIVATE_OFF_TEXT}
        </span>
        <button
          type="button"
          data-popup-button=""
          className="h-7 shrink-0 rounded-control bg-ui-overlay-button px-2 text-[13px] font-medium hover:bg-ui-overlay-button-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
          onClick={onTurnOn}
        >
          {PRIVATE_BACK_ON_TEXT}
        </button>
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-private-off-warning=""
      className={`flex flex-wrap items-center justify-between gap-3 rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text ${className}`}
    >
      <span>{PRIVATE_OFF_TEXT}</span>
      <Button size="sm" variant="secondary" onClick={onTurnOn}>
        {PRIVATE_BACK_ON_TEXT}
      </Button>
    </div>
  );
}
