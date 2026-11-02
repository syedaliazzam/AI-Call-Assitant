/**
 * Tests for apps/web/src/core/storage/sidebarPrefs.ts and the desktop-banner part of
 * dashboardPrefs.ts: the sidebar starts open and remembers being collapsed; the banner shows until
 * it is dismissed; blocked storage leaves the defaults and never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_BANNER_KEY,
  dismissDesktopBanner,
  getDesktopBannerDismissed,
} from '@/core/storage/dashboardPrefs';
import {
  SIDEBAR_COLLAPSED_KEY,
  getSidebarCollapsed,
  setSidebarCollapsedPref,
} from '@/core/storage/sidebarPrefs';

/**
 * Installs a working localStorage stand-in.
 *
 * @returns The values it holds.
 */
function fakeStorage(): Map<string, string> {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
  return values;
}

/** Installs a localStorage whose every call throws, like a blocked private window. */
function blockedStorage(): void {
  const blocked = () => {
    throw new Error('blocked');
  };
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sidebar collapsed', () => {
  it('starts open and remembers the choice', () => {
    const values = fakeStorage();
    expect(getSidebarCollapsed()).toBe(false);
    setSidebarCollapsedPref(true);
    expect(values.get(SIDEBAR_COLLAPSED_KEY)).toBe('true');
    expect(getSidebarCollapsed()).toBe(true);
    setSidebarCollapsedPref(false);
    expect(getSidebarCollapsed()).toBe(false);
  });

  it('stays open and does not throw when storage is blocked', () => {
    blockedStorage();
    expect(() => setSidebarCollapsedPref(true)).not.toThrow();
    expect(getSidebarCollapsed()).toBe(false);
  });
});

describe('desktop banner', () => {
  it('shows until dismissed, then stays dismissed', () => {
    const values = fakeStorage();
    expect(getDesktopBannerDismissed()).toBe(false);
    dismissDesktopBanner();
    expect(values.get(DESKTOP_BANNER_KEY)).toBe('true');
    expect(getDesktopBannerDismissed()).toBe(true);
  });

  it('keeps showing and does not throw when storage is blocked', () => {
    blockedStorage();
    expect(() => dismissDesktopBanner()).not.toThrow();
    expect(getDesktopBannerDismissed()).toBe(false);
  });
});
