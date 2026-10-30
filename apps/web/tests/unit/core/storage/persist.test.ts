/**
 * Tests for apps/web/src/core/storage/persist.ts with a fake StorageManager:
 * requestPersistentStorage() reports 'unsupported' without one, 'persisted' when storage is
 * already persistent (without asking again) or when the request is granted, and 'not-persisted'
 * when it is declined or the call throws.
 */
import { describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from '@/core/storage/persist';

/**
 * A fake StorageManager.
 *
 * @param persisted What persisted() resolves to.
 * @param persist   What persist() does.
 * @returns The fake, with both methods as spies.
 */
function fakeStorage(persisted: boolean, persist: () => Promise<boolean>) {
  return { persisted: vi.fn(async () => persisted), persist: vi.fn(persist) };
}

describe('requestPersistentStorage', () => {
  it('is unsupported without a StorageManager', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
  });

  it('does not ask again when storage is already persistent', async () => {
    const storage = fakeStorage(true, async () => true);
    expect(await requestPersistentStorage(storage)).toBe('persisted');
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it('reports a granted or declined request', async () => {
    expect(await requestPersistentStorage(fakeStorage(false, async () => true))).toBe('persisted');
    expect(await requestPersistentStorage(fakeStorage(false, async () => false))).toBe(
      'not-persisted',
    );
  });

  it('treats a failing call as not persisted (Kite works either way)', async () => {
    const storage = fakeStorage(false, async () => {
      throw new Error('blocked');
    });
    expect(await requestPersistentStorage(storage)).toBe('not-persisted');
  });
});
