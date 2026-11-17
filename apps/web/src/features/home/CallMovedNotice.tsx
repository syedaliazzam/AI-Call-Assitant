/**
 * File: apps/web/src/features/home/CallMovedNotice.tsx
 * Purpose: "This call was moved to another device" on the desktop app's small window (ADR-0098), after
 *          another device of the account took over the call this computer was running. The call ended
 *          here cleanly (as at End: transcript, notes and recording saved).
 * Used by: src/features/home/Launcher.tsx
 * Depends on: src/ui/Button.tsx
 * Architecture: docs/decisions/ADR-0098-live-call-lock.md
 */
'use client';

import { Button } from '@/ui/Button';

/** The notice's sentence (also shown on the browser's Connect view). */
export const CALL_MOVED_TEXT = 'This call was moved to another device.';

/**
 * The notice.
 * @param props.onClose Closes it.
 * @returns The notice.
 * Rendered by: Launcher.tsx
 */
export function CallMovedNotice({
  onClose,
}: {
  /** Closes it. */
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      className="mx-3 mb-2 flex shrink-0 items-center justify-between gap-3 rounded-control border border-ui-border bg-ui-surface p-3 text-[13px] text-ui-text"
    >
      <p>{CALL_MOVED_TEXT}</p>
      <Button size="sm" variant="ghost" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
