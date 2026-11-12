/**
 * File: apps/desktop/src/drive/upload.ts
 * Purpose: Uploads one of this computer's recording files to a Google Drive resumable upload session
 *          (desktop 1.6.0, ADR-0072). The page opens the session and names the recording; the shell checks
 *          the request, takes the file from its own Recordings index (never a path from the page), asks
 *          Google how far it got, and sends the rest in DRIVE_CHUNK_BYTES chunks, only to Google's upload
 *          host. While a call is live it stops between chunks (and cuts off a chunk in flight), so the
 *          call keeps the computer's CPU and bandwidth; the page resumes it after the call. A lost
 *          connection is retried a few times with a pause, then reported as retryable.
 *          1.6.2 (ADR-0074): no Google token: the session address the server started is the only
 *          credential, so no Authorization header is sent; the page passes the offset the server says
 *          Google has (the shell starts there without asking), and a finished upload reports the whole
 *          file's MD5 for the server's check. The page also asks the size of a file (fileSize).
 * Used by: src/drive/host.ts; tests/unit/drive.test.ts
 * Depends on: node:fs/promises, @kite/shared (the Drive upload contract, chunk sizes, URL checks)
 * Architecture: docs/decisions/ADR-0072-google-drive-saving.md, ADR-0074; architecture §7.3
 *
 * Never logs a token, an address or what a file holds: ids, sizes, statuses and times only.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import {
  DRIVE_CHUNK_BYTES,
  DRIVE_CHUNK_UNIT,
  isDriveUploadUrl,
  nextOffsetFromRange,
  type DriveUploadProgress,
  type DriveUploadRequest,
  type DriveUploadResult,
  type RecordingTrack,
} from '@kite/shared';

/** A UUID, as the page makes them. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest access token accepted, characters (Google's are far shorter). */
const MAX_TOKEN_CHARS = 4_096;

/** How many times a lost connection is retried before the upload reports it, per request. */
export const NETWORK_RETRIES = 3;

/** The pause before a retry, ms (doubled each time). */
export const RETRY_DELAY_MS = 2_000;

/** What the uploader needs (tests pass fakes). */
export interface DriveUploaderDeps {
  /**
   * The file of a recording in the shell's index, when it is on this computer and not being written.
   * @param recordingId The recording.
   * @param track       Its main file or its stereo file.
   */
  fileOf(recordingId: string, track: RecordingTrack): string | null;
  /**
   * Electron's net.fetch (the system's proxy settings apply).
   * @param url  The address.
   * @param init The request.
   */
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** True while a call is live. */
  callActive(): boolean;
  /**
   * Waits.
   * @param ms How long.
   */
  sleep(ms: number): Promise<void>;
  /** The chunk size (tests use a small multiple of 256 KiB). */
  chunkBytes?: number;
}

/** The uploader. */
export interface DriveUploader {
  /**
   * Uploads a file (one upload per file at a time).
   * @param request    What arrived over IPC (checked here: the page is not trusted).
   * @param onProgress Called after each chunk.
   * @returns How it ended.
   */
  upload(
    request: unknown,
    onProgress: (progress: DriveUploadProgress) => void,
  ): Promise<DriveUploadResult>;
  /** A call started: every upload stops now (a chunk in flight is cut off; Google keeps what it got). */
  pauseAll(): void;
  /**
   * 1.6.2 (ADR-0074): one recording file's size, from the Recordings index only.
   * @param request What arrived over IPC ({ recordingId, track }; checked here).
   * @returns The size in bytes, or null when the request is not valid or the file is not here.
   */
  fileSize(request: unknown): Promise<number | null>;
}

/**
 * The MD5 of a whole file (hex, Drive's md5Checksum form), read in a stream.
 * @param file The file.
 * @returns The digest.
 * @throws When the file cannot be read.
 */
function md5Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Whether a value is an upload request the shell accepts.
 * @param value What arrived over IPC.
 * @returns True for a well-formed request to a Drive upload session.
 * Called from: upload(); tests
 */
export function isUploadRequest(value: unknown): value is DriveUploadRequest {
  const r = value as Partial<DriveUploadRequest> | null;
  return (
    !!r &&
    typeof r.recordingId === 'string' &&
    UUID.test(r.recordingId) &&
    (r.track === 'main' || r.track === 'stereo') &&
    typeof r.uploadUrl === 'string' &&
    isDriveUploadUrl(r.uploadUrl) &&
    // 1.6.2 (ADR-0074): no token is sent any more; one from an older page is still accepted.
    (r.accessToken === undefined ||
      (typeof r.accessToken === 'string' &&
        r.accessToken.length > 0 &&
        r.accessToken.length <= MAX_TOKEN_CHARS)) &&
    (r.startOffset === undefined ||
      (typeof r.startOffset === 'number' &&
        Number.isSafeInteger(r.startOffset) &&
        r.startOffset >= 0))
  );
}

/**
 * Creates the uploader.
 * @param deps The index lookup, fetch, call state and clock.
 * @returns The uploader.
 * Called from: installDrive() in host.ts; tests
 */
