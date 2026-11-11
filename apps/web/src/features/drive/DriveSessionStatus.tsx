/**
 * File: apps/web/src/features/drive/DriveSessionStatus.tsx
 * Purpose: One session's Google Drive upload on this device, in one line (ADR-0072): "Waiting to upload
 *          to Drive", "Uploading to Drive 42%", "Drive upload paused for the call", "Saved to Drive ↗"
 *          (the session folder), or why it waits or stopped, with Retry or Settings. Shows nothing for a
 *          session this device is not saving.
 * Used by: src/features/dashboard/SessionCard.tsx (SessionCardFrame), src/features/meetings/MeetingsPage.tsx
 * Depends on: @kite/shared (driveFolderUrl), src/core/drive/{uploader,reasons,queue}.ts,
 *             src/features/drive/useDrive.ts
 * Architecture: ADR-0072
 */
'use client';

import { driveFolderUrl } from '@kite/shared';
import type { MouseEvent } from 'react';
import { retryDriveUpload } from '@/core/drive/queue';
import { driveReasonNeedsSettings, driveReasonText } from '@/core/drive/reasons';
import { jobPercent } from '@/core/drive/uploader';
import { useDriveJobs } from './useDrive';

/** Short words for a waiting job, by reason (the full words are the tooltip). */
const WAITING_WORDS: Readonly<Record<string, string>> = {
  reconnect: 'Reconnect Google Drive',
  'not-connected': 'Connect Google Drive',
  'no-folder': 'Choose a Drive folder',
  'save-off': 'Saving to Drive is off',
};

/**
 * The line.
 *
 * @param props.sessionId The session.
 * @returns The line, or nothing.
 * Rendered by: SessionCardFrame, MeetingRow
 */
export function DriveSessionStatus({
  sessionId,
}: {
  /** The session. */
  sessionId: string;
}) {
  const job = useDriveJobs().get(sessionId);
  if (!job) return null;
  const link = 'text-ui-link underline-offset-2 hover:underline';
  const base = 'flex flex-wrap items-center gap-x-2 text-[12px]';
  // Clicks inside a card must not open the session behind it.
  const stop = (event: MouseEvent) => event.stopPropagation();

  if (job.state === 'done' && job.folderId) {
    return (
      <p className={`${base} text-ui-muted`}>
        <a
          href={driveFolderUrl(job.folderId)}
          target="_blank"
          rel="noopener noreferrer"
          className={link}
          onClick={stop}
        >
          Saved to Drive ↗
        </a>
      </p>
    );
  }
  if (job.state === 'uploading' || job.state === 'queued') {
    return (
      <p className={`${base} text-ui-muted`} role="status">
        {job.state === 'uploading'
          ? `Uploading to Drive ${jobPercent(job)}%`
          : 'Waiting to upload to Drive'}
      </p>
    );
  }
  if (job.state === 'paused') {
    return (
      <p className={`${base} text-ui-muted`} role="status">
        Drive upload paused for the call ({jobPercent(job)}%)
      </p>
    );
  }
  const words = driveReasonText(job.reason);
  const short = job.state === 'waiting' ? (WAITING_WORDS[job.reason ?? ''] ?? words) : words;
  return (
    <p className={`${base} text-ui-text`} role="status" title={words}>
      <span>{short}</span>
      {driveReasonNeedsSettings(job.reason) ? (
        <a href="/settings#google-drive" className={link} onClick={stop}>
          Settings
        </a>
      ) : (
        <button
          type="button"
          className={link}
          onClick={(event) => {
            stop(event);
            void retryDriveUpload(sessionId);
          }}
        >
          Retry
        </button>
      )}
    </p>
  );
}
