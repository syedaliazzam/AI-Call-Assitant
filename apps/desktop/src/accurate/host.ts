/**
 * File: apps/desktop/src/accurate/host.ts
 * Purpose: The main-process side of accurate transcription (ADR-0034, opt-in, default off in the
 *          page's Settings). Answers four requests from the Kite page only: status, download
 *          (resumable, SHA-256 checked, in the background), remove, and transcribe one utterance.
 *          The engine runs in a utility process started on the first transcription and kept for
 *          the app's life; a crash or a slow decode answers "engine", and the page keeps the live
 *          engine's line. Logs only sizes, states and times, never audio or text.
 * Used by: src/main.ts (installAccurate); tests
 * Depends on: src/accurate/download.ts, src/accurate/model.ts, src/channels.ts,
 *             src/hotkeys.ts (isKiteSender), @kite/shared (types)
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ACCURATE_MAX_SECONDS, type AccurateResult, type AccurateStatus } from '@kite/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  ACCURATE_DOWNLOAD_CHANNEL,
  ACCURATE_REMOVE_CHANNEL,
  ACCURATE_STATUS_CHANNEL,
  ACCURATE_TRANSCRIBE_CHANNEL,
} from '../channels';
import { isKiteSender } from '../hotkeys';
import { bytesOnDisk, downloadModel, isModelReady, removeModel } from './download';
import { MODEL_BYTES, MODEL_FILES } from './model';
import type { FromWorker, ToWorker } from './worker';

/** Decoding threads: as measured in the ADR-0027 trial. */
const THREADS = 4;

/** Longest a decode may take before the page keeps the live line, in ms. */
export const DECODE_TIMEOUT_MS = 15_000;

/** The part of an Electron UtilityProcess used here (tests pass a fake). */
export interface WorkerProcess {
  /** Sends a message to the worker (load, decode). */
  postMessage: (message: ToWorker) => void;
  /** Listens for the worker's replies (loaded, result, failed). */
  on(event: 'message', listener: (message: FromWorker) => void): void;
  /** Listens for the worker stopping (a crash included). */
  on(event: 'exit', listener: (code: number) => void): void;
  /** Stops the worker. */
  kill: () => boolean;
}

/** What installAccurate() needs. */
export interface AccurateDeps {
  /** Electron's ipcMain. */
  ipcMain: Pick<IpcMain, 'handle'>;
  /** The Kite origin (only its main frame may call). */
  allowedOrigins: readonly string[];
  /** Where the model is kept (the app's data folder, models/<MODEL_FOLDER>). */
  modelDir: string;
  /** The staged native runtime folder, or null when this build has none for this computer. */
  nativeDir: string | null;
  /** The bundled worker script (dist/accurate-worker.js). */
  workerPath: string;
  /** Starts the worker (Electron's utilityProcess.fork). */
  fork: (modulePath: string, env: Record<string, string | undefined>) => WorkerProcess;
  /** fetch for the download (tests pass one bound to a local server). */
  fetchImpl?: typeof fetch;
}

/** The handlers, returned for tests. */
export interface AccurateHost {
  /** The status. */
  status: () => Promise<AccurateStatus>;
  /** Starts or resumes the download. */
  download: () => Promise<AccurateStatus>;
  /** Deletes the model. */
  remove: () => Promise<AccurateStatus>;
  /** Transcribes one utterance. */
  transcribe: (samples: unknown) => Promise<AccurateResult>;
}

/**
 * Whether the staged native runtime holds the wrapper and a build for this OS and CPU.
 *
 * @param nativeDir The staged folder.
 * @returns True when the engine can run here.
 */
function hasNativeBuild(nativeDir: string | null): nativeDir is string {
  if (!nativeDir) return false;
  const modules = path.join(nativeDir, 'modules');
  return (
    existsSync(path.join(modules, 'sherpa-onnx-node')) &&
    existsSync(path.join(modules, `sherpa-onnx-${platformArch()}`, 'sherpa-onnx.node'))
  );
}

/**
 * The platform package suffix sherpa-onnx uses ("win" for Windows).
 *
 * @returns For example 'win-x64' or 'darwin-arm64'.
 */
