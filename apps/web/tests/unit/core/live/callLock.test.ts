/**
 * Tests for apps/web/src/core/live/callLock.ts (v1.1.0, ADR-0041): one call at a time. The first page
 * gets the lock and holds it until it releases; a second page gets null; a browser without Web Locks, or
 * one whose request fails, behaves as before (no check).
 */
import { describe, expect, it } from 'vitest';
import { CALL_LOCK_NAME, takeCallLock, type LockApi } from '@/core/live/callLock';

/**
 * A fake Web Locks API with one lock.
 *
 * @returns The API and the names asked for.
 */
function fakeLocks(): LockApi & { names: string[] } {
  let held = false;
  const names: string[] = [];
  return {
    names,
    async request(name, _options, callback) {
      names.push(name);
      if (held) return callback(null);
      held = true;
      const result = await callback({ name });
      held = false;
      return result;
    },
  };
}

describe('takeCallLock', () => {
  it('gives the lock to the first page and null to the second, until it is released', async () => {
    const locks = fakeLocks();
    const release = await takeCallLock(locks);
    expect(release).toBeTypeOf('function');
    expect(locks.names).toEqual([CALL_LOCK_NAME]);
    expect(await takeCallLock(locks)).toBeNull();
    release!();
    // The fake's request finishes on a later tick, as the browser's does.
    await new Promise((resolve) => setTimeout(resolve));
    expect(await takeCallLock(locks)).toBeTypeOf('function');
  });

  it('does no check in a browser without Web Locks', async () => {
    const release = await takeCallLock(undefined);
    expect(release).toBeTypeOf('function');
    expect(() => release!()).not.toThrow();
  });

  it('does no check when the request fails', async () => {
    const release = await takeCallLock({
      request: () => Promise.reject(new Error('SecurityError')),
    });
    expect(release).toBeTypeOf('function');
  });
});
