/**
 * File: apps/web/src/features/drive/useDrive.ts
 * Purpose: React hooks for Google Drive (ADR-0072): the connection's status (read again when another
 *          window changes it, and when this window comes back to the front, for example after
 *          connecting in the system browser), this device's uploads (live, from IndexedDB), and whether
 *          the account saves to Drive as last seen (for "Upload to Drive").
 * Used by: src/features/drive/*, src/features/settings/Settings.tsx, src/features/dashboard/SessionCard.tsx,
 *          src/features/meetings/MeetingsPage.tsx
 * Depends on: src/core/drive/{api,queue}.ts, src/core/storage/driveUploads.ts
 * Architecture: ADR-0072
 */
'use client';

import type { DriveStatusResponse } from '@kite/shared';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { driveApi, DriveApiError } from '@/core/drive/api';
import { onDriveMessage, rememberDriveStatus, rememberedSaves } from '@/core/drive/queue';
import { watchDriveJobs } from '@/core/storage/driveUploads';
import type { DriveSessionJob } from '@/core/storage/types';

/** What useDriveStatus() gives. */
export interface DriveStatusState {
  /** The status, or null until read (or when it could not be). */
  status: DriveStatusResponse | null;
  /** Words for the person when it could not be read, else null. */
  error: string | null;
  /** Reads it again. */
  refresh: () => Promise<void>;
}

/**
 * The Drive connection's status.
 *
 * @returns The status, an error, and refresh().
 * Called from: GoogleDriveSetting.tsx, DriveNotices.tsx
 */
export function useDriveStatus(): DriveStatusState {
  const [status, setStatus] = useState<DriveStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // State is set only when the answer arrives (never synchronously inside the effect).
  const refresh = useCallback(
    () =>
      driveApi()
        .status()
        .then(
          (next) => {
            rememberDriveStatus(next);
            setStatus(next);
            setError(null);
          },
          (failure: unknown) => {
            setError(
              failure instanceof DriveApiError
                ? failure.message
                : 'Google Drive status unavailable.',
            );
          },
        ),
    [],
  );
  useEffect(() => {
    driveApi()
      .status()
      .then(
        (next) => {
          rememberDriveStatus(next);
          setStatus(next);
        },
        () => setError('Google Drive status unavailable.'),
      );
    const stop = onDriveMessage(() => void refresh());
    // Back to this window (for example after connecting in the system browser): read it again.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      stop();
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  return { status, error, refresh };
}

/** No jobs (before the first read, and on the server). */
const NO_JOBS: ReadonlyMap<string, DriveSessionJob> = new Map();

/** The jobs as last read, shared by every component on the page. */
let currentJobs: ReadonlyMap<string, DriveSessionJob> = NO_JOBS;

/** The components listening. */
const jobListeners = new Set<() => void>();

/** Stops the one IndexedDB watch, while anyone listens. */
let stopJobsWatch: (() => void) | null = null;

/**
 * Adds a listener; the first one starts the single IndexedDB watch and the last one stops it, so a
 * dashboard with many session cards reads the jobs once per change, not once per card.
 *
 * @param listener Called after each change.
 * @returns A function that removes it.
 */
function subscribeJobs(listener: () => void): () => void {
  jobListeners.add(listener);
  stopJobsWatch ??= watchDriveJobs(
    (list) => {
      currentJobs = new Map(list.map((job) => [job.sessionId, job]));
      for (const notify of jobListeners) notify();
    },
    () => undefined,
  );
  return () => {
    jobListeners.delete(listener);
    if (jobListeners.size === 0) {
      stopJobsWatch?.();
      stopJobsWatch = null;
      currentJobs = NO_JOBS;
    }
  };
}

/**
 * This device's Drive uploads, kept up to date.
 *
 * @returns The jobs by session id (empty until read).
 * Called from: DriveSessionStatus.tsx, DriveNotices.tsx
 */
export function useDriveJobs(): ReadonlyMap<string, DriveSessionJob> {
  return useSyncExternalStore(
    subscribeJobs,
    () => currentJobs,
    () => NO_JOBS,
  );
}

/**
 * Subscribes to changes of the remembered "saves to Drive" answer: Drive news from any window of this
 * profile, and storage changes from another tab.
 * @param listener Called after a change.
 * @returns A function that stops listening.
 */
function subscribeSaves(listener: () => void): () => void {
  const stop = onDriveMessage(listener);
  window.addEventListener('storage', listener);
  return () => {
    stop();
    window.removeEventListener('storage', listener);
  };
}

/**
 * Whether the account saves to Drive, as this device last saw it (no request).
 *
 * @returns True when connected (or waiting to reconnect) with "Save calls" on.
 * Called from: DriveSessionStatus.tsx ("Upload to Drive")
 */
export function useDriveSaves(): boolean {
  return useSyncExternalStore(subscribeSaves, rememberedSaves, () => false);
}
