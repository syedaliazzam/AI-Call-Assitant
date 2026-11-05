/**
 * Tests for apps/web/src/core/storage/sidebarPrefs.ts: the sidebar starts open and remembers being
 * collapsed; the desktop app card shows until it is hidden; blocked storage leaves the defaults and
 * never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_CARD_HIDDEN_KEY,
  SIDEBAR_COLLAPSED_KEY,
  getDesktopCardHidden,
  getSidebarCollapsed,
  setDesktopCardHidden,
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

describe('the desktop app card', () => {
  it('shows until hidden, then stays hidden', () => {
    const values = fakeStorage();
    expect(getDesktopCardHidden()).toBe(false);
    setDesktopCardHidden();
    expect(values.get(DESKTOP_CARD_HIDDEN_KEY)).toBe('true');
    expect(getDesktopCardHidden()).toBe(true);
  });

  it('keeps showing and does not throw when storage is blocked', () => {
    blockedStorage();
    expect(() => setDesktopCardHidden()).not.toThrow();
    expect(getDesktopCardHidden()).toBe(false);
  });
});
