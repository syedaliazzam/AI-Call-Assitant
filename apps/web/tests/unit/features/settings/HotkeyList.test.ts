/**
 * Tests for rowHasConflict() in apps/web/src/features/settings/HotkeyList.tsx, and the shared
 * hotkey list (ADR-0029): a row reports a conflict only for its own global shortcuts; focused
 * shortcuts never conflict; labels read correctly on Windows and macOS.
 */
import { DEFAULT_GLOBAL_HOTKEYS, HOTKEY_ROWS, hotkeyLabel, type HotkeyStatus } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({ getPlatform: () => ({}) }));
const { rowHasConflict } = await import('@/features/settings/HotkeyList');

/** A status saying the overlay's upward move is taken. */
const TAKEN: HotkeyStatus[] = [
  { action: 'overlay-up', accelerator: DEFAULT_GLOBAL_HOTKEYS['overlay-up'], registered: false },
  { action: 'answer', accelerator: DEFAULT_GLOBAL_HOTKEYS.answer, registered: true },
];

describe('rowHasConflict', () => {
  it('reports only the row that holds the taken shortcut', () => {
    const flagged = HOTKEY_ROWS.filter((row) => rowHasConflict(row, TAKEN));
    expect(flagged.map((row) => row.label)).toEqual(['Move overlay (add Shift for bigger steps)']);
  });

  it('reports nothing before a check, or in a browser', () => {
    expect(HOTKEY_ROWS.some((row) => rowHasConflict(row, null))).toBe(false);
  });
});

describe('hotkeyLabel', () => {
  it('reads correctly on Windows and macOS', () => {
    expect(hotkeyLabel('CommandOrControl+Shift+Enter', false)).toBe('Ctrl+Shift+↵');
    expect(hotkeyLabel('CommandOrControl+Shift+Enter', true)).toBe('⌘ ⇧ ↵');
    expect(hotkeyLabel('CommandOrControl+Alt+H', false)).toBe('Ctrl+Alt+H');
    expect(hotkeyLabel('CommandOrControl+Left', true)).toBe('⌘ ←');
    expect(hotkeyLabel('CommandOrControl+Backspace', false)).toBe('Ctrl+⌫');
  });
});
