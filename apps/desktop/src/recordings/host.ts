/**
 * File: apps/desktop/src/recordings/host.ts
 * Purpose: Wires meeting recording into the shell (desktop 1.5.0, ADR-0068): the IPC calls of the
 *          recording contract (Kite origin main frames only), the background process that finalises
 *          files, the private kite-recording:// scheme the player plays from (byte ranges, so the video
 *          seeks; only files in the index), the player window, the display picked for recordings, and
 *          this computer's id and name. Recordings whose page went away are recovered at once; ones
 *          left by a crash or a quit are recovered at the next start.
 * Used by: src/main.ts
 * Depends on: electron (IpcMain, Session, BrowserWindow, dialog, shell, screen, utilityProcess),
 *             src/recordings/manager.ts, src/recordings/worker.ts (types), src/channels.ts,
 *             src/hotkeys.ts (isKiteSender), src/store.ts, @kite/shared
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; architecture §7.3
 * Never logs a recording's content: ids, sizes and times only.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, stat, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  DEVICE_NAME_MAX,
  RECORDING_SCHEME,
  type DeviceIdentity,
  type RecordingDisplay,
  type RecordingSaveResult,
} from '@kite/shared';
import type {
  BrowserWindow,
  Dialog,
  IpcMain,
  IpcMainInvokeEvent,
  Screen,
  Session,
  Shell,
  WebContents,
} from 'electron';
import {
  DEVICE_IDENTITY_CHANNEL,
  LIST_DISPLAYS_CHANNEL,
  RECORDING_CLOSE_CHANNEL,
  RECORDING_DELETE_CHANNEL,
  RECORDING_DISPLAY_CHANNEL,
  RECORDING_LIST_CHANNEL,
  RECORDING_OPEN_CHANNEL,
  RECORDING_PLAY_CHANNEL,
  RECORDING_SAVE_AS_CHANNEL,
  RECORDING_SHOW_CHANNEL,
  RECORDING_WRITE_CHANNEL,
  RENAME_DEVICE_CHANNEL,
} from '../channels';
import { isKiteSender } from '../hotkeys';
import type { ShellStore } from '../store';
import { createRecordingManager, type FinaliseOutcome, type RecordingManager } from './manager';
import type { FinaliseReply, FinaliseRequest } from './worker';

/** How long one file may take to finalise before the original is kept as it is, in ms. */
export const FINALISE_TIMEOUT_MS = 10 * 60_000;

/** The part of an Electron UtilityProcess used here (tests pass a fake). */
export interface FinaliseProcess {
  /** Sends a request. */
  postMessage: (message: FinaliseRequest) => void;
  /** Listens for replies. */
  on(event: 'message', listener: (message: FinaliseReply) => void): void;
  /** Listens for the process stopping (a crash included). */
  on(event: 'exit', listener: (code: number) => void): void;
}

/** What installRecordings() needs. */
export interface RecordingsDeps {
  /** Electron's ipcMain. */
  ipcMain: Pick<IpcMain, 'handle'>;
  /** The Kite origin (only its main frames may call). */
  allowedOrigin: string;
  /** The session whose protocol serves kite-recording:// (the default session). */
  session: Pick<Session, 'protocol'>;
  /** The Recordings folder. */
  folder: () => string;
  /** The app's data folder (the index lives there). */
  dataFolder: string;
  /** The shell's settings (device id and name, the picked display). */
  store: ShellStore;
  /** Starts the finalising process (utilityProcess.fork of dist/recording-worker.js). */
  forkWorker: () => FinaliseProcess;
  /** Opens (or brings forward) the player window on a path of the Kite app. */
  openPlayer: (pagePath: string) => void;
  /** Electron's dialog (Save as…). */
  dialog: Pick<Dialog, 'showSaveDialog'>;
  /** Electron's shell (Recycle Bin, file manager). */
  shell: Pick<Shell, 'trashItem' | 'showItemInFolder'>;
  /** Electron's screen (the displays). */
  screen: Pick<Screen, 'getAllDisplays' | 'getPrimaryDisplay'>;
  /** The window a Save dialog belongs to. */
  windowOf: (contents: WebContents) => BrowserWindow | null;
}

/** What installRecordings() returns to main.ts. */
export interface RecordingsHost {
  /** The manager (tests, and main.ts at quit). */
  manager: RecordingManager;
  /** The display picked for recordings, or null (the media handler asks). */
  pickedDisplay: () => string | null;
}

/**
 * This computer's identity: a random id made once, and the name the person gave it or the computer's
 * own name.
 * @param store The shell's settings.
 * @returns The identity.
 * Called from: installRecordings(); tests
 */