function platformArch(): string {
  return `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
}

/**
 * Creates the handlers (no IPC): the testable core of installAccurate().
 *
 * @param deps Folders, the worker starter and fetch.
 * @returns The handlers.
 * Called from: installAccurate(); tests
 */
export function createAccurateHost(
  deps: Omit<AccurateDeps, 'ipcMain' | 'allowedOrigins'>,
): AccurateHost {
  let downloading: AbortController | null = null;
  let receivedBytes = 0;
  let lastError: string | null = null;
  let worker: WorkerProcess | null = null;
  let loaded: Promise<boolean> | null = null;
  let nextId = 1;
  const pending = new Map<number, (result: AccurateResult) => void>();
  // One decode at a time: the engine uses 4 threads, and the live engine needs the rest.
  let queue: Promise<unknown> = Promise.resolve();

  const status = async (): Promise<AccurateStatus> => {
    const base = { totalBytes: MODEL_BYTES };
    if (!hasNativeBuild(deps.nativeDir)) return { ...base, state: 'unavailable', receivedBytes: 0 };
    if (downloading) return { ...base, state: 'downloading', receivedBytes };
    if (await isModelReady(deps.modelDir, MODEL_FILES)) {
      return { ...base, state: 'ready', receivedBytes: MODEL_BYTES };
    }
    const onDisk = await bytesOnDisk(deps.modelDir, MODEL_FILES);
    return lastError
      ? { ...base, state: 'error', receivedBytes: onDisk, error: lastError }
      : { ...base, state: 'not-downloaded', receivedBytes: onDisk };
  };

  const download = async (): Promise<AccurateStatus> => {
    if (!hasNativeBuild(deps.nativeDir) || downloading) return status();
    if (await isModelReady(deps.modelDir, MODEL_FILES)) return status();
    const controller = new AbortController();
    downloading = controller;
    lastError = null;
    receivedBytes = await bytesOnDisk(deps.modelDir, MODEL_FILES);
    const started = Date.now();
    console.info('desktop: accurate model download', { fromBytes: receivedBytes });
    void downloadModel(deps.modelDir, MODEL_FILES, {
      signal: controller.signal,
      onProgress: (progress) => {
        receivedBytes = progress.receivedBytes;
      },
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    })
      .then(() => {
        console.info('desktop: accurate model ready', { ms: Date.now() - started });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const code = error instanceof Error ? error.message : 'unknown';
        // Plain words for Settings; the code only in the log.
        lastError =
          code === 'CHECKSUM'
            ? 'The download was damaged and has been deleted. Download again.'
            : 'The download stopped. Check the connection and download again: it continues where it stopped.';
        console.warn('desktop: accurate model download failed', { code });
      })
      .finally(() => {
        if (downloading === controller) downloading = null;
      });
    return status();
  };

  const stopWorker = () => {
    worker?.kill();
    worker = null;
    loaded = null;
    for (const resolve of pending.values()) resolve({ ok: false, code: 'engine' });
    pending.clear();
  };

  const remove = async (): Promise<AccurateStatus> => {
    downloading?.abort();
    downloading = null;
    stopWorker();
    lastError = null;
    await removeModel(deps.modelDir);
    return status();
  };

  /**
   * Starts the worker and loads the model once.
   *
   * @returns True when the engine is loaded.
   */
  const ensureLoaded = (): Promise<boolean> => {
    if (loaded) return loaded;
    const nativeDir = deps.nativeDir!;
    // Windows finds the engine's DLLs through PATH (sherpa-onnx-node's documentation).
    const dllDir = path.join(nativeDir, 'modules', `sherpa-onnx-${platformArch()}`);
    const child = deps.fork(deps.workerPath, {
      ...process.env,
      PATH: `${dllDir}${path.delimiter}${process.env.PATH ?? ''}`,
    });
    worker = child;
    loaded = new Promise<boolean>((resolve) => {
      child.on('message', (message) => {
        if (message.type === 'loaded') {
          console.info('desktop: accurate engine loaded', { ms: message.ms });
          resolve(true);
        } else if (message.type === 'result') {
          pending.get(message.id)?.({ ok: true, text: message.text, ms: message.ms });
          pending.delete(message.id);
        } else if (message.id === null) {
          console.warn('desktop: accurate engine failed to load');
          resolve(false);
        } else {
          pending.get(message.id)?.({ ok: false, code: 'engine' });
          pending.delete(message.id);
        }
      });
      child.on('exit', (code) => {
        console.warn('desktop: accurate engine exited', { code });
        resolve(false);
        if (worker === child) stopWorker();
      });
    });
    child.postMessage({ type: 'load', modelDir: deps.modelDir, nativeDir, threads: THREADS });
    return loaded;
  };

  const transcribe = async (samples: unknown): Promise<AccurateResult> => {
    // The page's audio only: a Float32Array of at most 30 s at 16 kHz.
    if (
      !(samples instanceof Float32Array) ||
      samples.length === 0 ||
      samples.length > ACCURATE_MAX_SECONDS * 16_000
    ) {
      return { ok: false, code: 'bad-audio' };
    }
    if ((await status()).state !== 'ready') return { ok: false, code: 'not-ready' };
    const run = queue.then(async (): Promise<AccurateResult> => {
      if (!(await ensureLoaded()) || !worker) return { ok: false, code: 'engine' };
      const id = nextId++;
      return new Promise<AccurateResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, code: 'engine' });
        }, DECODE_TIMEOUT_MS);
        pending.set(id, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        worker!.postMessage({ type: 'decode', id, samples });
      });
    });
    queue = run.catch(() => undefined);
    const result = await run;
    console.info('desktop: accurate transcription', {
      seconds: Math.round(samples.length / 1_600) / 10,
      ok: result.ok,
      ...(result.ok ? { ms: result.ms } : { code: result.code }),
    });
    return result;
  };

  return { status, download, remove, transcribe };
}

/**
 * Answers the page's accurate-transcription requests (Kite origin main frame only).
 *
 * @param deps Electron objects, folders and the worker starter.
 * @returns The handlers (for tests).
 * Called from: start() in main.ts
 */
export function installAccurate(deps: AccurateDeps): AccurateHost {
  const host = createAccurateHost(deps);
  const guard =
    <T>(handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T>) =>
    (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isKiteSender(event, deps.allowedOrigins)) {
        throw new Error('Accurate transcription is only for the Kite page');
      }
      return handler(event, ...args);
    };
  deps.ipcMain.handle(
    ACCURATE_STATUS_CHANNEL,
    guard(() => host.status()),
  );
  deps.ipcMain.handle(
    ACCURATE_DOWNLOAD_CHANNEL,
    guard(() => host.download()),
  );
  deps.ipcMain.handle(
    ACCURATE_REMOVE_CHANNEL,
    guard(() => host.remove()),
  );
  deps.ipcMain.handle(
    ACCURATE_TRANSCRIBE_CHANNEL,
    guard((_event, samples) => host.transcribe(samples)),
  );
  return host;
}
