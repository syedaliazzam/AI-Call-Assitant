/**
 * Tests for apps/desktop/src/drive/{upload,notice,host}.ts and the trackFileOf() lookup in
 * recordings/manager.ts (desktop 1.6.0, ADR-0072), on real files in a temporary folder and a fake Google:
 * - only a well-formed request to a Drive upload address is accepted; the file comes from the index only;
 * - an upload asks Google how far it got and RESUMES from there, in 256 KiB-multiple chunks, with the
 *   token, reporting progress, and ends with the file id;
 * - a call stops it between chunks, and a call starting mid-chunk cuts the chunk off ('paused');
 * - 401 is 'auth', 404 is 'expired', a lost connection is retried then reported as retryable;
 * - the notification opens only a Drive link; the IPC calls refuse another origin and send progress to
 *   the page that asked;
 * - 1.6.2 (ADR-0074): without a token no Authorization header is sent, the upload starts at the offset the
 *   server gave without asking, a finished one reports the file's MD5, a 401 is a gone session, and the
 *   page can ask a file's size (from the index only).
 * Never the real profile, real Recordings folder or real Google.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRIVE_PROGRESS_EVENT,
  DRIVE_UPLOAD_CHANNEL,
  SHOW_NOTICE_CHANNEL,
} from '../../src/channels';
import { installDrive } from '../../src/drive/host';
import { isNotice, showNotice } from '../../src/drive/notice';
import {
  createDriveUploader,
  isUploadRequest,
  type DriveUploaderDeps,
} from '../../src/drive/upload';

vi.mock('electron', () => ({}));

/** A recording's id. */
const REC = '22222222-2222-4222-8222-222222222222';

/** A Drive upload session's address. */
const UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc';

/** 256 KiB, Google's chunk unit; the tests use one unit per chunk. */
const UNIT = 256 * 1024;

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'kite-drive-'));
  file = path.join(root, 'rec.mkv');
  // Three and a half chunks of invented bytes.
  writeFileSync(file, Buffer.alloc(UNIT * 3 + UNIT / 2, 7));
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** What the fake Google saw. */
interface Seen {
  /** The Content-Range header. */
  range: string;
  /** The Authorization header. */
  auth: string;
  /** The body's size. */
  size: number;
}

/**
 * A fake Google upload session.
 * @param already Bytes it already holds.
 * @param total   The file's size.
 * @param script  Replies to give first, in order (then it behaves normally).
 * @returns The fetch and what it saw.
 */
function fakeGoogle(
  already: number,
  total: number,
  script: (() => Response | Promise<Response>)[] = [],
) {
  const seen: Seen[] = [];
  let held = already;
  const fetch: DriveUploaderDeps['fetch'] = async (url, init) => {
    expect(url).toBe(UPLOAD_URL);
    const headers = init.headers as Record<string, string>;
    const body = init.body as Uint8Array | undefined;
    seen.push({
      range: headers['Content-Range']!,
      auth: headers.Authorization!,
      size: body?.byteLength ?? 0,
    });
    const next = script.shift();
    if (next) return next();
    if (headers['Content-Range']!.startsWith('bytes */')) {
      return new Response(null, {
        status: 308,
        headers: held ? { Range: `bytes=0-${held - 1}` } : {},
      });
    }
    const [, start, end] = /^bytes (\d+)-(\d+)\//.exec(headers['Content-Range']!)!;
    expect(Number(start)).toBe(held);
    held = Number(end) + 1;
    if (held >= total) return Response.json({ id: 'DRIVE-FILE' }, { status: 201 });
    return new Response(null, { status: 308, headers: { Range: `bytes=0-${held - 1}` } });
  };
  return { fetch, seen };
}

/**
 * An uploader over a fetch.
 * @param fetch   The fake Google.
 * @param changes Other dependencies.
 * @returns The uploader.
 */
function uploader(fetch: DriveUploaderDeps['fetch'], changes: Partial<DriveUploaderDeps> = {}) {
  return createDriveUploader({
    fileOf: (id) => (id === REC ? file : null),
    fetch,
    callActive: () => false,
    sleep: async () => undefined,
    chunkBytes: UNIT,
    ...changes,
  });
}

/** A valid request. */
const REQUEST = {
  recordingId: REC,
  track: 'main',
  uploadUrl: UPLOAD_URL,
  accessToken: 'token-1',
} as const;

