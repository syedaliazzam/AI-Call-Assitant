/**
 * File: apps/web/src/core/stt/download.ts
 * Purpose: Downloads speech-to-text files (runtime and model) with progress, checks each file's
 *          SHA-256 before it is used, and keeps verified files in Cache Storage so later loads
 *          skip the network. A file that does not match its pinned checksum is never used or
 *          cached.
 * Used by: src/core/stt/stt.worker.ts (runs inside the worker)
 * Depends on: fetch, Cache Storage and Web Crypto (injectable, so tests run in Node);
 *             src/core/stt/models.ts (DownloadFile)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt); ADR-0020
 *
 * Memory: Web Crypto cannot hash a stream, so each file is read whole into one buffer of its
 * pinned size (no second copy) and hashed once. The largest file (the encoder) briefly takes
 * about 190 MB. Cached files were verified before they were stored, so a cached load does not
 * hash again (that would add about a second per load); the cache key contains the SHA-256, so
 * a new pin never reuses an old file.
 */
import type { DownloadFile } from './models';

/** Cache Storage bucket for verified speech-to-text files. */
export const STT_CACHE_NAME = 'kite-stt-v2';

/** Buckets from earlier versions, deleted on load to free disk space (Day 1 spike: ~290 MB). */
export const OLD_STT_CACHE_NAMES: readonly string[] = ['kite-stt-v1'];

/** Why a download failed. */
export type DownloadErrorKind = 'checksum' | 'network' | 'quota' | 'aborted';

/** A download failure, with the file it happened on. */
export class ModelDownloadError extends Error {
  /** What went wrong. */
  readonly kind: DownloadErrorKind;
  /** File name (never contents). */
  readonly file: string;

  /**
   * @param kind    What went wrong.
   * @param file    The file it happened on.
   * @param message Explanation for developers (no secrets, no file contents).
   */
  constructor(kind: DownloadErrorKind, file: string, message: string) {
    super(message);
    this.name = 'ModelDownloadError';
    this.kind = kind;
    this.file = file;
  }
}

/** Progress across all files of one load. */
export interface DownloadProgress {
  /** File currently being read. */
  file: string;
  /** Bytes done across all files. */
  loadedBytes: number;
  /** Bytes in all files. */
  totalBytes: number;
  /** loadedBytes ÷ totalBytes, 0…1. */
  fraction: number;
}

/** One verified file. */
export interface DownloadedFile {
  /** File name. */
  name: string;
  /** Its contents. */
  bytes: ArrayBuffer;
  /** True when it came from Cache Storage. */
  fromCache: boolean;
}

/** The result of downloadModelFiles(). */
export interface DownloadResult {
  /** The verified files, in the order asked for. */
  files: DownloadedFile[];
  /**
   * False when Cache Storage could not be opened (for example when the browser blocks site
   * storage): the files were still downloaded and verified, but the next load downloads again.
   */
  cacheAvailable: boolean;
}

/** The browser APIs download.ts uses (the worker's own by default). */
export interface DownloadDeps {
  /** fetch(). */
  fetch: typeof fetch;
  /** Cache Storage. */
  caches: CacheStorage;
  /** Web Crypto's digest functions. */
  subtle: Pick<SubtleCrypto, 'digest'>;
  /** Origin used to build cache keys, for example 'http://localhost:3000'. */
  origin: string;
}

/** Options for downloadModelFiles(). */
export interface DownloadOptions {
  /** Called as bytes arrive (at most about every 0.5% of the total, and at each file's end). */
  onProgress?: (progress: DownloadProgress) => void;
  /** Cancels the download (rejects with kind 'aborted'). */
  signal?: AbortSignal;
  /** Cache bucket (default STT_CACHE_NAME). */
  cacheName?: string;
  /** API overrides (tests). */
  deps?: Partial<DownloadDeps>;
}

/**
 * Builds the Cache Storage key for a file. It contains the SHA-256, so the same bytes are found
 * whichever source (local or remote) they came from, and a changed pin never matches an old file.
 * The path is a key only, not a real route.
 *
 * @param origin The page's origin.
 * @param file   The file.
 * @returns An absolute URL to use as the cache key.
 * Called from: downloadModelFiles(); tests
 */
export function cacheKey(origin: string, file: Pick<DownloadFile, 'name' | 'sha256'>): string {
  return `${origin}/__kite-stt-cache__/${file.sha256}/${encodeURIComponent(file.name)}`;
}

/**
 * Share of the work done, kept between 0 and 1.
 *
 * @param loaded Bytes done.
 * @param total  Bytes in total.
 * @returns 0…1 (1 when there is nothing to do).
 * Called from: downloadModelFiles(); the dev page progress bar
 */
export function progressFraction(loaded: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, loaded / total));
}

/**
 * Lower-case hex SHA-256 of some bytes.
 *
 * @param bytes  The data.
 * @param subtle Web Crypto digest.
 * @returns 64 hex characters.
 * Called from: downloadModelFiles(); stt.worker.ts (bpe.vocab check)
 */
