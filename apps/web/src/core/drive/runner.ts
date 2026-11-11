/**
 * File: apps/web/src/core/drive/runner.ts
 * Purpose: Puts the Google Drive uploader together for this page (ADR-0072) and runs it in one window of
 *          the profile at a time (a Web Lock), so two windows never upload the same file. The page's
 *          platform supplies the desktop shell's recording uploads and notifications (none in a browser).
 * Used by: src/features/drive/DriveUploader.tsx
 * Depends on: src/core/drive/{api,google,callFiles,queue,uploader}.ts, src/core/storage (sessions,
 *             driveUploads), src/platform/types.ts (types only)
 * Architecture: ADR-0072
 */
import type { Platform } from '@/platform/types';
import { deleteDriveJob, listDriveJobs, nextDriveJob, putDriveJob } from '../storage/driveUploads';
import { getSession } from '../storage/sessions';
import { driveApi } from './api';
import { buildCallFiles } from './callFiles';
import { createDriveClient } from './google';
import { callIsLive } from './queue';
import { runDriveQueue, type RunOutcome, type UploaderDeps } from './uploader';

/** The Web Lock that lets one window of the profile upload at a time. */
export const UPLOADER_LOCK = 'kite.drive-uploader';

/**
 * The uploader's dependencies for this page.
 *
 * @param platform    The page's platform (recordings and notifications on the desktop).
 * @param accountName The account's display name, on the user's transcript turns.
 * @returns The dependencies.
 * Called from: features/drive/DriveUploader.tsx
 */
export function createUploaderDeps(
  platform: Pick<Platform, 'drive' | 'recording'>,
  accountName: string | null,
): UploaderDeps {
  const api = driveApi();
  const drive = platform.drive;
  const recording = platform.recording;
  return {
    api,
    drive: createDriveClient({
      fetch: (input, init) => fetch(input, init),
      token: async (fresh) => (await api.token(fresh)).accessToken,
    }),
    host:
      drive && recording
        ? {
            recordings: () => recording.list(),
            upload: (request, onProgress) => drive.upload(request, onProgress),
          }
        : null,
    jobs: {
      next: nextDriveJob,
      list: listDriveJobs,
      put: putDriveJob,
      remove: deleteDriveJob,
    },
    session: getSession,
    callFiles: (session, call, title) => buildCallFiles(session, call, title, accountName),
    callActive: callIsLive,
    notice: (notice) => {
      // The desktop's native notification; a browser shows the in-app notice only.
      void drive?.notify(notice).catch(() => false);
    },
    now: () => Date.now(),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

/**
 * Runs the queue once, unless another window of this profile is already running it.
 *
 * @param deps The dependencies.
 * @returns How the run ended, or 'busy' when another window holds the lock.
 * Called from: features/drive/DriveUploader.tsx
 */
export async function runUploaderOnce(deps: UploaderDeps): Promise<RunOutcome> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) return runDriveQueue(deps);
  const outcome = await locks.request(UPLOADER_LOCK, { ifAvailable: true }, async (lock) =>
    lock ? runDriveQueue(deps) : ('busy' as const),
  );
  return outcome as RunOutcome;
}