export function deviceIdentity(store: ShellStore): DeviceIdentity {
  const settings = store.read();
  let id = settings.deviceId;
  if (!id) {
    id = randomUUID();
    store.write({ deviceId: id });
  }
  const name = settings.deviceName?.trim() || os.hostname() || 'This computer';
  return { id, name: name.slice(0, DEVICE_NAME_MAX) };
}

/**
 * The displays, the main one first, labelled for a picker.
 * @param screen Electron's screen.
 * @returns The displays.
 * Called from: installRecordings(); tests
 */
export function recordingDisplays(
  screen: Pick<Screen, 'getAllDisplays' | 'getPrimaryDisplay'>,
): RecordingDisplay[] {
  const primary = screen.getPrimaryDisplay().id;
  const displays = [...screen.getAllDisplays()].sort(
    (a, b) => Number(b.id === primary) - Number(a.id === primary),
  );
  return displays.map((display, index) => {
    // The size in real pixels (what the recording sees), not in scaled DIPs.
    const width = Math.round(display.size.width * display.scaleFactor);
    const height = Math.round(display.size.height * display.scaleFactor);
    return {
      id: String(display.id),
      label: `Display ${index + 1} (${width} × ${height}${display.id === primary ? ', main' : ''})`,
      primary: display.id === primary,
    };
  });
}

/**
 * Parses a byte-range header ("bytes=START-END" or "bytes=START-"); suffix ranges are not used by
 * media elements and are treated as the whole file.
 * @param header The Range header, or null.
 * @param size   The file's size.
 * @returns The inclusive range, or null for the whole file; 'invalid' for one beyond the end.
 * Called from: the scheme handler; tests
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  const match = header ? /^bytes=(\d+)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

/**
 * The content type of a recording's main file.
 * @param fileName Its name.
 * @param kind     Screen and sound, or sound only.
 * @returns The type.
 */
function contentType(fileName: string, kind: string): string {
  if (fileName.endsWith('.mkv')) return 'video/x-matroska';
  return kind === 'audio' ? 'audio/webm' : 'video/webm';
}

/**
 * Starts the finalising process on first use and sends it requests; a crashed process is started
 * again for the next file, and its pending requests fail (their originals are kept).
 * @param fork Starts the process.
 * @returns finalise(input, output) for the manager.
 */
function createFinaliser(
  fork: () => FinaliseProcess,
): (input: string, output: string, container?: 'mp4') => Promise<FinaliseOutcome> {
  let worker: FinaliseProcess | null = null;
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (outcome: FinaliseOutcome) => void; reject: (error: Error) => void }
  >();
  const start = () => {
    const child = fork();
    child.on('message', (reply) => {
      const waiting = pending.get(reply.id);
      if (!waiting) return;
      pending.delete(reply.id);
      if (reply.type === 'done') {
        console.info('recordings: finalised', { ms: reply.ms, bytes: reply.bytes });
        waiting.resolve({ durationMs: reply.durationMs });
      } else {
        waiting.reject(new Error(reply.message));
      }
    });
    child.on('exit', (code) => {
      if (worker === child) worker = null;
      for (const [id, waiting] of pending) {
        pending.delete(id);
        waiting.reject(new Error(`the finalising process stopped (${code})`));
      }
    });
    return child;
  };
  return (input, output, container) =>
    new Promise<FinaliseOutcome>((resolve, reject) => {
      worker ??= start();
      const id = nextId++;
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error('finalising took too long'));
      }, FINALISE_TIMEOUT_MS);
      pending.set(id, {
        resolve: (outcome) => {
          clearTimeout(timer);
          resolve(outcome);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      worker.postMessage({
        id,
        input,
        output,
        container: container ?? (path.extname(input) === '.mkv' ? 'mkv' : 'webm'),
      });
    });
}

/**
 * Installs everything recording needs in the shell.
 * @param deps See RecordingsDeps.
 * @returns The manager and the picked display.
 * Called from: start() in main.ts, once the app is ready
 */
