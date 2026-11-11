/**
 * File: apps/web/src/features/drive/DriveNotices.tsx
 * Purpose: The in-app Google Drive notices (ADR-0072), at the bottom of the window: "Recording and
 *          transcript saved — <session>" with "Open in Drive ↗" once a session's uploads finish on this
 *          device (shown once), and "Reconnect Google Drive" when uploads wait because Google refused the
 *          connection (queued uploads continue after reconnecting). The desktop app also shows a native
 *          notification for the first (core/drive/runner.ts). Nothing shows on a live call page.
 * Used by: app/(app)/layout.tsx, app/home/page.tsx
 * Depends on: @kite/shared (savedHeadline, driveFolderUrl), src/core/drive/names.ts,
 *             src/core/storage (sessions, driveUploads), src/platform, src/features/drive/useDrive.ts,
 *             src/ui/Button.tsx
 * Architecture: ADR-0072
 */
'use client';

import { driveFolderUrl, savedHeadline } from '@kite/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { sessionTitle } from '@/core/drive/names';
import { markDriveNoticeShown } from '@/core/storage/driveUploads';
import { getSession } from '@/core/storage/sessions';
import type { DriveSessionJob } from '@/core/storage/types';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { useDriveJobs } from './useDrive';

/**
 * The notices.
 *
 * @returns The notices, or nothing.
 * Rendered by: app/(app)/layout.tsx, app/home/page.tsx
 */
export function DriveNotices() {
  const jobs = useDriveJobs();
  const onCallPage = (usePathname() ?? '').startsWith('/live/');
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [reconnectClosed, setReconnectClosed] = useState(false);
  const finished = [...jobs.values()].filter(
    (job) => job.state === 'done' && !job.noticeShown && job.folderId,
  );
  const needsReconnect = [...jobs.values()].some(
    (job) => job.state === 'waiting' && job.reason === 'reconnect',
  );

  // The session titles of the finished uploads, from this device's storage.
  const missing = finished.filter((job) => !titles.has(job.sessionId)).map((job) => job.sessionId);
  const missingKey = missing.join(',');
  useEffect(() => {
    if (!missingKey) return;
    let live = true;
    void Promise.all(missingKey.split(',').map((id) => getSession(id))).then((sessions) => {
      if (!live) return;
      setTitles((known) => {
        const next = new Map(known);
        for (const session of sessions) if (session) next.set(session.id, sessionTitle(session));
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [missingKey]);

  // Never over a call: the live page (and the desktop's call window) shows no notices.
  if (onCallPage) return null;
  if (finished.length === 0 && (!needsReconnect || reconnectClosed)) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {needsReconnect && !reconnectClosed && (
        <Notice
          text="Google Drive needs to be reconnected. Your calls are kept and will upload afterwards."
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => getPlatform().openDriveSetup('/api/google/connect')}
            >
              Reconnect Google Drive
            </Button>
          }
          onClose={() => setReconnectClosed(true)}
        />
      )}
      {finished.map((job) => (
        <SavedNotice key={job.sessionId} job={job} title={titles.get(job.sessionId) ?? ''} />
      ))}
    </div>
  );
}

/**
 * One "saved" notice.
 *
 * @param props.job   The finished upload.
 * @param props.title The session's title ('' while it loads).
 * @returns The notice.
 */
function SavedNotice({
  job,
  title,
}: {
  /** The finished upload. */
  job: DriveSessionJob;
  /** The session's title. */
  title: string;
}) {
  const saved = job.files
    .filter((file) => file.done && !file.missing)
    .map((file) => ({ name: file.name, folder: file.folder }));
  const close = () => void markDriveNoticeShown(job.sessionId);
  return (
    <Notice
      text={`${savedHeadline(saved)}${title ? ` — ${title}` : ''}`}
      action={
        <a
          href={driveFolderUrl(job.folderId!)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-medium text-ui-link underline-offset-2 hover:underline"
          onClick={close}
        >
          Open in Drive ↗
        </a>
      }
      onClose={close}
    />
  );
}

/**
 * A notice's frame.
 *
 * @param props.text    Its words.
 * @param props.action  Its button or link.
 * @param props.onClose Closes it.
 * @returns The notice.
 */
function Notice({
  text,
  action,
  onClose,
}: {
  /** Its words. */
  text: string;
  /** Its button or link. */
  action: ReactNode;
  /** Closes it. */
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full max-w-[520px] items-center justify-between gap-3 rounded-control border border-ui-border bg-ui-surface p-3 text-[13px] text-ui-text shadow-card"
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
