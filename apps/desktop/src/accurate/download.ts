/**
 * File: apps/desktop/src/accurate/download.ts
 * Purpose: Downloads the accurate-transcription model (ADR-0034) so that it can be trusted and an
 *          interrupted download is not started over: each file goes to "<name>.part", continues
 *          from where it stopped with an HTTP Range request, is checked against its SHA-256, and
 *          only then is renamed to its real name, with a "<name>.ok" marker holding its hash. A
 *          file that fails the check is deleted and the download fails with CHECKSUM. Only sizes
 *          and times are ever logged by the caller.
 * Used by: src/accurate/host.ts; tests
 * Depends on: Node's fs, crypto and stream; src/accurate/model.ts (ModelFile)
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md (download rules)
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { ModelFile } from './model';

/** What downloadModel() reports as it goes. */
export interface DownloadProgress {
  /** Bytes of the model on disk so far (finished files plus partial ones). */
  receivedBytes: number;
  /** The model's total size. */
  totalBytes: number;
}

/** Options for downloadModel(). */
export interface DownloadOptions {
  /** fetch to use (tests pass one bound to a local server). */
  fetchImpl?: typeof fetch;
  /** Called after each piece written (at most a few times a second is up to the caller). */
  onProgress?: (progress: DownloadProgress) => void;
  /** Stops the download; the partial file is kept, so the next download resumes it. */
  signal?: AbortSignal;
}

/**
 * The SHA-256 of a file on disk, read as a stream (the encoder is 652 MB).
 *
 * @param file The file.
 * @returns Lower-case hex.
 */
async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * The size of a file, or 0 when it does not exist.
 *
 * @param file The file.
 * @returns Its size in bytes.
 */
async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

/**
 * Whether a file is in place and was checked (its "<name>.ok" marker holds the expected hash).
 * Cheap: it does not read the file again.
 *
 * @param dir  The model folder.
 * @param file The file.
 * @returns True when the file is ready.
 */
async function isChecked(dir: string, file: ModelFile): Promise<boolean> {
  const final = path.join(dir, file.name);
  try {
    const marker = (await readFile(`${final}.ok`, 'utf8')).trim();
    return marker === file.sha256 && (await sizeOf(final)) === file.size;
  } catch {
    return false;
  }
}

/**
 * Whether every model file is downloaded and checked.
 *
 * @param dir   The model folder.
 * @param files The model's files.
 * @returns True when the model is ready to load.
 * Called from: host.ts (status); tests
 */
export async function isModelReady(dir: string, files: readonly ModelFile[]): Promise<boolean> {
  for (const file of files) if (!(await isChecked(dir, file))) return false;
  return true;
}

/**
 * Bytes of the model on disk: checked files in full, plus any partial downloads.
 *
 * @param dir   The model folder.
 * @param files The model's files.
 * @returns The byte count (for the progress bar after a restart).
 * Called from: host.ts (status); downloadModel()
 */
export async function bytesOnDisk(dir: string, files: readonly ModelFile[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    total += (await isChecked(dir, file))
      ? file.size
      : Math.min(file.size, await sizeOf(path.join(dir, `${file.name}.part`)));
  }
  return total;
}

/**
 * Downloads every missing model file, resuming partial ones, and checks each against its
 * SHA-256 before it is used.
 *
 * @param dir     The model folder (created when missing).
 * @param files   The model's files.
 * @param options fetch, progress and cancel.
 * @returns Resolves when every file is in place and checked.
 * @throws Error('CHECKSUM') when a file does not match its hash (it is deleted, so the next
 *         download fetches it again); Error('HTTP <status>') for a failed request; the abort
 *         error when cancelled.
 * Called from: host.ts (startDownload); tests
 */
export async function downloadModel(
  dir: string,
  files: readonly ModelFile[],
  options: DownloadOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  await mkdir(dir, { recursive: true });
  let doneBytes = 0;
  for (const file of files) {
    const final = path.join(dir, file.name);
    const partial = `${final}.part`;
    if (await isChecked(dir, file)) {
      doneBytes += file.size;
      continue;
    }
    // A stale file without its marker (an older, interrupted run) is checked, not trusted.
    if ((await sizeOf(final)) === file.size && (await sha256Of(final)) === file.sha256) {
      await writeFile(`${final}.ok`, file.sha256);
      doneBytes += file.size;
      continue;
    }
    await rm(final, { force: true });
    let offset = await sizeOf(partial);
    if (offset > file.size) {
      await rm(partial, { force: true });
      offset = 0;
    }
    if (offset < file.size) {
      const response = await fetchImpl(file.url, {
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
        ...(options.signal ? { signal: options.signal } : {}),
      });
      // 206: the server continues where we stopped. 200: it ignored the Range, so start over.
      const resumed = response.status === 206;
      if (!resumed && response.status !== 200) throw new Error(`HTTP ${response.status}`);
      if (!resumed) offset = 0;
      if (!response.body) throw new Error('HTTP empty body');
      let written = offset;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length;
          options.onProgress?.({ receivedBytes: doneBytes + written, totalBytes });
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
        counter,
        createWriteStream(partial, { flags: resumed ? 'a' : 'w' }),
        ...(options.signal ? [{ signal: options.signal }] : []),
      );
    }
    if ((await sizeOf(partial)) !== file.size || (await sha256Of(partial)) !== file.sha256) {
      // Corrupt or tampered: never used, and not resumed from (it would stay wrong).
      await rm(partial, { force: true });
      throw new Error('CHECKSUM');
    }
    await rename(partial, final);
    await writeFile(`${final}.ok`, file.sha256);
    doneBytes += file.size;
    options.onProgress?.({ receivedBytes: doneBytes, totalBytes });
  }
}

/**
 * Deletes the model folder (finished and partial files).
 *
 * @param dir The model folder.
 * @returns Resolves when it is gone.
 * Called from: host.ts (remove)
 */
export async function removeModel(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
