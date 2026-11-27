/**
 * Tests apps/web/src/ui/shownKeys.ts (ADR-0128): the one place the screens read a shortcut's keys from. Before the
 * desktop app answers (and always in a browser) the table's keys for the computer; after it reports, the keys it
 * holds (a Mac 1.8.0 app's ⌘ ↵); a newer report from Settings → Hotkeys replaces it; the app is asked once per page.
 */
import type { HotkeyStatus } from '@kite/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const checkHotkeys = vi.fn<() => Promise<HotkeyStatus[] | null>>();
vi.mock('@/platform', () => ({ getPlatform: () => ({ checkHotkeys }) }));

const { forgetHeldHotkeys, rememberHeldHotkeys, shownAccelerator, shownKeyLabel, useHeldHotkeys } =
  await import('@/ui/shownKeys');

/** A Mac 1.8.0 app's report for Answer (⌘ ↵). */
const MAC_180_ANSWER: HotkeyStatus[] = [
  { action: 'answer', accelerator: 'CommandOrControl+Enter', registered: true },
];

afterEach(() => {
  forgetHeldHotkeys();
  checkHotkeys.mockReset();
});

describe('shownAccelerator / shownKeyLabel', () => {
  it('gives the table’s keys before any report', () => {
    expect(shownAccelerator('answer', false)).toBe('CommandOrControl+Enter');
    expect(shownKeyLabel('answer', false)).toBe('Ctrl+↵');
    expect(shownKeyLabel('answer', true)).toBe('⌃ ↵');
    expect(shownKeyLabel('record', true)).toBe('⌃ ⌥ R');
  });

  it('gives the keys the desktop app reports holding once it has answered', () => {
    rememberHeldHotkeys(MAC_180_ANSWER);
    expect(shownKeyLabel('answer', true)).toBe('⌘ ↵');
    // A shortcut the report does not name keeps the table's keys.
    expect(shownKeyLabel('screenshot', true)).toBe('⌃ ⇧ ↵');
  });

  it('takes a newer report (Settings → Hotkeys checks again) and a null one (nothing held)', () => {
    rememberHeldHotkeys(MAC_180_ANSWER);
    rememberHeldHotkeys([{ action: 'answer', accelerator: 'Control+Enter', registered: true }]);
    expect(shownKeyLabel('answer', true)).toBe('⌃ ↵');
    rememberHeldHotkeys(null);
    expect(shownKeyLabel('answer', true)).toBe('⌃ ↵');
  });
});

describe('useHeldHotkeys', () => {
  it('is a hook that subscribes to the report (it renders null on the server)', () => {
    expect(typeof useHeldHotkeys).toBe('function');
    expect(checkHotkeys).not.toHaveBeenCalled();
  });
});
