/**
 * File: apps/web/src/core/drive/runner.ts
 * Purpose: Puts the Google Drive uploader together for this page (ADR-0072) and runs it in one window of
 *          the profile at a time (a Web Lock), so two windows never upload the same file. The page's
 *          platform supplies the desktop shell's recording uploads. ADR-0131: no system notification is ever
 *          shown (a shared screen would show it); each session's status line says where its upload is.
 * Used by: src/features/drive/DriveUploader.tsx
 * Depends on: src/core/drive/{api,callFiles,queue,uploader}.ts, src/core/storage (sessions,
 *             driveUploads), src/platform/types.ts (types only)
 * Architecture: ADR-0072, ADR-0074 (no Google client or token in the page), ADR-0080 (main video only)
 */
import type { Platform } from '@/platform/types';
import { loadSessionCalls } from '../review/calls';
import { updateCall } from '../storage/calls';
import { deleteCallJob, listCallJobs, nextCallJob, putCallJob } from '../storage/driveCallJobs';
import { deleteDriveJob, listDriveJobs, nextDriveJob, putDriveJob } from '../storage/driveUploads';
import { listRecordings } from '../storage/recordings';
import { getSession } from '../storage/sessions';
import { driveApi } from './api';
import { buildCallFiles, buildCallViewFiles } from './callFiles';
import { callIsLive } from './queue';
import { runDriveQueue, type KnownRecording, type RunOutcome, type UploaderDeps } from './uploader';

/** The Web Lock that lets one window of the profile upload at a time. */
export const UPLOADER_LOCK = 'kite.drive-uploader';

/**
 * The uploader's dependencies for this page.
 *
 * @param platform    The page's platform (recordings on the desktop).
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
    // ADR-0074: no Google client and no token in the page; the server does the Drive work.
    api,
    host:
      drive && recording
        ? {
            recordings: () => recording.list(),
            upload: (request, onProgress) => drive.upload(request, onProgress),
            // 1.6.2: only a shell that uploads without a token has it.
            ...(drive.fileSize
              ? { fileSize: (recordingId, track) => drive.fileSize!(recordingId, track) }
              : {}),
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
    // ADR-0077: each call's own upload.
    calls: {
      jobs: { next: nextCallJob, list: listCallJobs, put: putCallJob, remove: deleteCallJob },
      call: async (job) =>
        (await loadSessionCalls(job.sessionId)).find((view) => view.id === job.callId) ?? null,
      files: (session, call, title) => buildCallViewFiles(session, call, title, accountName),
      callState: async (job, drive) => {
        // A legacy call (made before call records) has no record: updateCall() changes nothing then.
        // ADR-0106: movedAt tells every device this app is working on it (a day without it: "paused").
        await updateCall(job.callId, { drive: { ...drive, movedAt: Date.now() } });
      },
    },
    callActive: callIsLive,
    now: () => Date.now(),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    expectedRecordings: async (sessionId) => {
      // This computer's index and the account's synced records (other computers), finished ones only.
      const [local, synced] = await Promise.all([
        recording ? recording.list().catch(() => []) : Promise.resolve([]),
        listRecordings().catch(() => []),
      ]);
      const found = new Map<string, KnownRecording>();
      for (const item of [...synced, ...local]) {
        if (item.sessionId !== sessionId) continue;
        if (item.status !== 'complete' && item.status !== 'recovered') continue;
        // ADR-0077: the computer holding it, for the "Recording not uploaded" email (only the synced
        // record knows its name; this computer's index entry, read after it, keeps it).
        const own: string | undefined = 'deviceName' in item ? String(item.deviceName) : undefined;
        const deviceName = own || found.get(item.id)?.deviceName;
        found.set(item.id, {
          id: item.id,
          part: item.part,
          // ADR-0080: the stereo sound file stays on this computer and is never uploaded, so the
          // server is never told to wait for one (the file itself is still recorded, decision D3).
          stereo: false,
          startedAt: item.startedAt,
          meetingId: item.meetingId,
          ...(deviceName ? { deviceName } : {}),
        });
      }
      return [...found.values()];
    },
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
