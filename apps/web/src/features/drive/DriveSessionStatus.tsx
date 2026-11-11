/**
 * File: apps/web/src/features/drive/DriveSessionStatus.tsx
 * Purpose: One session's Google Drive upload on this device, in one line (ADR-0072): "Waiting to upload
 *          to Drive", "Uploading to Drive 42%", "Drive upload paused for the call", "Saved to Drive ↗"
 *          (the session folder), or why it waits or stopped, with Retry or Settings; for a session this
 *          device never saved, "Upload to Drive" (1.6.0).
 * Used by: src/features/dashboard/SessionCard.tsx (SessionCardFrame), src/features/meetings/MeetingsPage.tsx
 * Depends on: @kite/shared (driveFolderUrl), src/core/drive/{uploader,reasons,queue}.ts,
 *             src/features/drive/useDrive.ts
 * Architecture: ADR-0072
 */
'use client';

import { driveFolderUrl } from '@kite/shared';
import { useState, type MouseEvent } from 'react';
import { uploadSessionToDrive } from '@/core/drive/backfill';
import { retryDriveUpload } from '@/core/drive/queue';
import { driveReasonNeedsSettings, driveReasonText } from '@/core/drive/reasons';
import { jobPercent } from '@/core/drive/uploader';
import { useDriveJobs, useDriveSaves } from './useDrive';

/** Short words for a waiting job, by reason (the full words are the tooltip). */
const WAITING_WORDS: Readonly<Record<string, string>> = {
  reconnect: 'Reconnect Google Drive',
  'not-connected': 'Connect Google Drive',
  'no-folder': 'Choose a Drive folder',
  'save-off': 'Saving to Drive is off',
};

/**
 * "Upload to Drive" for a session this device never saved (1.6.0): queues its calls; its email is sent
 * by hand from Settings. Shown only while the account saves to Drive.
 *
 * @param props.sessionId The session.
 * @returns The button, or nothing.
 */
function UploadToDrive({
  sessionId,
}: {
  /** The session. */
  sessionId: string;
}) {
  const saves = useDriveSaves();
  const [state, setState] = useState<'idle' | 'busy' | 'empty'>('idle');
  if (!saves) return null;
  if (state === 'empty') {
    return <p className="text-[12px] text-ui-muted">Nothing saved to upload</p>;
  }
  return (
    <p className="text-[12px]">
      <button
        type="button"
        className="text-ui-link underline-offset-2 hover:underline disabled:opacity-60"
        disabled={state === 'busy'}
        onClick={(event) => {
          event.stopPropagation();
          setState('busy');
          void uploadSessionToDrive(sessionId)
            .then((calls) => setState(calls > 0 ? 'idle' : 'empty'))
            .catch(() => setState('idle'));
        }}
      >
        Upload to Drive
      </button>
    </p>
  );
}

/**
 * The line.
 *
 * @param props.sessionId The session.
 * @param props.canUpload True when the session had a call, so "Upload to Drive" can be offered.
 * @returns The line, or nothing.
 * Rendered by: SessionCardFrame, MeetingRow
 */
export function DriveSessionStatus({
  sessionId,
  canUpload = false,
}: {
  /** The session. */
  sessionId: string;
  /** True when the session had a call (offer "Upload to Drive" when this device never saved it). */
  canUpload?: boolean;
}) {
  const job = useDriveJobs().get(sessionId);
  if (!job) return canUpload ? <UploadToDrive sessionId={sessionId} /> : null;
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
