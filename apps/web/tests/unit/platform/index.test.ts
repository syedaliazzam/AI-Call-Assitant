/**
 * Tests for apps/web/src/platform/index.ts:
 * getPlatform() picks the browser platform without `window.kiteDesktop` (and on the server),
 * the desktop platform with it; isDesktop() follows the same rule.
 */
import type { KiteDesktopApi } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import { getPlatform, isDesktop } from '@/platform';
import type { DesktopPlatform } from '@/platform';

/** A fake bridge, as the desktop shell's preload script would expose it. */
const fakeBridge: KiteDesktopApi = { version: '0.1.0', os: 'windows' };

describe('getPlatform', () => {
  it('returns the browser platform when there is no window (server rendering)', () => {
    // Vitest runs in Node, where `window` is undefined, like Next.js server rendering.
    expect(getPlatform().kind).toBe('browser');
  });

  it('returns the browser platform when window.kiteDesktop is missing', () => {
    vi.stubGlobal('window', {});
    expect(getPlatform().kind).toBe('browser');
  });

  it('returns the desktop platform when window.kiteDesktop exists', () => {
    vi.stubGlobal('window', { kiteDesktop: fakeBridge });
    const platform = getPlatform() as DesktopPlatform;
    expect(platform.kind).toBe('desktop');
    expect(platform.version).toBe('0.1.0');
    expect(platform.os).toBe('windows');
  });
});

describe('isDesktop', () => {
  it('is false in a browser', () => {
    vi.stubGlobal('window', {});
    expect(isDesktop()).toBe(false);
  });

  it('is true inside the desktop app', () => {
    vi.stubGlobal('window', { kiteDesktop: fakeBridge });
    expect(isDesktop()).toBe(true);
  });
});