describe('isUploadRequest', () => {
  it('accepts only a Drive upload address, a UUID, a track and a token', () => {
    expect(isUploadRequest(REQUEST)).toBe(true);
    expect(
      isUploadRequest({ ...REQUEST, uploadUrl: 'https://evil.example/upload?upload_id=1' }),
    ).toBe(false);
    expect(
      isUploadRequest({
        ...REQUEST,
        uploadUrl: 'http://www.googleapis.com/upload/drive/v3/files?upload_id=1',
      }),
    ).toBe(false);
    expect(isUploadRequest({ ...REQUEST, recordingId: '../x' })).toBe(false);
    expect(isUploadRequest({ ...REQUEST, track: 'other' })).toBe(false);
    expect(isUploadRequest({ ...REQUEST, accessToken: '' })).toBe(false);
  });

  it('1.6.2: accepts a request without a token, with a whole, non-negative start offset', () => {
    const { accessToken: _none, ...tokenless } = REQUEST;
    expect(isUploadRequest(tokenless)).toBe(true);
    expect(isUploadRequest({ ...tokenless, startOffset: UNIT })).toBe(true);
    expect(isUploadRequest({ ...tokenless, startOffset: -1 })).toBe(false);
    expect(isUploadRequest({ ...tokenless, startOffset: 1.5 })).toBe(false);
  });
});

describe('1.6.2: uploads with the session address only (ADR-0074)', () => {
  const { accessToken: _none, ...TOKENLESS } = REQUEST;

  it('sends no Authorization header, starts at the server’s offset, and reports the MD5', async () => {
    const total = UNIT * 3 + UNIT / 2;
    const google = fakeGoogle(UNIT * 2, total);
    const result = await uploader(google.fetch).upload(
      { ...TOKENLESS, startOffset: UNIT * 2 },
      () => undefined,
    );
    expect(result).toMatchObject({ status: 'done', fileId: 'DRIVE-FILE', bytes: total });
    expect((result as { md5?: string }).md5).toBe(
      createHash('md5').update(readFileSync(file)).digest('hex'),
    );
    // No "where did it get to?" question: the first request sends bytes from the server's offset.
    expect(google.seen.map((one) => one.range)).toEqual([
      `bytes ${UNIT * 2}-${UNIT * 3 - 1}/${total}`,
      `bytes ${UNIT * 3}-${total - 1}/${total}`,
    ]);
    expect(google.seen.every((one) => one.auth === undefined)).toBe(true);
  });

  it('treats a 401 without a token as a gone session (the page starts a new one)', async () => {
    const google = fakeGoogle(0, 1, [() => new Response(null, { status: 401 })]);
    expect(await uploader(google.fetch).upload(TOKENLESS, () => undefined)).toEqual({
      status: 'expired',
    });
  });

  it('gives a file’s size from the index only, and null for a bad request or a missing file', async () => {
    const up = uploader(fakeGoogle(0, 1).fetch);
    expect(await up.fileSize({ recordingId: REC, track: 'main' })).toBe(UNIT * 3 + UNIT / 2);
    expect(await up.fileSize({ recordingId: '../x', track: 'main' })).toBeNull();
    expect(await up.fileSize({ recordingId: REC, track: 'other' })).toBeNull();
    expect(
      await up.fileSize({ recordingId: '33333333-3333-4333-8333-333333333333', track: 'main' }),
    ).toBeNull();
  });
});

