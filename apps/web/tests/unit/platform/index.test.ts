/**
 * Tests for apps/web/src/platform/index.ts:
 * getPlatform() picks the browser platform without `window.kiteDesktop` (and on the server),
 * the desktop platform with it; isDesktop() and getDesktopInfo() follow the same rule; isMacComputer()
 * (ADR-0109) follows the desktop app's OS, or the browser's computer.
 */
import type { KiteDesktopApi } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import { getDesktopInfo, getPlatform, isDesktop, isMacComputer } from '@/platform';
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

describe('getDesktopInfo', () => {
  it('returns null in a browser and on the server', () => {
    expect(getDesktopInfo()).toBeNull();
    vi.stubGlobal('window', {});
    expect(getDesktopInfo()).toBeNull();
  });

  it('returns the shell version and OS inside the desktop app', () => {
    vi.stubGlobal('window', { kiteDesktop: fakeBridge });
    expect(getDesktopInfo()).toEqual({ version: '0.1.0', os: 'windows' });
  });
});

describe('isMacComputer (ADR-0109)', () => {
  it('is false on the server', () => {
    expect(isMacComputer()).toBe(false);
  });

  it('follows the desktop app’s OS inside the app', () => {
    vi.stubGlobal('window', { kiteDesktop: { ...fakeBridge, os: 'mac' } });
    expect(isMacComputer()).toBe(true);
    vi.stubGlobal('window', { kiteDesktop: fakeBridge });
    expect(isMacComputer()).toBe(false);
  });

  it('follows the computer in a browser', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    expect(isMacComputer()).toBe(true);
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: '' });
    expect(isMacComputer()).toBe(false);
  });
});
