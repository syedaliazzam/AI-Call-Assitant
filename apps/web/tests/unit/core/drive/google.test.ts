/**
 * Tests for apps/web/src/core/drive/google.ts (ADR-0072), with a fake Google: an upload asks where Google
 * got to first and resumes from there (a 308's Range), sends 256 KiB-multiple chunks, finishes with the
 * file id, pauses between chunks when told to, reports a gone session as 'expired'; a 401 gets a new
 * token once; every call has supportsAllDrives; queries look for Kite's tags in the right folder; tags
 * are hashes, never the ids. No real Google call is made.
 */
import { DRIVE_CHUNK_BYTES } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { createDriveClient, tagValue, type GoogleFetch } from '@/core/drive/google';

/** One request the fake saw. */
interface Seen {
  /** Its address. */
  url: string;
  /** Its method. */
  method: string;
  /** Its headers. */
  headers: Record<string, string>;
  /** Its body's size, when it had one. */
  size: number | null;
}

/**
 * A fake Google that keeps what an upload session received.
 * @param already Bytes the session already holds (a resumed upload).
 * @param total   The file's size.
 * @returns The fetch and what it saw.
 */
function fakeUploadSession(already: number, total: number) {
  const seen: Seen[] = [];
  let held = already;
  const fetchFn: GoogleFetch = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body as Blob | null | undefined;
    seen.push({ url, method: init?.method ?? 'GET', headers, size: body ? body.size : null });
    const range = headers['Content-Range']!;
    if (range.startsWith('bytes */')) {
      return new Response(null, {
        status: 308,
        headers: held ? { Range: `bytes=0-${held - 1}` } : {},
      });
    }
    const [, start, end] = /^bytes (\d+)-(\d+)\//.exec(range)!;
    expect(Number(start)).toBe(held);
    held = Number(end) + 1;
    if (held >= total) return Response.json({ id: 'FILE1' }, { status: 200 });
    return new Response(null, { status: 308, headers: { Range: `bytes=0-${held - 1}` } });
  };
  return { fetchFn, seen };
}

/**
 * A client over a fetch, with a fixed token.
 * @param fetchFn The fetch.
 * @returns The client.
 */
function client(fetchFn: GoogleFetch) {
  return createDriveClient({ fetch: fetchFn, token: async () => 'token-1' });
}

describe('uploadBlob', () => {
  it('resumes from where Google got to and finishes with the file id', async () => {
    const total = DRIVE_CHUNK_BYTES * 2 + 10;
    const { fetchFn, seen } = fakeUploadSession(DRIVE_CHUNK_BYTES, total);
    const progress: number[] = [];
    const result = await client(fetchFn).uploadBlob(
      'https://www.googleapis.com/upload/drive/v3/files?upload_id=x',
      new Blob([new Uint8Array(total)]),
      (sent) => progress.push(sent),
      async () => false,
    );
    expect(result).toEqual({ status: 'done', fileId: 'FILE1', bytes: total });
    // The status question, then only the bytes Google did not have: one full chunk and the rest.
    expect(seen.map((s) => s.headers['Content-Range'])).toEqual([
      `bytes */${total}`,
      `bytes ${DRIVE_CHUNK_BYTES}-${DRIVE_CHUNK_BYTES * 2 - 1}/${total}`,
      `bytes ${DRIVE_CHUNK_BYTES * 2}-${total - 1}/${total}`,
    ]);
    expect(seen[1]!.size! % (256 * 1024)).toBe(0);
    expect(progress[0]).toBe(DRIVE_CHUNK_BYTES);
    expect(progress.at(-1)).toBe(total);
  });

  it('pauses between chunks when a call starts', async () => {
    const total = DRIVE_CHUNK_BYTES * 3;
    const { fetchFn } = fakeUploadSession(0, total);
    let chunks = 0;
    const result = await client(fetchFn).uploadBlob(
      'https://u',
      new Blob([new Uint8Array(total)]),
      () => {},
      async () => chunks++ >= 1,
    );
    expect(result).toEqual({ status: 'paused', offset: DRIVE_CHUNK_BYTES, bytes: total });
  });

  it('reports a gone session, and a refused one with its status', async () => {
    const gone = await client(async () => new Response(null, { status: 404 })).uploadBlob(
      'https://u',
      new Blob(['x']),
      () => {},
      async () => false,
    );
    expect(gone).toEqual({ status: 'expired' });
    const refused = await client(async () => new Response(null, { status: 403 })).uploadBlob(
      'https://u',
      new Blob(['x']),
      () => {},
      async () => false,
    );
    expect(refused).toEqual({ status: 'failed', retryable: false, reason: 'http-403' });
  });
});

describe('Drive calls', () => {
  it('gets a new token once after a 401, and supports Shared Drives', async () => {
    const tokens: boolean[] = [];
    const seen: string[] = [];
    let first = true;
    const drive = createDriveClient({
      fetch: async (url, init) => {
        seen.push(`${(init?.headers as Record<string, string>).Authorization} ${url}`);
        if (first) {
          first = false;
          return new Response(null, { status: 401 });
        }
        return Response.json({ files: [{ id: 'F9' }] });
      },
      token: async (fresh) => {
        tokens.push(fresh);
        return fresh ? 'token-2' : 'token-1';
      },
    });
    const id = await drive.find('PARENT', [{ key: 'kiteSession', value: 'abc' }], 'DRIVE1');
    expect(id).toBe('F9');
    expect(tokens).toEqual([false, true]);
    expect(seen[1]).toMatch(/^Bearer token-2 /);
    const url = new URL(seen[1]!.split(' ')[2]!);
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('corpora')).toBe('drive');
    expect(url.searchParams.get('driveId')).toBe('DRIVE1');
    expect(url.searchParams.get('q')).toBe(
      "'PARENT' in parents and trashed = false and appProperties has { key='kiteSession' and value='abc' }",
    );
  });

  it('opens an upload session with the tags and returns its address', async () => {
    let body = '';
    const drive = client(async (url, init) => {
      expect(url).toContain('uploadType=resumable');
      expect(url).toContain('supportsAllDrives=true');
      body = String(init?.body);
      return new Response(null, { status: 200, headers: { Location: 'https://upload/x' } });
    });
    const address = await drive.startUpload({
      name: 'a.txt',
      parentId: 'P',
      mimeType: 'text/plain',
      bytes: 3,
      tags: [{ key: 'kiteFile', value: 'h1' }],
    });
    expect(address).toBe('https://upload/x');
    expect(JSON.parse(body)).toEqual({
      name: 'a.txt',
      parents: ['P'],
      appProperties: { kiteFile: 'h1' },
    });
  });

  it('makes tags from hashes, never the ids themselves', async () => {
    const tag = await tagValue('11111111-1111-4111-8111-111111111111');
    expect(tag).toMatch(/^[0-9a-f]{32}$/);
    expect(tag).not.toContain('11111111-');
  });
});
