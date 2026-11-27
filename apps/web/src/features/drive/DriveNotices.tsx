/**
 * File: apps/web/src/features/drive/DriveNotices.tsx
 * Purpose: The in-app Google Drive notice (ADR-0072), at the bottom of the window: "Reconnect Google
 *          Drive" when uploads wait because Google refused the connection (queued uploads continue after
 *          reconnecting). ADR-0131: there is no "saved" notice of any kind any more (no banner here, no
 *          system notification): the user may still be sharing the screen after a call, so each session's
 *          status line says it quietly instead (DriveSessionStatus.tsx: "Saved to Drive ✓"). Nothing shows
 *          on a live call page.
 *          1.6.1: in the desktop launcher they sit in the page above "Your sessions" (placement
 *          'inline'), never over its bottom bar; and a closed reconnect notice stays closed for the
 *          app run (core/storage/driveNoticePrefs.ts), as each session card says it too.
 * Used by: app/(app)/layout.tsx, src/features/home/HomePanel.tsx, src/features/home/Launcher.tsx
 * Depends on: src/core/storage (driveNoticePrefs), src/platform,
 *             src/features/drive/useDrive.ts, src/ui/Button.tsx
 * Architecture: ADR-0072
 */
'use client';

import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { closeReconnectNotice, reconnectNoticeClosed } from '@/core/storage/driveNoticePrefs';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { useDriveJobs } from './useDrive';

/**
 * Nothing to subscribe to: only this component closes the notice, and it holds that in state too.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/** Props for DriveNotices. */
export interface DriveNoticesProps {
  /**
   * 'overlay' (default): floating at the bottom of the window, over the page. 'inline': in the page's
   * own flow where it is placed (the desktop launcher, whose bottom bar must never be covered).
   */
  placement?: 'overlay' | 'inline';
}

/**
 * The reconnect notice.
 *
 * @param props See DriveNoticesProps.
 * @returns The notice, or nothing.
 * Rendered by: app/(app)/layout.tsx, HomePanel.tsx (classic panel), Launcher.tsx (inline)
 */
export function DriveNotices({ placement = 'overlay' }: DriveNoticesProps) {
  const jobs = useDriveJobs();
  const onCallPage = (usePathname() ?? '').startsWith('/live/');
  // Closed earlier in this app run (server render: yes, so it never flashes before the browser has
  // read it), or just now.
  const closedBefore = useSyncExternalStore(subscribeNever, reconnectNoticeClosed, () => true);
  const [closedNow, setClosedNow] = useState(false);
  const reconnectClosed = closedBefore || closedNow;
  const needsReconnect = [...jobs.values()].some(
    (job) => job.state === 'waiting' && job.reason === 'reconnect',
  );

  // Never over a call: the live page (and the desktop's call window) shows no notices.
  if (onCallPage) return null;
  if (!needsReconnect || reconnectClosed) return null;
  return (
    <div
      className={
        placement === 'inline'
          ? 'flex flex-col gap-2'
          : 'pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4'
      }
    >
      <Notice
        // ADR-0074: an admin reconnects the company account in Settings.
        text="Google Drive needs an admin to reconnect it. Your calls are kept and will upload afterwards."
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => getPlatform().openDriveSetup('/settings#google-drive')}
          >
            Settings
          </Button>
        }
        onClose={() => {
          closeReconnectNotice();
          setClosedNow(true);
        }}
        inline={placement === 'inline'}
      />
    </div>
  );
}

/**
 * A notice's frame.
 *
 * @param props.text    Its words.
 * @param props.action  Its button or link.
 * @param props.onClose Closes it.
 * @param props.inline  True in the page's flow: the full width, no floating shadow.
 * @returns The notice.
 */
function Notice({
  text,
  action,
  onClose,
  inline,
}: {
  /** Its words. */
  text: string;
  /** Its button or link. */
  action: ReactNode;
  /** Closes it. */
  onClose: () => void;
  /** True in the page's flow. */
  inline: boolean;
}) {
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-full items-center justify-between gap-3 border border-ui-border bg-ui-surface p-3 text-[13px] text-ui-text ${
        inline ? 'rounded-[14px]' : 'max-w-[520px] rounded-control shadow-card'
      }`}
    >
      <p className="min-w-0">{text}</p>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
