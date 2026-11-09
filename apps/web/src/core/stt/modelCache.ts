/**
 * File: apps/web/src/core/stt/modelCache.ts
 * Purpose: The speech model as the desktop Connect card sees it (ADR-0055): whether every file the
 *          speech engine needs is already in this app's Cache Storage, how large the one-time download
 *          is, and the download itself (with progress). The files and their order are exactly those the
 *          engine's worker loads (sttEngine.ts → stt.worker.ts), and download.ts verifies each one's
 *          SHA-256 before caching it, so the call that follows loads them from the cache.
 * Used by: src/features/home/LauncherConnect.tsx; tests/unit/core/stt/modelCache.test.ts
 * Depends on: ./models.ts (the pinned files, resolveDownloads, pickModelSource),
 *             ./download.ts (downloadModelFiles, cacheKey, STT_CACHE_NAME)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt); ADR-0020, ADR-0055
 */
import { cacheKey, downloadModelFiles, STT_CACHE_NAME, type DownloadProgress } from './download';
import {
  DEFAULT_STT_MODEL,
  getSttModel,
  pickModelSource,
  resolveDownloads,
  type DownloadFile,
  type ModelSource,
} from './models';

/**
 * The files the speech engine loads, in the worker's order.
 *
 * @param origin The page's origin (the runtime, and local model files, are served from it).
 * @param source Where the model files come from (default: this build's choice, as sttEngine.ts makes it).
 * @returns The files.
 * Called from: speechModelCached(), downloadSpeechModel(), speechModelBytes(); tests
 */
export function speechModelFiles(
  origin: string,
  source: ModelSource = pickModelSource(process.env.NEXT_PUBLIC_STT_SOURCE, process.env.NODE_ENV),
): DownloadFile[] {
  const { runtime, model } = resolveDownloads(getSttModel(DEFAULT_STT_MODEL), source, origin);
  // The same order as loadModel() in stt.worker.ts.
  return [
    runtime.wasm,
    runtime.loader,
    runtime.api,
    model.encoder,
    model.decoder,
    model.joiner,
    model.tokens,
    model.bpeModel,
  ] as DownloadFile[];
}

/**
 * The one-time download's size.
 *
 * @param origin The page's origin.
 * @returns Bytes (about 204 MB).
 * Called from: LauncherConnect.tsx; tests
 */
export function speechModelBytes(origin: string): number {
  return speechModelFiles(origin).reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * Whether every file of the speech model is already cached on this computer. Cache Storage belongs to
 * the app's address, so every window of the app sees the same files. A blocked Cache Storage counts as
 * "not cached": the download then still works (download.ts works without a cache).
 *
 * @param origin  The page's origin.
 * @param storage Cache Storage (tests pass a fake).
 * @returns True when nothing needs downloading.
 * Called from: LauncherConnect.tsx; tests
 */
export async function speechModelCached(
  origin: string,
  storage: CacheStorage = globalThis.caches,
): Promise<boolean> {
  try {
    if (!(await storage.has(STT_CACHE_NAME))) return false;
    const cache = await storage.open(STT_CACHE_NAME);
    for (const file of speechModelFiles(origin)) {
      if (!(await cache.match(cacheKey(origin, file)))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads, verifies and caches the speech model (files already cached are skipped).
 *
 * @param origin     The page's origin.
 * @param onProgress Progress across all files.
 * @param signal     Cancels the download.
 * @returns Resolves when every file is cached.
 * @throws ModelDownloadError from download.ts ('network', 'checksum', 'quota', 'aborted').
 * Called from: LauncherConnect.tsx
 */
export async function downloadSpeechModel(
  origin: string,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  await downloadModelFiles(speechModelFiles(origin), {
    onProgress,
    ...(signal ? { signal } : {}),
    deps: { origin },
  });
}
