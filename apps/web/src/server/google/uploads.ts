/**
 * File: apps/web/src/server/google/uploads.ts
 * Purpose: The server's own Google Drive calls, made with the company account's token (ADR-0074), which
 *          never leaves the server: tags that bind a folder or file to one person's session; finding or
 *          making the session folder and its Recordings and Transcripts in the company folder; starting a
 *          resumable upload (the client gets only that upload's session address, with a signed ticket
 *          for that one file); asking an upload where it got to; uploading the page's own small files
 *          (multipart); and reading a file to verify it (tag, size, MD5).
 * Used by: src/server/google/api.ts; tests
 * Depends on: node:crypto, @kite/shared (folder MIME type, Range parsing), src/server/google/oauth.ts
 *             (errors, FetchLike)
 * Architecture: ADR-0074 (folders and tags as ADR-0072)
 *
 * Nothing here logs; file contents are held in memory only for the one request.
 */
import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DRIVE_FOLDER_MIME, nextOffsetFromRange } from '@kite/shared';
import { GoogleRefusedError, GoogleUnavailableError, type FetchLike } from './oauth';

/** Drive's files endpoint. */
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/** Drive's upload endpoint. */
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/** How long an upload ticket is accepted, ms (Google keeps a session about a week). */
export const TICKET_TTL_MS = 6 * 24 * 60 * 60_000;

/** The largest file the page may send through the server (Vercel's body limit is 4.5 MB). */
export const MAX_SMALL_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The subfolders of a session folder. */
export type DriveSubfolder = 'Recordings' | 'Transcripts';

/** A Drive app property used as a tag (appProperties). */
export interface DriveTag {
  /** The property's name. */
  key: string;
  /** Its value. */
  value: string;
}

/**
 * A tag value: the first 32 hex characters of SHA-256 over the parts, so Drive never holds an id.
 *
 * @param parts The parts (account, session, file key).
 * @returns The value.
 * Called from: the tag functions below; tests
 */
