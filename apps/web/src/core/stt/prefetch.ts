/**
 * File: apps/web/src/core/stt/prefetch.ts
 * Purpose: Gets the speech model ready in the background in the desktop app (v1.3.1, ADR-0059), so
 *          Connect never asks for a download. The desktop launcher starts it when the app opens; it
 *          checks Cache Storage and, if a file is missing, loads it with the same verified download
 *          as before (modelCache.ts → download.ts). In the installed app those addresses are answered
 *          from the copy shipped in the installer (apps/desktop/src/speechModel.ts), so this is a
 *          quick local copy; when that copy is missing or damaged, the addresses reach the network
 *          and this becomes the silent download. Connect waits for it, showing progress only if it
 *          is still running.
 *          One prefetch per page and origin: a second start() while it runs joins it; a start()
 *          after a failure tries again.
 * Used by: src/features/home/Launcher.tsx (start when the app opens),
 *          src/features/home/LauncherConnect.tsx (wait on Connect, progress)
 * Depends on: ./modelCache.ts (speechModelCached, downloadSpeechModel), ./download.ts (types)
 * Architecture: docs/decisions/ADR-0059-speech-model-in-the-desktop-installer.md; ADR-0055
 */
import type { DownloadProgress } from './download';
import { downloadSpeechModel, speechModelCached } from './modelCache';

/** Where the background preparation is. */
export type PrefetchState =
  | {
      /**
       * 'idle': not started on this page yet; 'checking': looking in Cache Storage; 'ready': every
       * file is cached and verified; 'failed': the download failed (no connection, a checksum, a
       * full disk), and start() tries again.
       */
      kind: 'idle' | 'checking' | 'ready' | 'failed';
    }
  | {
      /** Loading files (from the installer's copy, or the network). */
      kind: 'downloading';
      /** Progress across all files, once the first report arrives. */
      progress: DownloadProgress | null;
    };

/** The background preparation of one origin's speech model. */
export interface SpeechModelPrefetch {
  /**
   * The current state.
   *
   * @returns The state (the same object until it changes, for useSyncExternalStore).
   */
  state(): PrefetchState;
  /**
   * Listens for changes.
   *
   * @param listener Called after every change.
   * @returns Stops listening.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Starts (or joins) the preparation.
   *
   * @returns True when the model is ready, false when it failed.
   */
  start(): Promise<boolean>;
}

/** What the prefetch uses (tests pass fakes). */
export interface PrefetchDeps {
  /** Whether every file is cached. */
  cached: (origin: string) => Promise<boolean>;
  /** Downloads, verifies and caches the missing files. */
  download: (origin: string, onProgress: (progress: DownloadProgress) => void) => Promise<void>;
}

/**
 * Creates the background preparation for one origin.
 *
 * @param origin The page's origin.
 * @param deps   The cache check and the download (default: modelCache.ts).
 * @returns The prefetch.
 * Called from: speechModelPrefetch(); tests
 */
export function createSpeechModelPrefetch(
  origin: string,
  deps: PrefetchDeps = {
    cached: (at) => speechModelCached(at),
    download: (at, onProgress) => downloadSpeechModel(at, onProgress),
  },
): SpeechModelPrefetch {
  let state: PrefetchState = { kind: 'idle' };
  let running: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: PrefetchState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const run = async (): Promise<boolean> => {
    set({ kind: 'checking' });
    try {
      if (!(await deps.cached(origin))) {
        set({ kind: 'downloading', progress: null });
        await deps.download(origin, (progress) => set({ kind: 'downloading', progress }));
      }
      set({ kind: 'ready' });
      return true;
    } catch {
      // Only the outcome is kept: nothing about the files or the network goes to the console.
      set({ kind: 'failed' });
      return false;
    }
  };

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (state.kind === 'ready') return Promise.resolve(true);
      if (!running) {
        running = run().finally(() => {
          running = null;
        });
      }
      return running;
    },
  };
}

/** One prefetch per origin for this page. */
const prefetches = new Map<string, SpeechModelPrefetch>();

/**
 * The page's prefetch for an origin (created on first use).
 *
 * @param origin The page's origin.
 * @returns The prefetch.
 * Called from: Launcher.tsx, LauncherConnect.tsx
 */
export function speechModelPrefetch(origin: string): SpeechModelPrefetch {
  let prefetch = prefetches.get(origin);
  if (!prefetch) {
    prefetch = createSpeechModelPrefetch(origin);
    prefetches.set(origin, prefetch);
  }
  return prefetch;
}