export function createDriveUploader(deps: DriveUploaderDeps): DriveUploader {
  const chunkBytes = deps.chunkBytes ?? DRIVE_CHUNK_BYTES;
  if (chunkBytes % DRIVE_CHUNK_UNIT !== 0)
    throw new Error('chunk size must be a multiple of 256 KiB');
  /** The uploads running, by recording and track, each with its way to cut off a chunk. */
  const running = new Map<string, AbortController>();

  return {
    async upload(request, onProgress) {
      if (!isUploadRequest(request))
        return { status: 'failed', retryable: false, reason: 'invalid' };
      const key = `${request.recordingId}:${request.track}`;
      if (running.has(key)) return { status: 'failed', retryable: true, reason: 'busy' };
      const file = deps.fileOf(request.recordingId, request.track);
      if (!file) return { status: 'missing' };
      let size: number;
      try {
        size = (await stat(file)).size;
      } catch {
        return { status: 'missing' };
      }
      if (deps.callActive()) return { status: 'paused', offset: 0, bytes: size };

      const controller = new AbortController();
      running.set(key, controller);
      // 1.6.2: the session address is the credential; a token is sent only if an older page gave one.
      const auth: Record<string, string> = request.accessToken
        ? { Authorization: `Bearer ${request.accessToken}` }
        : {};
      const report = (sent: number) =>
        onProgress({ recordingId: request.recordingId, track: request.track, sent, total: size });

      /**
       * Sends one request, retrying a lost connection a few times.
       * @param headers The request's headers.
       * @param body    Its bytes, or undefined for the status question.
       * @returns The reply, 'aborted' (a call started), or 'network' (still unreachable).
       */
      const send = async (
        headers: Record<string, string>,
        body?: Uint8Array,
      ): Promise<Response | 'aborted' | 'network'> => {
        for (let attempt = 0; ; attempt += 1) {
          if (controller.signal.aborted) return 'aborted';
          try {
            return await deps.fetch(request.uploadUrl, {
              method: 'PUT',
              headers: { ...auth, ...headers },
              ...(body ? { body: body as BodyInit } : {}),
              signal: controller.signal,
            });
          } catch {
            if (controller.signal.aborted) return 'aborted';
            if (attempt >= NETWORK_RETRIES) return 'network';
            await deps.sleep(RETRY_DELAY_MS * 2 ** attempt);
          }
        }
      };

      /**
       * Turns a reply into the next step: a result to return, or the next offset.
       * @param reply   The reply.
       * @param known   The offset Google surely has (reported when the upload stops here).
       * @param assumed The offset to assume when a 308 has no Range header (the chunk was kept).
       * @returns The result, or { offset }.
       */
      const read = async (
        reply: Response | 'aborted' | 'network',
        known: number,
        assumed: number,
      ): Promise<DriveUploadResult | { offset: number }> => {
        if (reply === 'aborted') {
          return deps.callActive()
            ? { status: 'paused', offset: known, bytes: size }
            : { status: 'failed', retryable: true, reason: 'aborted' };
        }
        if (reply === 'network') return { status: 'failed', retryable: true, reason: 'network' };
        if (reply.status === 200 || reply.status === 201) {
          const json = (await reply.json().catch(() => ({}))) as { id?: unknown };
          if (typeof json.id !== 'string') {
            return { status: 'failed', retryable: true, reason: 'no-id' };
          }
          // ADR-0074: the whole file's MD5, for the server's check (best effort).
          const md5 = await md5Of(file).catch(() => undefined);
          return { status: 'done', fileId: json.id, bytes: size, ...(md5 ? { md5 } : {}) };
        }
        if (reply.status === 308) {
          const range = reply.headers.get('range');
          return { offset: range ? nextOffsetFromRange(range) : assumed };
        }
        // With a token (an older page): it expired. Without one, the session itself is refused.
        if (reply.status === 401) {
          return request.accessToken
            ? { status: 'auth', offset: known, bytes: size }
            : { status: 'expired' };
        }
        if (reply.status === 404 || reply.status === 410) return { status: 'expired' };
        return {
          status: 'failed',
          retryable: reply.status >= 500 || reply.status === 429,
          reason: `http-${reply.status}`,
        };
      };

      let handle: Awaited<ReturnType<typeof open>> | null = null;
      try {
        // Where Google got to: from the server (1.6.2), or "bytes */size" asks without sending.
        let step: DriveUploadResult | { offset: number } =
          request.startOffset !== undefined && request.startOffset <= size
            ? { offset: request.startOffset }
            : await read(await send({ 'Content-Range': `bytes */${size}` }), 0, 0);
        if ('status' in step) return step;
        let offset = step.offset;
        report(offset);
        handle = await open(file, 'r');
        while (offset < size || size === 0) {
          if (deps.callActive()) return { status: 'paused', offset, bytes: size };
          const end = Math.min(offset + chunkBytes, size);
          const chunk = new Uint8Array(end - offset);
          if (chunk.byteLength > 0) {
            const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
            if (bytesRead !== chunk.byteLength) {
              return { status: 'failed', retryable: true, reason: 'read' };
            }
          }
          const range = size === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${size}`;
          step = await read(await send({ 'Content-Range': range }, chunk), offset, end);
          if ('status' in step) {
            if (step.status === 'done') report(size);
            return step;
          }
          // Google may keep less than was sent; its Range says how much (no header: all of it).
          offset = step.offset;
          report(offset);
        }
        return { status: 'failed', retryable: true, reason: 'incomplete' };
      } catch {
        return { status: 'failed', retryable: true, reason: 'read' };
      } finally {
        running.delete(key);
        await handle?.close().catch(() => undefined);
      }
    },

    pauseAll() {
      for (const controller of running.values()) controller.abort();
    },

    async fileSize(request) {
      const r = request as { recordingId?: unknown; track?: unknown } | null;
      if (
        !r ||
        typeof r.recordingId !== 'string' ||
        !UUID.test(r.recordingId) ||
        (r.track !== 'main' && r.track !== 'stereo')
      ) {
        return null;
      }
      const file = deps.fileOf(r.recordingId, r.track);
      if (!file) return null;
      try {
        return (await stat(file)).size;
      } catch {
        return null;
      }
    },
  };
}