export function tagValue(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

/**
 * The tags of a session's folder or one of its subfolders: bound to the account AND the session, so a
 * request for another person's session never finds their folders.
 *
 * @param userId    The account.
 * @param sessionId The session.
 * @param folder    'session', 'Recordings' or 'Transcripts'.
 * @returns The tags.
 * Called from: ensureSessionFolders(), findSubfolder(); tests
 */
export function folderTags(
  userId: string,
  sessionId: string,
  folder: 'session' | DriveSubfolder,
): DriveTag[] {
  return [
    { key: 'kiteSession', value: tagValue(userId, sessionId) },
    { key: 'kiteFolder', value: folder },
  ];
}

/**
 * The tag of one file: bound to the account, the session and the file's stable key.
 *
 * @param userId    The account.
 * @param sessionId The session.
 * @param key       The file's key ('rec:<id>:main', 'call:<start>:notes-pdf', …).
 * @returns The tag.
 * Called from: api.ts (uploads, small files, notify); tests
 */
export function fileTag(userId: string, sessionId: string, key: string): DriveTag {
  return { key: 'kiteFile', value: tagValue(userId, sessionId, key) };
}

/** A file as Drive describes it, for verification. */
export interface DriveFileFacts {
  /** Its id. */
  id: string;
  /** Its size in bytes (Drive's), or null. */
  size: number | null;
  /** Its MD5 (hex), or null. */
  md5: string | null;
  /** Its app properties. */
  appProperties: Record<string, string>;
  /** True when it is in the bin. */
  trashed: boolean;
}

/** Drive calls with one access token. */
export interface DriveServer {
  /**
   * The first file or folder in a folder with every tag.
   * @param parentId The folder.
   * @param tags     The tags.
   * @param driveId  Its Shared Drive, or null for My Drive.
   */
  find(parentId: string, tags: DriveTag[], driveId: string | null): Promise<string | null>;
  /**
   * Makes a folder.
   * @param name     Its name.
   * @param parentId Where.
   * @param tags     Its tags.
   */
  createFolder(name: string, parentId: string, tags: DriveTag[]): Promise<string>;
  /**
   * Starts a resumable upload and returns its session address.
   * @param meta The file's name, folder, type, size and tags.
   */
  startUpload(meta: {
    /** Its name. */
    name: string;
    /** Its folder. */
    parentId: string;
    /** Its type. */
    mimeType: string;
    /** Its size. */
    bytes: number;
    /** Its tags. */
    tags: DriveTag[];
  }): Promise<string>;
  /**
   * Uploads a small file in one request.
   * @param meta  The file's name, folder, type and tags.
   * @param bytes Its bytes.
   */
  uploadSmall(
    meta: {
      /** Its name. */
      name: string;
      /** Its folder. */
      parentId: string;
      /** Its type. */
      mimeType: string;
      /** Its tags. */
      tags: DriveTag[];
    },
    bytes: Uint8Array,
  ): Promise<DriveFileFacts>;
  /**
   * Reads a file's facts, or null when Drive (with this token) cannot find it.
   * @param fileId The file.
   */
  file(fileId: string): Promise<DriveFileFacts | null>;
  /**
   * Moves a file the app made to the bin (a verified mismatch, so the next upload starts clean).
   * @param fileId The file.
   */
  trash(fileId: string): Promise<void>;
  /**
   * Asks an upload where it got to.
   * @param uploadUrl Its session address.
   * @param bytes     Its size.
   */
  offset(
    uploadUrl: string,
    bytes: number,
  ): Promise<
    { state: 'partial'; offset: number } | { state: 'done'; fileId: string } | { state: 'expired' }
  >;
}

/**
 * Escapes a value for a Drive search.
 * @param value The value.
 * @returns It, safe between single quotes.
 */
function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Reads a Drive file's facts from its JSON.
 * @param json The JSON.
 * @returns The facts, or null when it has no id.
 */
function factsOf(json: Record<string, unknown>): DriveFileFacts | null {
  if (typeof json.id !== 'string') return null;
  const size = typeof json.size === 'string' ? Number(json.size) : null;
  return {
    id: json.id,
    size: size !== null && Number.isFinite(size) ? size : null,
    md5: typeof json.md5Checksum === 'string' ? json.md5Checksum : null,
    appProperties:
      json.appProperties && typeof json.appProperties === 'object'
        ? (json.appProperties as Record<string, string>)
        : {},
    trashed: json.trashed === true,
  };
}

/** The fields read for verification. */
const FILE_FIELDS = 'id,size,md5Checksum,appProperties,trashed';

/**
 * Drive calls with the company token.
 *
 * @param fetchFn The fetch.
 * @param token   The access token (server memory only).
 * @returns The calls.
 * Called from: api.ts; tests
 */
export function driveServer(fetchFn: FetchLike, token: string): DriveServer {
  const auth = { Authorization: `Bearer ${token}` };
  const send = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await fetchFn(url, {
        ...init,
        headers: { ...auth, ...(init.headers as Record<string, string>) },
        cache: 'no-store',
      });
    } catch {
      throw new GoogleUnavailableError(0);
    }
  };
  const ok = async (response: Response): Promise<Record<string, unknown>> => {
    if (response.status === 401) throw new GoogleRefusedError('unauthorized');
    if (!response.ok) throw new GoogleUnavailableError(response.status);
    return (await response.json()) as Record<string, unknown>;
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
      const response = await send(url.toString());
      // The parent is gone or no longer reachable with this account.
      if (response.status === 404) throw new GoogleUnavailableError(404);
      const out = (await ok(response)) as { files?: { id?: unknown }[] };
      const id = out.files?.[0]?.id;
      return typeof id === 'string' ? id : null;
    },

    async createFolder(name, parentId, tags) {
      const out = await ok(
        await send(`${FILES_URL}?supportsAllDrives=true&fields=id`, {
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
      if (typeof out.id !== 'string') throw new GoogleUnavailableError(502);
      return out.id;
    },

    async startUpload(meta) {
      const response = await send(
        `${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id`,
        {
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
        },
      );
      if (response.status === 401) throw new GoogleRefusedError('unauthorized');
      if (!response.ok) throw new GoogleUnavailableError(response.status);
      const location = response.headers.get('location');
      if (!location) throw new GoogleUnavailableError(502);
      return location;
    },

    async uploadSmall(meta, bytes) {
      // multipart/related: the metadata, then the bytes (Drive's one-request upload).
      const boundary = `kite-${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify({
            name: meta.name,
            parents: [meta.parentId],
            appProperties: props(meta.tags),
          }) +
          `\r\n--${boundary}\r\nContent-Type: ${meta.mimeType}\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([head, Buffer.from(bytes), tail]);
      const out = await ok(
        await send(
          `${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`,
          {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body,
          },
        ),
      );
      const facts = factsOf(out);
      if (!facts) throw new GoogleUnavailableError(502);
      return facts;
    },

    async file(fileId) {
      const url = new URL(`${FILES_URL}/${encodeURIComponent(fileId)}`);
      url.searchParams.set('fields', FILE_FIELDS);
      url.searchParams.set('supportsAllDrives', 'true');
      const response = await send(url.toString());
      if (response.status === 403 || response.status === 404) return null;
      return factsOf(await ok(response));
    },

    async trash(fileId) {
      const response = await send(
        `${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ trashed: true }),
        },
      );
      // Already gone or not ours: nothing to move.
      if (response.status === 403 || response.status === 404) return;
      await ok(response);
    },

    async offset(uploadUrl, bytes) {
      // "bytes */size" asks without sending. The session address is the upload's own credential.
      const response = await send(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${bytes}`, 'Content-Length': '0' },
      });
      if (response.status === 200 || response.status === 201) {
        const out = (await response.json().catch(() => ({}))) as { id?: unknown };
        if (typeof out.id === 'string') return { state: 'done', fileId: out.id };
        throw new GoogleUnavailableError(502);
      }
      if (response.status === 308) {
        return { state: 'partial', offset: nextOffsetFromRange(response.headers.get('range')) };
      }
      if (response.status === 404 || response.status === 410) return { state: 'expired' };
      throw new GoogleUnavailableError(response.status);
    },
  };
}