export function installRecordings(deps: RecordingsDeps): RecordingsHost {
  const finaliser = createFinaliser(deps.forkWorker);
  const manager = createRecordingManager({
    folder: deps.folder,
    indexFile: path.join(deps.dataFolder, 'recordings.json'),
    freeBytes: async (dir) => {
      const info = await statfs(dir);
      return Number(info.bavail) * Number(info.bsize);
    },
    finalise: (input, output) => finaliser(input, output),
    trash: (file) => deps.shell.trashItem(file),
    now: () => Date.now(),
  });
  // Pages that are recording: when one goes (closed, reloaded, crashed), its recordings are recovered.
  const watched = new Set<number>();
  /**
   * Recovers a page's recordings once it has gone.
   * @param contents The page.
   */
  const watch = (contents: WebContents) => {
    if (watched.has(contents.id)) return;
    watched.add(contents.id);
    const gone = () => {
      if (!watched.delete(contents.id)) return;
      void manager.abandon(contents.id);
    };
    contents.once('destroyed', gone);
    contents.once('render-process-gone', gone);
    // A new document in the main frame ends the old page's call (and its MediaRecorder).
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) gone();
    });
  };
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

  handle(RECORDING_OPEN_CHANNEL, async (event, request) => {
    const result = await manager.open(request, event.sender.id);
    if (result.ok) watch(event.sender);
    return result;
  });
  handle(RECORDING_WRITE_CHANNEL, (_event, id, track, bytes) => manager.write(id, track, bytes));
  handle(RECORDING_CLOSE_CHANNEL, (_event, id) => manager.close(id));
  handle(RECORDING_LIST_CHANNEL, () => manager.list());
  handle(RECORDING_PLAY_CHANNEL, (_event, id) => {
    const found = manager.fileOf(id);
    if (!found) return false;
    deps.openPlayer(`/player/${found.recording.id}`);
    return true;
  });
  handle(RECORDING_SAVE_AS_CHANNEL, async (event, id): Promise<RecordingSaveResult> => {
    const found = manager.fileOf(id);
    if (!found) return 'missing';
    const window = deps.windowOf(event.sender);
    const own = path.extname(found.file).slice(1);
    const video = found.recording.kind === 'screen';
    const options = {
      title: 'Save a copy of the recording',
      defaultPath: path.join(os.homedir(), 'Downloads', path.basename(found.file)),
      // The file as recorded, or (a screen recording) an MP4 copy for players that want one.
      filters: [
        {
          name: own === 'mkv' ? 'Matroska video' : video ? 'WebM video' : 'WebM audio',
          extensions: [own],
        },
        ...(video ? [{ name: 'MP4 video', extensions: ['mp4'] }] : []),
      ],
    };
    const choice = window
      ? await deps.dialog.showSaveDialog(window, options)
      : await deps.dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return 'cancelled';
    if (video && path.extname(choice.filePath).toLowerCase() === '.mp4') {
      // Copied without re-encoding into MP4 (H.264 and Opus kept as they are).
      await finaliser(found.file, choice.filePath, 'mp4');
    } else {
      await copyFile(found.file, choice.filePath);
    }
    console.info('recordings: copy saved', { id: found.recording.id });
    return 'saved';
  });
  handle(RECORDING_SHOW_CHANNEL, (_event, id) => {
    const found = manager.fileOf(id);
    if (!found) return false;
    deps.shell.showItemInFolder(found.file);
    return true;
  });
  handle(RECORDING_DELETE_CHANNEL, (_event, id) => manager.remove(id));
  handle(LIST_DISPLAYS_CHANNEL, () => recordingDisplays(deps.screen));
  handle(RECORDING_DISPLAY_CHANNEL, (_event, displayId) => {
    const known = recordingDisplays(deps.screen).some((display) => display.id === displayId);
    deps.store.write({ recordingDisplay: known ? (displayId as string) : undefined });
  });
  handle(DEVICE_IDENTITY_CHANNEL, () => deviceIdentity(deps.store));
  handle(RENAME_DEVICE_CHANNEL, (_event, name) => {
    const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
    deps.store.write({ deviceName: clean ? clean.slice(0, DEVICE_NAME_MAX) : undefined });
    return deviceIdentity(deps.store);
  });

  // The player's video: kite-recording://file/<id>, from the index only, with byte ranges.
  deps.session.protocol.handle(RECORDING_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = url.pathname.replace(/^\//, '');
    const found = url.hostname === 'file' ? manager.fileOf(id) : null;
    if (!found || request.method !== 'GET') return new Response(null, { status: 404 });
    const { size } = await stat(found.file);
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const body = Readable.toWeb(createReadStream(found.file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        'content-type': contentType(found.recording.fileName, found.recording.kind),
        'content-length': String(end - start + 1),
        'accept-ranges': 'bytes',
        // Only the Kite page may read the frames (a canvas, a thumbnail); other origins never load here.
        'access-control-allow-origin': deps.allowedOrigin,
        ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
        'cache-control': 'no-store',
      },
    });
  });

  return {
    manager,
    pickedDisplay: () => deps.store.read().recordingDisplay ?? null,
  };
}
