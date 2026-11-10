/**
 * File: apps/web/src/features/home/RecordingSavedNotice.tsx
 * Purpose: "Recording saved · Open in Meetings" on the desktop app's small window after a call that
 *          recorded (desktop 1.5.0, ADR-0068). Open in Meetings opens the Meetings page of the dashboard
 *          in the browser (ADR-0051), where Open in desktop app plays it here.
 * Used by: src/features/home/Launcher.tsx
 * Depends on: src/features/sync/dashboardLink.ts, src/ui/Button.tsx
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 */
'use client';

import { openDashboard } from '@/features/sync/dashboardLink';
import { Button } from '@/ui/Button';

/**
 * The notice.
 * @param props.onClose Closes it.
 * @returns The notice.
 * Rendered by: Launcher.tsx
 */
export function RecordingSavedNotice({
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
      <p>Recording saved on this computer.</p>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            openDashboard('/meetings');
            onClose();
          }}
        >
          Open in Meetings
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
