/**
 * Tests for apps/web/src/core/stt/download.ts:
 * downloadModelFiles() verifies SHA-256 before use and caches only verified files; a file with a
 * wrong SHA-256 (or wrong size) is rejected with kind 'checksum' and is never cached or
 * returned; cached files are reused without the network; progress reaches 100%; HTTP and
 * fetch failures become 'network', a full disk 'quota', and an abort 'aborted'; when Cache
 * Storage cannot be opened, files are still downloaded and verified (cacheAvailable false). The pure helpers
 * (cacheKey, progressFraction, sha256Hex) are covered too. Real Web Crypto (Node's) is used.
 */
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  cacheKey,
  clearSttCache,
  downloadModelFiles,
  ModelDownloadError,
  progressFraction,
  sha256Hex,
  type DownloadProgress,
} from '@/core/stt/download';
import type { DownloadFile } from '@/core/stt/models';

const subtle = webcrypto.subtle;
const ORIGIN = 'http://localhost:3000';

/** A small in-memory Cache Storage (only the calls download.ts makes). */
function fakeCaches(options: { putError?: Error } = {}) {
  const buckets = new Map<string, Map<string, ArrayBuffer>>();
  const storage = {
    async open(name: string) {
      const bucket = buckets.get(name) ?? new Map<string, ArrayBuffer>();
      buckets.set(name, bucket);
      return {
        async match(key: string) {
          const bytes = bucket.get(key);
          return bytes ? new Response(bytes.slice(0)) : undefined;
        },
        async put(key: string, response: Response) {
          if (options.putError) throw options.putError;
          bucket.set(key, await response.arrayBuffer());
        },
        async delete(key: string) {
          return bucket.delete(key);
        },
      };
    },
    async delete(name: string) {
      return buckets.delete(name);
    },
  };
  return { storage: storage as unknown as CacheStorage, buckets };
}

/** A pinned file description for some bytes. */
async function pinned(name: string, bytes: Uint8Array): Promise<DownloadFile> {
  return {
    name,
    url: `https://files.example/${name}`,
    bytes: bytes.length,
    sha256: await sha256Hex(bytes, subtle),
  };
}

/** A fetch that serves the given bodies by URL, in two chunks each. */
function fakeFetch(bodies: Record<string, Uint8Array>) {
  return vi.fn(async (url: string | URL | Request) => {
    const body = bodies[String(url)];
    if (!body) return new Response(null, { status: 404 });
    const middle = Math.floor(body.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body.slice(0, middle));
        controller.enqueue(body.slice(middle));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  });
}

const encoder = new TextEncoder();

