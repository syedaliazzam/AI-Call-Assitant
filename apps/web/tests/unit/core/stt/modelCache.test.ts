/**
 * Tests for apps/web/src/core/stt/modelCache.ts: the desktop Connect card sees the speech model as
 * cached only when every file the engine loads is in Cache Storage, and the download is about 204 MB
 * (ADR-0055).
 */
import { describe, expect, it } from 'vitest';
import { cacheKey, STT_CACHE_NAME } from '@/core/stt/download';
import { speechModelBytes, speechModelCached, speechModelFiles } from '@/core/stt/modelCache';

const ORIGIN = 'https://kite.example';

/**
 * A fake Cache Storage holding some keys.
 *
 * @param keys The cached keys (null for no bucket at all).
 * @returns The fake.
 */
function storage(keys: string[] | null): CacheStorage {
  return {
    has: async (name: string) => keys !== null && name === STT_CACHE_NAME,
    open: async () => ({
      match: async (key: string) => (keys?.includes(key) ? new Response('x') : undefined),
    }),
  } as unknown as CacheStorage;
}

describe('speechModelFiles', () => {
  it('lists the runtime and the model files, in the worker order', () => {
    const files = speechModelFiles(ORIGIN, 'remote');
    expect(files).toHaveLength(8);
    expect(files.slice(0, 3).every((file) => file.url.startsWith(ORIGIN))).toBe(true);
  });
});

describe('speechModelBytes', () => {
  it('is about 204 MB', () => {
    expect(Math.round(speechModelBytes(ORIGIN) / 1e6)).toBe(204);
  });
});

describe('speechModelCached', () => {
  const all = speechModelFiles(ORIGIN).map((file) => cacheKey(ORIGIN, file));

  it('is true when every file is cached', async () => {
    expect(await speechModelCached(ORIGIN, storage(all))).toBe(true);
  });

  it('is false when one file is missing, or there is no bucket', async () => {
    expect(await speechModelCached(ORIGIN, storage(all.slice(1)))).toBe(false);
    expect(await speechModelCached(ORIGIN, storage(null))).toBe(false);
  });

  it('is false when Cache Storage is blocked', async () => {
    const blocked = {
      has: async () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    } as unknown as CacheStorage;
    expect(await speechModelCached(ORIGIN, blocked)).toBe(false);
  });
});