/**
 * Finds or makes a session's folder and its two subfolders in the company folder.
 *
 * @param drive     Drive calls with the company token.
 * @param company   The company folder and its Shared Drive.
 * @param userId    The account.
 * @param sessionId The session.
 * @param name      The session folder's name (made only when it does not exist yet).
 * @returns The three folders' ids.
 * @throws GoogleUnavailableError (404 when the company folder is gone).
 * Called from: api.ts (session-folder); tests
 */
export async function ensureSessionFolders(
  drive: DriveServer,
  company: { folderId: string; driveId: string | null },
  userId: string,
  sessionId: string,
  name: string,
): Promise<{ folderId: string; recordingsId: string; transcriptsId: string }> {
  const folderId =
    (await drive.find(
      company.folderId,
      folderTags(userId, sessionId, 'session'),
      company.driveId,
    )) ??
    (await drive.createFolder(name, company.folderId, folderTags(userId, sessionId, 'session')));
  const sub = async (which: DriveSubfolder) =>
    (await drive.find(folderId, folderTags(userId, sessionId, which), company.driveId)) ??
    (await drive.createFolder(which, folderId, folderTags(userId, sessionId, which)));
  return {
    folderId,
    recordingsId: await sub('Recordings'),
    transcriptsId: await sub('Transcripts'),
  };
}

/**
 * Finds a session's subfolder (it must already exist: the session folder is made first).
 *
 * @param drive     Drive calls with the company token.
 * @param company   The company folder and its Shared Drive.
 * @param userId    The account.
 * @param sessionId The session.
 * @param which     Recordings or Transcripts.
 * @returns Its id, or null when the session has no folders yet.
 * Called from: api.ts (uploads, small files); tests
 */
