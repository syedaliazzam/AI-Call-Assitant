/**
 * File: apps/web/src/core/drive/google.ts
 * Purpose: The Google Drive calls the page makes with a short-lived access token (ADR-0072): find one
 *          of Kite's own folders or files by its private tag (appProperties), make a folder, open a
 *          resumable upload session, upload a file from the page in DRIVE_CHUNK_BYTES chunks, and ask an
 *          upload session how far it got. Every call has supportsAllDrives=true (Shared Drives). A
 *          refused token is fetched again once.
 * Used by: src/core/drive/uploader.ts
 * Depends on: @kite/shared (chunk sizes, folder MIME type, nextOffsetFromRange)
 * Architecture: ADR-0072
 *
 * Tags are SHA-256 hashes, so a session's id never appears in the team's Drive. Nothing here logs.
 */
import {
  DRIVE_CHUNK_BYTES,
  DRIVE_FOLDER_MIME,
  nextOffsetFromRange,
  type DriveUploadResult,
} from '@kite/shared';

/** Drive's files API. */
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/** Drive's upload API. */
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/** Google refused the request (a 4xx other than an expired token): code is the HTTP status. */
export class DriveRequestError extends Error {
  /**
   * @param status The HTTP status (0: Google could not be reached).
   */
  constructor(public readonly status: number) {
    super(`Google Drive answered ${status}`);
    this.name = 'DriveRequestError';
  }
}

/** The fetch (tests pass a fake). */
export type GoogleFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What the client needs. */
export interface DriveClientDeps {
  /** The fetch. */
  fetch: GoogleFetch;
  /**
   * An access token.
   * @param fresh True after Google refused the last one.
   */
  token: (fresh: boolean) => Promise<string>;
}

/** The private tag Kite puts on what it makes (appProperties; only Kite's client can see them). */
export interface DriveTag {
  /** The tag's key ('kiteSession', 'kiteFile'). */
  key: string;
  /** Its value (a hash). */
  value: string;
}

/** The Drive calls. */
export interface DriveClient {
  /**
   * Finds one of Kite's items in a folder by its tags.
   * @param parentId The folder.
   * @param tags     Every tag it must have.
   * @param driveId  The Shared Drive, or null for My Drive.
   * @returns Its id, or null.
   */
  find(parentId: string, tags: DriveTag[], driveId: string | null): Promise<string | null>;
  /**
   * Makes a folder.
   * @param name     Its name.
   * @param parentId Where.
   * @param tags     Its tags.
   * @returns Its id.
   */
  createFolder(name: string, parentId: string, tags: DriveTag[]): Promise<string>;
  /**
   * Opens a resumable upload session for a new file.
   * @param meta The file's name, folder, type, size and tags.
   * @returns The session's address.
   */
  startUpload(meta: {
    name: string;
    parentId: string;
    mimeType: string;
    bytes: number;
    tags: DriveTag[];
  }): Promise<string>;
  /**
   * Uploads a file held by the page, from where Google says it got to.
   * @param uploadUrl  The session's address.
   * @param blob       The file.
   * @param onProgress Called with the bytes Google has.
   * @param stop       Checked between chunks: true pauses (a call started).
   * @returns How it ended (the desktop shell's result shape).
   */
  uploadBlob(
    uploadUrl: string,
    blob: Blob,
    onProgress: (sent: number) => void,
    stop: () => Promise<boolean>,
  ): Promise<DriveUploadResult>;
}

/**
 * A tag's value: the first 32 hex characters of SHA-256 of the text.
 *
 * @param text The text (a session id, or a session id and a file key).
 * @returns The hash.
 * Called from: uploader.ts; tests
 */
