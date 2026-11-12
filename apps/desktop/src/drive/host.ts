/**
 * File: apps/desktop/src/drive/host.ts
 * Purpose: Wires Google Drive saving into the shell (desktop 1.6.0, ADR-0072): the IPC calls for
 *          uploading a recording file (its progress goes back to the page that asked) and for the native
 *          "saved" notification, for Kite origin main frames only; and the call state, which pauses every
 *          upload the moment a call starts. 1.6.2 (ADR-0074): a recording file's size.
 * Used by: src/main.ts
 * Depends on: electron (types), src/drive/{upload,notice}.ts, src/channels.ts, src/hotkeys.ts
 *             (isKiteSender), src/recordings/manager.ts (types)
 * Architecture: docs/decisions/ADR-0072-google-drive-saving.md; architecture §7.3
 *
 * Logs statuses only: never a token, an address or a title.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  DRIVE_FILE_SIZE_CHANNEL,
  DRIVE_PROGRESS_EVENT,
  DRIVE_UPLOAD_CHANNEL,
  SHOW_NOTICE_CHANNEL,
} from '../channels';
import { isKiteSender } from '../hotkeys';
import type { RecordingManager } from '../recordings/manager';
import { showNotice, type NoticeDeps } from './notice';
import { createDriveUploader, type DriveUploader } from './upload';

/** What installDrive() needs. */
export interface DriveHostDeps {
  /** Electron's ipcMain. */
  ipcMain: Pick<IpcMain, 'handle'>;
  /** The Kite origin (only its main frames may call). */
  allowedOrigin: string;
  /** The recordings' index (files are taken from it only). */
  recordings: Pick<RecordingManager, 'trackFileOf'>;
  /**
   * Electron's net.fetch.
   * @param url  The address.
   * @param init The request.
   */
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** Electron's Notification and shell, for the "saved" notification. */
  notices: NoticeDeps;
}

/** What installDrive() gives main.ts. */
export interface DriveHost {
  /** The uploader (tests). */
  uploader: DriveUploader;
  /**
   * The page says a call started or ended; a start pauses every upload at once.
   * @param active True while a call is live.
   */
  setCallActive(active: boolean): void;
}

/**
 * Installs the Drive IPC calls.
 * @param deps See DriveHostDeps.
 * @returns The uploader and the call-state hook.
 * Called from: start() in main.ts, once the app is ready
 */
export function installDrive(deps: DriveHostDeps): DriveHost {
  let callActive = false;
  const uploader = createDriveUploader({
    fileOf: (id, track) => deps.recordings.trackFileOf(id, track),
    fetch: deps.fetch,
    callActive: () => callActive,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  });
  /**
   * Answers one channel, for Kite main frames only.
   * @param channel The channel.
   * @param handler The answer.
   */
  const handle = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => {
    deps.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isKiteSender(event, deps.allowedOrigin))
        throw new Error('Only the Kite page can do this');
      return handler(event, ...args);
    });
  };

  handle(DRIVE_UPLOAD_CHANNEL, async (event, request) => {
    const started = Date.now();
    const result = await uploader.upload(request, (progress) => {
      // The page may have gone (closed, reloaded): the upload carries on, and the next run finds it done.
      if (!event.sender.isDestroyed()) event.sender.send(DRIVE_PROGRESS_EVENT, progress);
    });
    console.info('drive: upload ended', {
      status: result.status,
      ...(result.status === 'failed' ? { reason: result.reason } : {}),
      ms: Date.now() - started,
    });
    return result;
  });
  handle(SHOW_NOTICE_CHANNEL, (_event, notice) => showNotice(deps.notices, notice));
  // 1.6.2 (ADR-0074): a recording file's size, for the server to start and verify its upload.
  handle(DRIVE_FILE_SIZE_CHANNEL, (_event, request) => uploader.fileSize(request));

  return {
    uploader,
    setCallActive(active) {
      callActive = active;
      if (active) uploader.pauseAll();
    },
  };
}