export async function findSubfolder(
  drive: DriveServer,
  company: { folderId: string; driveId: string | null },
  userId: string,
  sessionId: string,
  which: DriveSubfolder,
): Promise<string | null> {
  const folderId = await drive.find(
    company.folderId,
    folderTags(userId, sessionId, 'session'),
    company.driveId,
  );
  if (!folderId) return null;
  return drive.find(folderId, folderTags(userId, sessionId, which), company.driveId);
}

/** What an upload ticket vouches for. */
export interface UploadTicket {
  /** The session. */
  sessionId: string;
  /** The file's stable key. */
  key: string;
  /** Its size in bytes. */
  bytes: number;
  /** Its tag value (kiteFile). */
  tag: string;
  /** When the ticket stops being accepted (Unix ms). */
  expiresAt: number;
}

/**
 * The key tickets are signed with: derived from BETTER_AUTH_SECRET for this one use.
 * @param secret BETTER_AUTH_SECRET.
 * @returns The key.
 */
function ticketKey(secret: string): Buffer {
  return createHash('sha256').update(`kite-drive-upload-ticket\n${secret}`).digest();
}

/**
 * Signs an upload ticket: bound to the account and the upload's session address, so only the account the
 * server started the upload for can ask about it or complete it.
 *
 * @param secret    BETTER_AUTH_SECRET.
 * @param userId    The account.
 * @param uploadUrl The upload's session address.
 * @param ticket    What it vouches for.
 * @returns "<payload>.<signature>" (base64url).
 * Called from: api.ts (uploads); tests
 */
export function signTicket(
  secret: string,
  userId: string,
  uploadUrl: string,
  ticket: UploadTicket,
): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  const mac = createHmac('sha256', ticketKey(secret))
    .update(`${userId}\n${uploadUrl}\n${payload}`)
    .digest('base64url');
  return `${payload}.${mac}`;
}

/**
 * Checks an upload ticket.
 *
 * @param secret    BETTER_AUTH_SECRET.
 * @param userId    The account asking.
 * @param uploadUrl The session address it came with.
 * @param ticket    The ticket.
 * @param now       The clock (Unix ms).
 * @returns What it vouches for, or null when it is forged, for another account or address, or expired.
 * Called from: api.ts (offset, complete); tests
 */
export function readTicket(
  secret: string,
  userId: string,
  uploadUrl: string,
  ticket: string,
  now: number,
): UploadTicket | null {
  const [payload, mac] = ticket.split('.');
  if (!payload || !mac) return null;
  const expected = createHmac('sha256', ticketKey(secret))
    .update(`${userId}\n${uploadUrl}\n${payload}`)
    .digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UploadTicket;
    if (typeof value.expiresAt !== 'number' || value.expiresAt < now) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Whether a file as Drive describes it is the one a ticket (or a report) names: not in the bin, with
 * this file's tag, and (when known) this size and MD5.
 *
 * @param facts    The file's facts.
 * @param expected The tag value, and optionally the size and the client's MD5.
 * @returns True when it matches.
 * Called from: api.ts (complete, small files, notify); tests
 */
export function fileMatches(
  facts: DriveFileFacts,
  expected: {
    /** The tag value (kiteFile). */
    tag: string;
    /** The size, when known. */
    bytes?: number;
    /** The MD5 (hex), when known. */
    md5?: string;
  },
): boolean {
  if (facts.trashed || facts.appProperties.kiteFile !== expected.tag) return false;
  if (expected.bytes !== undefined && facts.size !== expected.bytes) return false;
  if (
    expected.md5 !== undefined &&
    facts.md5 !== null &&
    facts.md5 !== expected.md5.toLowerCase()
  ) {
    return false;
  }
  return true;
}

/**
 * The MD5 of some bytes, hex (Drive's md5Checksum form).
 * @param bytes The bytes.
 * @returns The digest.
 * Called from: api.ts (small files); tests
 */
export function md5Hex(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}
