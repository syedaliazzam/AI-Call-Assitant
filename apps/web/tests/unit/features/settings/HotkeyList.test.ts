/**
 * Tests for rowHasConflict() in apps/web/src/features/settings/HotkeyList.tsx, and the shared
 * hotkey list (ADR-0029): a row reports a conflict only for its own global shortcuts; focused
 * shortcuts never conflict; labels read correctly on Windows and macOS; v1.3.0 (ADR-0056): a desktop
 * app with the six positions (and the browser) gets the jump, nudge and Transcript rows, an older one
 * its own move row.
 */
import { DEFAULT_GLOBAL_HOTKEYS, HOTKEY_ROWS, hotkeyLabel, type HotkeyStatus } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({ getPlatform: () => ({}) }));
const { hotkeyRowsFor, rowHasConflict } = await import('@/features/settings/HotkeyList');

/** A status saying the overlay's upward move is taken. */
const TAKEN: HotkeyStatus[] = [
  { action: 'overlay-up', accelerator: DEFAULT_GLOBAL_HOTKEYS['overlay-up'], registered: false },
  { action: 'answer', accelerator: DEFAULT_GLOBAL_HOTKEYS.answer, registered: true },
];

describe('rowHasConflict', () => {
  it('reports only the row that holds the taken shortcut', () => {
    const flagged = HOTKEY_ROWS.filter((row) => rowHasConflict(row, TAKEN));
    expect(flagged.map((row) => row.label)).toEqual(['Nudge overlay']);
  });

  it('reports Transcript when another app holds Ctrl+Alt+T', () => {
    const taken: HotkeyStatus[] = [
      { action: 'transcript', accelerator: 'CommandOrControl+Alt+T', registered: false },
    ];
    expect(HOTKEY_ROWS.filter((row) => rowHasConflict(row, taken)).map((row) => row.label)).toEqual(
      ['Transcript on or off (while the bars have focus)'],
    );
  });

  it('shows the rows for the desktop app’s version', () => {
    const labels = (positions: boolean) => hotkeyRowsFor(positions).map((row) => row.label);
    expect(labels(true)).toContain('Nudge overlay');
    expect(labels(true)).toContain('Transcript on or off (while the bars have focus)');
    expect(labels(true)).not.toContain('Move overlay (add Shift for bigger steps)');
    expect(labels(false)).toContain('Move overlay (add Shift for bigger steps)');
    expect(labels(false)).not.toContain('Nudge overlay');
    expect(labels(false)).not.toContain('Transcript on or off (while the bars have focus)');
    expect(labels(false)).toContain('Answer');
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