export async function tagValue(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Escapes a value inside a Drive query's single quotes.
 * @param value The value.
 * @returns The escaped value.
 */
function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Creates the client.
 *
 * @param deps The fetch and the token source.
 * @returns The client.
 * Called from: uploader deps (features/drive/DriveUploader.tsx); tests
 */
export function createDriveClient(deps: DriveClientDeps): DriveClient {
  /**
   * A request with the token; a 401 gets a new token and is sent once more.
   * @param url  The address.
   * @param init The options (the Authorization header is added).
   * @returns The reply.
   * @throws DriveRequestError(0) when Google cannot be reached.
   */
  const authed = async (url: string, init: RequestInit = {}): Promise<Response> => {
    for (const fresh of [false, true]) {
      const token = await deps.token(fresh);
      let response: Response;
      try {
        response = await deps.fetch(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        throw new DriveRequestError(0);
      }
      if (response.status !== 401 || fresh) return response;
    }
    throw new DriveRequestError(401);
  };

  /**
   * Reads JSON from a reply that must be OK.
   * @param response The reply.
   * @returns The JSON.
   * @throws DriveRequestError otherwise.
   */
  const json = async <T>(response: Response): Promise<T> => {
    if (!response.ok) throw new DriveRequestError(response.status);
    return (await response.json()) as T;
  };

  const props = (tags: DriveTag[]) => Object.fromEntries(tags.map((tag) => [tag.key, tag.value]));

  return {
    async find(parentId, tags, driveId) {
      const q = [
        `'${quote(parentId)}' in parents`,
        'trashed = false',
        ...tags.map(
          (tag) => `appProperties has { key='${quote(tag.key)}' and value='${quote(tag.value)}' }`,
        ),
      ].join(' and ');
      const url = new URL(FILES_URL);
      url.searchParams.set('q', q);
      url.searchParams.set('fields', 'files(id)');
      url.searchParams.set('pageSize', '1');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      if (driveId) {
        url.searchParams.set('corpora', 'drive');
        url.searchParams.set('driveId', driveId);
      } else {
        url.searchParams.set('corpora', 'user');
      }
      const out = await json<{ files?: { id: string }[] }>(await authed(url.toString()));
      return out.files?.[0]?.id ?? null;
    },

    async createFolder(name, parentId, tags) {
      const url = `${FILES_URL}?supportsAllDrives=true&fields=id`;
      const out = await json<{ id: string }>(
        await authed(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({
            name,
            mimeType: DRIVE_FOLDER_MIME,
            parents: [parentId],
            appProperties: props(tags),
          }),
        }),
      );
      return out.id;
    },

    async startUpload(meta) {
      const url = `${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id`;
      const response = await authed(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': meta.mimeType,
          'X-Upload-Content-Length': String(meta.bytes),
        },
        body: JSON.stringify({
          name: meta.name,
          parents: [meta.parentId],
          appProperties: props(meta.tags),
        }),
      });
      if (!response.ok) throw new DriveRequestError(response.status);
      const location = response.headers.get('location');
      if (!location) throw new DriveRequestError(502);
      return location;
    },

    async uploadBlob(uploadUrl, blob, onProgress, stop) {
      const total = blob.size;
      /**
       * Sends one PUT to the session.
       * @param headers  Its headers.
       * @param body     Its bytes, or null for a status question.
       * @returns The reply, or null when Google could not be reached.
       */
      const put = async (headers: Record<string, string>, body: Blob | null) => {
        try {
          // With the token (fetched again once on a 401), as for every other Drive call.
          return await authed(uploadUrl, { method: 'PUT', headers, body });
        } catch {
          return null;
        }
      };
      /**
       * Reads a finished upload's file id.
       * @param response The 200/201 reply.
       * @returns The done result.
       */
      const finished = async (response: Response): Promise<DriveUploadResult> => {
        const file = (await response.json()) as { id?: string };
        return file.id
          ? { status: 'done', fileId: file.id, bytes: total }
          : { status: 'failed', retryable: true, reason: 'no-id' };
      };
      // Where Google got to (a restart, or a lost connection): "bytes */total" asks without sending.
      const asked = await put({ 'Content-Range': `bytes */${total}` }, null);
      if (!asked) return { status: 'failed', retryable: true, reason: 'network' };
      if (asked.status === 200 || asked.status === 201) return finished(asked);
      if (asked.status === 404 || asked.status === 410) return { status: 'expired' };
      if (asked.status !== 308) {
        return {
          status: 'failed',
          retryable: asked.status >= 500,
          reason: `http-${asked.status}`,
        };
      }
      let offset = nextOffsetFromRange(asked.headers.get('range'));
      onProgress(offset);
      while (offset < total || total === 0) {
        if (await stop()) return { status: 'paused', offset, bytes: total };
        const end = Math.min(offset + DRIVE_CHUNK_BYTES, total);
        const response = await put(
          {
            'Content-Range': total === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${total}`,
          },
          blob.slice(offset, end),
        );
        if (!response) return { status: 'failed', retryable: true, reason: 'network' };
        if (response.status === 200 || response.status === 201) {
          onProgress(total);
          return finished(response);
        }
        if (response.status === 404 || response.status === 410) return { status: 'expired' };
        if (response.status !== 308) {
          return {
            status: 'failed',
            retryable: response.status >= 500,
            reason: `http-${response.status}`,
          };
        }
        // Google may keep less than was sent; its Range says how much. Without the header (some
        // browsers hide it), the whole chunk counts as kept.
        const range = response.headers.get('range');
        offset = range ? nextOffsetFromRange(range) : end;
        onProgress(offset);
      }
      return { status: 'failed', retryable: true, reason: 'incomplete' };
    },
  };
}
