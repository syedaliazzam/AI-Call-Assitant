/**
 * File: apps/web/src/platform/drive.ts
 * Purpose: The desktop app's Google Drive host (1.6.0, ADR-0072): uploads of this computer's recording
 *          files through the shell (which reads them from its Recordings index and sends them only to
 *          Google's upload address), the progress of those uploads, and native notifications. Present
 *          only when the shell has all three methods; otherwise null. 1.6.2 (ADR-0074): the file size, which
 *          also says the shell uploads without a token.
 * Used by: src/platform/desktop.ts
 * Depends on: @kite/shared (KiteDesktopApi, the Drive contract), src/platform/types.ts
 * Architecture: ADR-0072, ADR-0074; architecture §3.3
 */
import type { DriveUploadProgress, KiteDesktopApi } from '@kite/shared';
import type { DriveHost } from './types';

/**
 * The Drive host over the bridge, or null when this shell cannot upload (before 1.6.0).
 *
 * @param bridge The shell's bridge.
 * @returns The host, or null.
 * Called from: createDesktopPlatform() in desktop.ts; tests
 */
export function desktopDriveHost(bridge: KiteDesktopApi): DriveHost | null {
  const { driveUpload, onDriveUploadProgress, showNotice } = bridge;
  if (!driveUpload || !onDriveUploadProgress || !showNotice) return null;
  return {
    async upload(request, onProgress) {
      // Only this upload's progress reaches its caller (several pages may listen).
      const stop = onDriveUploadProgress((progress: DriveUploadProgress) => {
        if (progress.recordingId === request.recordingId && progress.track === request.track) {
          onProgress(progress);
        }
      });
      try {
        return await driveUpload(request);
      } finally {
        stop();
      }
    },
    notify: (notice) => showNotice(notice),
    // 1.6.2 (ADR-0074): only a shell that uploads without a token has it.
    ...(bridge.driveFileSize
      ? { fileSize: (recordingId, track) => bridge.driveFileSize!(recordingId, track) }
      : {}),
  };
}