describe('upload', () => {
  it('resumes from where Google got to and finishes with the file id', async () => {
    const total = UNIT * 3 + UNIT / 2;
    const google = fakeGoogle(UNIT, total);
    const progress: number[] = [];
    const result = await uploader(google.fetch).upload(REQUEST, (p) => progress.push(p.sent));
    expect(result).toEqual({
      status: 'done',
      fileId: 'DRIVE-FILE',
      bytes: total,
      md5: createHash('md5').update(readFileSync(file)).digest('hex'),
    });
    expect(google.seen.map((s) => s.range)).toEqual([
      `bytes */${total}`,
      `bytes ${UNIT}-${UNIT * 2 - 1}/${total}`,
      `bytes ${UNIT * 2}-${UNIT * 3 - 1}/${total}`,
      `bytes ${UNIT * 3}-${total - 1}/${total}`,
    ]);
    expect(google.seen.every((s) => s.auth === 'Bearer token-1')).toBe(true);
    expect(google.seen[1]!.size % UNIT).toBe(0);
    expect(progress[0]).toBe(UNIT);
    expect(progress.at(-1)).toBe(total);
  });

  it('refuses a bad request and reports a file that is not in the index', async () => {
    const google = fakeGoogle(0, 1);
    expect(
      await uploader(google.fetch).upload(
        { ...REQUEST, uploadUrl: 'https://evil.example' },
        () => {},
      ),
    ).toEqual({
      status: 'failed',
      retryable: false,
      reason: 'invalid',
    });
    expect(
      await uploader(google.fetch).upload(
        { ...REQUEST, recordingId: '33333333-3333-4333-8333-333333333333' },
        () => {},
      ),
    ).toEqual({ status: 'missing' });
    expect(google.seen).toHaveLength(0);
  });

  it('pauses between chunks once a call starts, and sends nothing during one', async () => {
    const total = UNIT * 3 + UNIT / 2;
    let live = false;
    const google = fakeGoogle(0, total);
    const up = uploader(google.fetch, { callActive: () => live });
    const result = await up.upload(REQUEST, (p) => {
      if (p.sent >= UNIT) live = true;
    });
    expect(result).toEqual({ status: 'paused', offset: UNIT, bytes: total });
    const sent = google.seen.length;
    expect(await up.upload(REQUEST, () => {})).toMatchObject({ status: 'paused' });
    expect(google.seen).toHaveLength(sent);
  });

  it('cuts off a chunk in flight when a call starts (pauseAll)', async () => {
    let live = false;
    const fetch: DriveUploaderDeps['fetch'] = async (_url, init) => {
      const headers = init.headers as Record<string, string>;
      if (headers['Content-Range']!.startsWith('bytes */'))
        return new Response(null, { status: 308 });
      // The call starts while this chunk is on its way.
      live = true;
      up.pauseAll();
      throw new DOMException('aborted', 'AbortError');
    };
    // Declared after fetch, which reads it only when called (by then it is set).
    const up = uploader(fetch, { callActive: () => live });
    expect(await up.upload(REQUEST, () => {})).toMatchObject({ status: 'paused', offset: 0 });
  });

  it('reports a refused token, a gone session, and a lost connection after retries', async () => {
    const total = UNIT * 3 + UNIT / 2;
    const refused = fakeGoogle(0, total, [() => new Response(null, { status: 401 })]);
    expect(await uploader(refused.fetch).upload(REQUEST, () => {})).toEqual({
      status: 'auth',
      offset: 0,
      bytes: total,
    });
    const gone = fakeGoogle(0, total, [() => new Response(null, { status: 404 })]);
    expect(await uploader(gone.fetch).upload(REQUEST, () => {})).toEqual({ status: 'expired' });
    let tries = 0;
    const sleeps: number[] = [];
    const offline = uploader(
      async () => {
        tries += 1;
        throw new TypeError('net::ERR_INTERNET_DISCONNECTED');
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(await offline.upload(REQUEST, () => {})).toEqual({
      status: 'failed',
      retryable: true,
      reason: 'network',
    });
    expect(tries).toBe(4);
    expect(sleeps).toEqual([2_000, 4_000, 8_000]);
  });
});

describe('notice', () => {
  it('opens only a Drive link, and refuses other notices', () => {
    const opened: string[] = [];
    let click: (() => void) | null = null;
    const deps = {
      supported: () => true,
      create: () => ({
        on: (_event: 'click', listener: () => void) => {
          click = listener;
        },
        show: () => undefined,
      }),
      openExternal: (url: string) => opened.push(url),
    };
    expect(
      showNotice(deps, {
        title: 'Saved',
        body: 'Open in Drive',
        url: 'https://drive.google.com/drive/folders/F',
      }),
    ).toBe(true);
    click!();
    expect(opened).toEqual(['https://drive.google.com/drive/folders/F']);
    expect(isNotice({ title: 'x', body: 'y', url: 'https://evil.example/' })).toBe(false);
    expect(showNotice(deps, { title: 'x', body: 'y', url: 'file:///C:/x' })).toBe(false);
    expect(showNotice({ ...deps, supported: () => false }, { title: 'x', body: 'y' })).toBe(false);
  });
});

describe('installDrive', () => {
  it('refuses another origin, sends progress to the page that asked, and pauses on a call', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const sent: [string, unknown][] = [];
    const sender = {
      isDestroyed: () => false,
      send: (channel: string, value: unknown) => sent.push([channel, value]),
    };
    const total = UNIT * 3 + UNIT / 2;
    const google = fakeGoogle(0, total);
    const host = installDrive({
      ipcMain: {
        handle: (channel: string, handler: never) => void handlers.set(channel, handler),
      } as never,
      allowedOrigin: 'https://kite.example',
      recordings: { trackFileOf: (id) => (id === REC ? file : null) },
      fetch: google.fetch,
      notices: {
        supported: () => false,
        create: () => ({ on: () => {}, show: () => {} }),
        openExternal: () => {},
      },
    });
    const kite = { senderFrame: { url: 'https://kite.example/home', parent: null }, sender };
    const other = { senderFrame: { url: 'https://evil.example/', parent: null }, sender };
    expect(() => handlers.get(DRIVE_UPLOAD_CHANNEL)!(other, REQUEST)).toThrow();
    expect(() => handlers.get(SHOW_NOTICE_CHANNEL)!(other, { title: 'x', body: 'y' })).toThrow();
    expect(await handlers.get(DRIVE_UPLOAD_CHANNEL)!(kite, REQUEST)).toMatchObject({
      status: 'done',
    });
    expect(sent.every(([channel]) => channel === DRIVE_PROGRESS_EVENT)).toBe(true);
    expect(sent.at(-1)![1]).toEqual({ recordingId: REC, track: 'main', sent: total, total });
    host.setCallActive(true);
    expect(await handlers.get(DRIVE_UPLOAD_CHANNEL)!(kite, REQUEST)).toMatchObject({
      status: 'paused',
    });
  });
});
