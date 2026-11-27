/**
 * File: apps/web/src/features/drive/DriveSessionStatus.tsx
 * Purpose: One session's Google Drive upload on this device, in one quiet line (ADR-0072; ADR-0131 words):
 *          "Uploading…" (with its share once it is sending, "paused for the call" while a call runs),
 *          "Saved to Drive ✓" (a link to the session folder), "Upload failed — Retry" (the reason is the
 *          tooltip), or what to fix in Settings; for a session this device never saved, "Upload to Drive"
 *          (1.6.0). ADR-0131: this line is the only place an upload's outcome shows (no notification, no
 *          banner), because the user may still be sharing the screen after a call.
 * Used by: src/features/dashboard/SessionCard.tsx (SessionCardFrame: the dashboard's cards and the desktop
 *          launcher's session list), src/features/meetings/FilesTab.tsx
 * Depends on: @kite/shared (driveFolderUrl), src/core/drive/{uploader,reasons,queue}.ts,
 *             src/features/drive/useDrive.ts
 * Architecture: ADR-0072, ADR-0131
 */
'use client';

import { driveFolderUrl } from '@kite/shared';
import type { DriveSessionJob } from '@/core/storage/types';
import { useState, type MouseEvent } from 'react';
import { uploadSessionToDrive } from '@/core/drive/backfill';
import { retryDriveUpload } from '@/core/drive/queue';
import { driveReasonNeedsSettings, driveReasonText } from '@/core/drive/reasons';
import { jobPercent } from '@/core/drive/uploader';
import { getPlatform } from '@/platform';
import { useDriveJobs, useDriveSaves } from './useDrive';

/** Short words for a waiting job, by reason (the full words are the tooltip). */
const WAITING_WORDS: Readonly<Record<string, string>> = {
  reconnect: 'Reconnect Google Drive',
  'not-connected': 'Connect Google Drive',
  'no-folder': 'Choose a Drive folder',
  'save-off': 'Saving to Drive is off',
};

/** What the status line shows for a job (ADR-0131). */
export interface DriveStatusWords {
  /** The words on the line. */
  text: string;
  /** The full reason, as the tooltip (failures and waits only). */
  tip?: string;
  /**
   * What follows the words: 'folder' makes the words a link to the Drive folder; 'retry' adds Retry;
   * 'settings' adds a Settings link; none for a line that only reports.
   */
  action?: 'folder' | 'retry' | 'settings';
  /** True for a line that changes by itself (role="status"). */
  live: boolean;
}

/**
 * The status line's words for a job (ADR-0131): "Uploading…", "Saved to Drive ✓", "Upload failed — Retry",
 * or what to fix in Settings. Pure, so it is unit-tested.
 *
 * @param job     The session's upload on this device.
 * @param percent Its share sent, 0–100 (jobPercent()).
 * @returns The words and what follows them.
 * Called from: DriveSessionStatus; tests/unit/features/drive/driveSessionStatus.test.ts
 */
export function driveStatusWords(
  job: Pick<DriveSessionJob, 'state' | 'reason' | 'folderId'>,
  percent: number,
): DriveStatusWords {
  switch (job.state) {
    case 'done':
      // A job finishes with its folder; without one (never seen) it reads as sending still.
      return job.folderId
        ? { text: 'Saved to Drive ✓', action: 'folder', live: false }
        : { text: 'Uploading…', live: true };
    case 'queued':
      return { text: 'Uploading…', live: true };
    case 'uploading':
      return { text: percent > 0 ? `Uploading… ${percent}%` : 'Uploading…', live: true };
    case 'paused':
      return { text: 'Uploading… paused for the call', live: true };
    case 'waiting':
    case 'error': {
      const words = driveReasonText(job.reason);
      if (driveReasonNeedsSettings(job.reason)) {
        const short = job.state === 'waiting' ? (WAITING_WORDS[job.reason ?? ''] ?? words) : words;
        return { text: short, tip: words, action: 'settings', live: true };
      }
      // A wait with another reason (update the desktop app) keeps its words, with Retry, as before.
      if (job.state === 'waiting') return { text: words, tip: words, action: 'retry', live: true };
      return { text: 'Upload failed —', tip: words, action: 'retry', live: true };
    }
  }
}

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
          const recording = getPlatform().recording;
          // ADR-0077: each of the session's calls this device never saved, as its own upload.
          void uploadSessionToDrive(sessionId, recording ? () => recording.list() : undefined)
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

  const words = driveStatusWords(job, jobPercent(job));

  if (words.action === 'folder' && job.folderId) {
    return (
      <p className={`${base} text-ui-muted`}>
        <a
          href={driveFolderUrl(job.folderId)}
          target="_blank"
          rel="noopener noreferrer"
          className={link}
          onClick={stop}
          data-drive-status="saved"
        >
          {words.text}
        </a>
      </p>
    );
  }
  return (
    <p
      className={`${base} ${words.action === 'retry' || words.action === 'settings' ? 'text-ui-text' : 'text-ui-muted'}`}
      role={words.live ? 'status' : undefined}
      title={words.tip}
      data-drive-status={job.state}
    >
      <span>{words.text}</span>
      {words.action === 'settings' && (
        <a href="/settings#google-drive" className={link} onClick={stop}>
          Settings
        </a>
      )}
      {words.action === 'retry' && (
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
