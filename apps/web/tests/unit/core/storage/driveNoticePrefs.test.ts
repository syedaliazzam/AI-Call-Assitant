/**
 * Tests for apps/web/src/core/storage/driveNoticePrefs.ts (1.6.1): a closed "Google Drive needs to be
 * reconnected" notice is remembered in sessionStorage (for the window's life, the app run for the
 * desktop panel), and with storage blocked it shows again without throwing, the safe way to fail.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeReconnectNotice, reconnectNoticeClosed } from '@/core/storage/driveNoticePrefs';

afterEach(() => vi.unstubAllGlobals());

describe('driveNoticePrefs', () => {
  it('remembers a closed reconnect notice in sessionStorage', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    });
    // Never in localStorage: the next app run shows it again.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('not used');
      },
      setItem: () => {
        throw new Error('not used');
      },
    });
    expect(reconnectNoticeClosed()).toBe(false);
    closeReconnectNotice();
    expect(reconnectNoticeClosed()).toBe(true);
  });

  it('shows again when storage is blocked, without throwing', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => closeReconnectNotice()).not.toThrow();
    expect(reconnectNoticeClosed()).toBe(false);
  });
});