describe('downloadModelFiles', () => {
  it('downloads, verifies, caches, and reports progress up to 100%', async () => {
    const a = encoder.encode('first file contents');
    const b = encoder.encode('second');
    const files = [await pinned('a.onnx', a), await pinned('b.txt', b)];
    const fetchMock = fakeFetch({ [files[0]!.url]: a, [files[1]!.url]: b });
    const { storage, buckets } = fakeCaches();
    const progress: DownloadProgress[] = [];

    const result = await downloadModelFiles(files, {
      onProgress: (p) => progress.push(p),
      deps: {
        fetch: fetchMock as unknown as typeof fetch,
        caches: storage,
        subtle,
        origin: ORIGIN,
      },
    });

    expect(result.cacheAvailable).toBe(true);
    expect(result.files.map((file) => [file.name, file.fromCache])).toEqual([
      ['a.onnx', false],
      ['b.txt', false],
    ]);
    expect(new TextDecoder().decode(result.files[0]!.bytes)).toBe('first file contents');
    expect(progress.at(-1)).toMatchObject({ fraction: 1, loadedBytes: a.length + b.length });
    expect(buckets.get('kite-stt-v2')?.size).toBe(2);
  });

  it('reuses cached files on the next load without the network', async () => {
    const a = encoder.encode('cached bytes');
    const files = [await pinned('a.onnx', a)];
    const { storage } = fakeCaches();
    const deps = { caches: storage, subtle, origin: ORIGIN };
    await downloadModelFiles(files, {
      deps: { ...deps, fetch: fakeFetch({ [files[0]!.url]: a }) as never },
    });

    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const again = await downloadModelFiles(files, { deps: { ...deps, fetch: offline as never } });
    expect(again.files[0]!.fromCache).toBe(true);
    expect(offline).not.toHaveBeenCalled();
  });

  it('still downloads and verifies when Cache Storage cannot be opened', async () => {
    const bytes = encoder.encode('model without a cache');
    const file = await pinned('a.onnx', bytes);
    const broken = {
      open: async () => {
        throw new DOMException('Unexpected internal error.', 'UnknownError');
      },
    } as unknown as CacheStorage;
    const result = await downloadModelFiles([file], {
      deps: {
        fetch: fakeFetch({ [file.url]: bytes }) as never,
        caches: broken,
        subtle,
        origin: ORIGIN,
      },
    });
    expect(result.cacheAvailable).toBe(false);
    expect(result.files[0]).toMatchObject({ name: 'a.onnx', fromCache: false });
  });

  it('rejects a file with a wrong SHA-256 and never caches or returns it', async () => {
    const real = encoder.encode('the real model');
    const tampered = encoder.encode('the fake model');
    const file = await pinned('encoder.onnx', real);
    const { storage, buckets } = fakeCaches();

    const attempt = downloadModelFiles([file], {
      deps: {
        fetch: fakeFetch({ [file.url]: tampered }) as never,
        caches: storage,
        subtle,
        origin: ORIGIN,
      },
    });
    await expect(attempt).rejects.toMatchObject({ kind: 'checksum', file: 'encoder.onnx' });
    await expect(attempt).rejects.toBeInstanceOf(ModelDownloadError);
    expect(buckets.get('kite-stt-v2')?.size ?? 0).toBe(0);
  });

  it('rejects a file that is longer or shorter than pinned', async () => {
    const real = encoder.encode('12345678');
    const file = await pinned('tokens.txt', real);
    const { storage } = fakeCaches();
    const run = (body: Uint8Array) =>
      downloadModelFiles([file], {
        deps: {
          fetch: fakeFetch({ [file.url]: body }) as never,
          caches: storage,
          subtle,
          origin: ORIGIN,
        },
      });
    await expect(run(encoder.encode('123456789'))).rejects.toMatchObject({ kind: 'checksum' });
    await expect(run(encoder.encode('1234'))).rejects.toMatchObject({ kind: 'checksum' });
  });

  it('turns HTTP errors and fetch failures into network errors', async () => {
    const file = await pinned('missing.onnx', encoder.encode('x'));
    const { storage } = fakeCaches();
    await expect(
      downloadModelFiles([file], {
        deps: { fetch: fakeFetch({}) as never, caches: storage, subtle, origin: ORIGIN },
      }),
    ).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('HTTP 404') });
    const broken = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      downloadModelFiles([file], {
        deps: { fetch: broken as never, caches: storage, subtle, origin: ORIGIN },
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports a full disk as a quota error', async () => {
    const bytes = encoder.encode('model');
    const file = await pinned('a.onnx', bytes);
    const { storage } = fakeCaches({ putError: new DOMException('full', 'QuotaExceededError') });
    await expect(
      downloadModelFiles([file], {
        deps: {
          fetch: fakeFetch({ [file.url]: bytes }) as never,
          caches: storage,
          subtle,
          origin: ORIGIN,
        },
      }),
    ).rejects.toMatchObject({ kind: 'quota' });
  });

  it('stops with an aborted error when the signal fires', async () => {
    const file = await pinned('a.onnx', encoder.encode('model'));
    const { storage } = fakeCaches();
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadModelFiles([file], {
        signal: controller.signal,
        deps: { fetch: fakeFetch({}) as never, caches: storage, subtle, origin: ORIGIN },
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('helpers', () => {
  it('builds cache keys that contain the SHA-256, so a new pin never reuses an old file', () => {
    const key = cacheKey(ORIGIN, { name: 'a b.onnx', sha256: 'ab'.repeat(32) });
    expect(key).toBe(`${ORIGIN}/__kite-stt-cache__/${'ab'.repeat(32)}/a%20b.onnx`);
    expect(cacheKey(ORIGIN, { name: 'a b.onnx', sha256: 'cd'.repeat(32) })).not.toBe(key);
  });

  it('keeps progress between 0 and 1', () => {
    expect(progressFraction(50, 200)).toBe(0.25);
    expect(progressFraction(300, 200)).toBe(1);
    expect(progressFraction(0, 0)).toBe(1);
  });

  it('computes the known SHA-256 of "abc"', async () => {
    expect(await sha256Hex(encoder.encode('abc'), subtle)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('clears the current and old cache buckets', async () => {
    const { storage, buckets } = fakeCaches();
    await storage.open('kite-stt-v1');
    expect(await clearSttCache(storage)).toBe(true);
    expect(buckets.has('kite-stt-v1')).toBe(false);
    expect(await clearSttCache(storage)).toBe(false);
  });
});
