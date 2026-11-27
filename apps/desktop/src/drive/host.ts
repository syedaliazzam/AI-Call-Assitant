/**
 * File: apps/desktop/src/drive/host.ts
 * Purpose: Wires Google Drive saving into the shell (desktop 1.6.0, ADR-0072): the IPC calls for
 *          uploading a recording file (its progress goes back to the page that asked), for Kite origin
 *          main frames only; and the call state, which pauses every
 *          upload the moment a call starts. 1.6.2 (ADR-0074): a recording file's size. 1.7.2 (ADR-0106): the
 *          page's Drive queue report and the count of uploads sending, for the background upload on exit.
 *          Mac 1.8.2 / Windows 1.7.6 (ADR-0131): the "saved" notification is gone. Its channel stays (an
 *          older page may still ask) but refuses every request: a system notification is not covered by
 *          screen-share protection, and the meeting may still be shared after a call.
 * Used by: src/main.ts
 * Depends on: electron (types), src/drive/upload.ts, src/channels.ts, src/hotkeys.ts
 *             (isKiteSender), src/recordings/manager.ts (types)
 * Architecture: docs/decisions/ADR-0072-google-drive-saving.md; architecture §7.3
 *
 * Logs statuses only: never a token, an address or a title.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  DRIVE_FILE_SIZE_CHANNEL,
  DRIVE_PROGRESS_EVENT,
  DRIVE_QUEUE_CHANNEL,
  DRIVE_UPLOAD_CHANNEL,
  SHOW_NOTICE_CHANNEL,
} from '../channels';
import { isKiteSender } from '../hotkeys';
import type { RecordingManager } from '../recordings/manager';
import { createDriveUploader, type DriveUploader } from './upload';

/** What installDrive() needs. */
export interface DriveHostDeps {
  /** Electron's ipcMain. */
  ipcMain: Pick<IpcMain, 'handle' | 'on'>;
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
  /**
   * 1.7.2 (ADR-0106): a Kite page reported the Drive work left (checked by the receiver).
   * @param report What arrived.
   */
  onQueueReport?(report: unknown): void;
  /** 1.7.2 (ADR-0106): an upload started or ended. */
  onUploadsChanged?(): void;
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
  /**
   * 1.7.2 (ADR-0106): how many uploads are sending now.
   * @returns The count.
   */
  activeUploads(): number;
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
    // 1.7.2 (ADR-0106): the page that asked went away (a closed window, a reload): its upload stops, so
    // the page that takes over (the panel, which keeps uploading after an exit) resumes it from where
    // Google got to. Before 1.7.2 it carried on, and the next page found it busy and waited minutes.
    const fields = (request ?? {}) as { recordingId?: unknown; track?: unknown };
    const onGone = () => uploader.abort(String(fields.recordingId), String(fields.track));
    event.sender.once('destroyed', onGone);
    let result: Awaited<ReturnType<DriveUploader['upload']>>;
    try {
      result = await uploader.upload(request, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(DRIVE_PROGRESS_EVENT, progress);
        // The first report comes once the upload is counted as sending.
        deps.onUploadsChanged?.();
      });
    } finally {
      if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', onGone);
    }
    deps.onUploadsChanged?.();
    console.info('drive: upload ended', {
      status: result.status,
      ...(result.status === 'failed' ? { reason: result.reason } : {}),
      ms: Date.now() - started,
    });
    return result;
  });
  // ADR-0131: shows nothing, ever ("false": the system cannot show one). Kept so an older page's call gets
  // an answer instead of an error.
  handle(SHOW_NOTICE_CHANNEL, () => false);
  // 1.6.2 (ADR-0074): a recording file's size, for the server to start and verify its upload.
  handle(DRIVE_FILE_SIZE_CHANNEL, (_event, request) => uploader.fileSize(request));
  // 1.7.2 (ADR-0106): the page's report of the Drive work left (send: the page does not wait).
  deps.ipcMain.on(DRIVE_QUEUE_CHANNEL, (event, report: unknown) => {
    if (!isKiteSender(event, deps.allowedOrigin)) return;
    deps.onQueueReport?.(report);
  });

  return {
    uploader,
    setCallActive(active) {
      callActive = active;
      if (active) uploader.pauseAll();
    },
    activeUploads: () => uploader.active(),
  };
}