export async function sha256Hex(
  bytes: ArrayBuffer | Uint8Array,
  subtle: Pick<SubtleCrypto, 'digest'>,
): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await subtle.digest('SHA-256', view as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fills in the worker's own APIs for anything not overridden.
 *
 * @param deps Overrides.
 * @returns Complete dependencies.
 */
function withDefaults(deps: Partial<DownloadDeps> = {}): DownloadDeps {
  return {
    fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
    caches: deps.caches ?? globalThis.caches,
    subtle: deps.subtle ?? globalThis.crypto.subtle,
    origin: deps.origin ?? globalThis.location.origin,
  };
}

/**
 * Turns an exception from fetch or reading the body into a ModelDownloadError.
 *
 * @param error  What was thrown.
 * @param file   File name.
 * @param signal The abort signal, to tell cancellation from network failure.
 * @returns A typed error.
 */
function asDownloadError(error: unknown, file: string, signal?: AbortSignal): ModelDownloadError {
  if (error instanceof ModelDownloadError) return error;
  if (signal?.aborted)
    return new ModelDownloadError('aborted', file, `Download of ${file} was cancelled`);
  const reason = error instanceof Error ? error.message : 'unknown error';
  return new ModelDownloadError('network', file, `Could not download ${file}: ${reason}`);
}

/**
 * Downloads files in order, verifies each one, caches it, and returns their contents.
 * If Cache Storage cannot be opened, it still downloads and verifies, without caching.
 *
 * @param files   Files to load (from resolveDownloads() in models.ts).
 * @param options Progress callback, abort signal, cache name, API overrides.
 * @returns The verified files, in the same order, and whether the cache could be used.
 * @throws ModelDownloadError: 'checksum' (wrong size or SHA-256; the file is discarded),
 *         'network' (fetch failed or HTTP error), 'quota' (Cache Storage is full),
 *         'aborted' (the signal fired).
 * Called from: loadModel() in stt.worker.ts
 */
export async function downloadModelFiles(
  files: readonly DownloadFile[],
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const deps = withDefaults(options.deps);
  const { signal, onProgress } = options;
  // A blocked or broken Cache Storage must not stop transcription: work without it.
  let cache: Cache | null = null;
  try {
    cache = await deps.caches.open(options.cacheName ?? STT_CACHE_NAME);
  } catch {
    cache = null;
  }
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  let doneBytes = 0;
  let lastReported = -1;

  /**
   * Reports progress when it moved by at least 0.5% (so the page is not flooded), or when forced.
   *
   * @param file        Name of the file being downloaded (shown with the progress).
   * @param loadedBytes Bytes of that file received so far.
   * @param force       True at the end of a file, to report even a small step.
   */
  const report = (file: string, loadedBytes: number, force: boolean) => {
    const fraction = progressFraction(loadedBytes, totalBytes);
    if (!force && fraction - lastReported < 0.005) return;
    lastReported = fraction;
    onProgress?.({ file, loadedBytes, totalBytes, fraction });
  };

  const results: DownloadedFile[] = [];
  for (const file of files) {
    if (signal?.aborted) throw new ModelDownloadError('aborted', file.name, 'Download cancelled');
    const key = cacheKey(deps.origin, file);

    // 1. Cache: only verified files are ever stored, so a size check is enough here.
    const cached = cache ? await cache.match(key) : undefined;
    if (cache && cached) {
      const bytes = await cached.arrayBuffer();
      if (bytes.byteLength === file.bytes) {
        doneBytes += file.bytes;
        report(file.name, doneBytes, true);
        results.push({ name: file.name, bytes, fromCache: true });
        continue;
      }
      // A damaged entry (for example a browser crash while writing): drop it and download.
      await cache.delete(key);
    }

    // 2. Network: read into a buffer of exactly the pinned size.
    const bytes = new Uint8Array(file.bytes);
    let received = 0;
    try {
      const response = await deps.fetch(file.url, { signal, redirect: 'follow' });
      if (!response.ok || !response.body) {
        throw new ModelDownloadError(
          'network',
          file.name,
          `HTTP ${response.status} for ${file.name}`,
        );
      }
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > file.bytes) {
          await reader.cancel();
          throw new ModelDownloadError(
            'checksum',
            file.name,
            `${file.name} is larger than expected`,
          );
        }
        bytes.set(value, received);
        received += value.length;
        report(file.name, doneBytes + received, false);
      }
    } catch (error) {
      throw asDownloadError(error, file.name, signal);
    }
    if (received !== file.bytes) {
      throw new ModelDownloadError(
        'checksum',
        file.name,
        `${file.name} has ${received} bytes, expected ${file.bytes}`,
      );
    }

    // 3. Verify before anything else sees the bytes.
    const actual = await sha256Hex(bytes, deps.subtle);
    if (actual !== file.sha256) {
      throw new ModelDownloadError(
        'checksum',
        file.name,
        `${file.name} does not match its pinned SHA-256 (expected ${file.sha256}, got ${actual})`,
      );
    }

    // 4. Cache the verified copy.
    try {
      await cache?.put(key, new Response(bytes));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new ModelDownloadError(
          'quota',
          file.name,
          'Not enough disk space to store the speech model (about 205 MB needed)',
        );
      }
      throw asDownloadError(error, file.name, signal);
    }
    doneBytes += file.bytes;
    report(file.name, doneBytes, true);
    results.push({ name: file.name, bytes: bytes.buffer, fromCache: false });
  }
  return { files: results, cacheAvailable: cache !== null };
}

/**
 * Deletes cached speech-to-text files (current and old buckets).
 *
 * @param storage Cache Storage (default: the page's or worker's own).
 * @param names   Buckets to delete (default: the current one and the old ones).
 * @returns True if anything was deleted.
 * Called from: SttTest.tsx ("Clear model cache"); stt.worker.ts (old buckets only)
 */
export async function clearSttCache(
  storage: CacheStorage = globalThis.caches,
  names: readonly string[] = [STT_CACHE_NAME, ...OLD_STT_CACHE_NAMES],
): Promise<boolean> {
  const deleted = await Promise.all(names.map((name) => storage.delete(name)));
  return deleted.some(Boolean);
}
