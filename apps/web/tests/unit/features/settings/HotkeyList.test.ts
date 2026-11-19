/**
 * Tests for rowHasConflict() in apps/web/src/features/settings/HotkeyList.tsx, and the shared
 * hotkey list (ADR-0029): a row reports a conflict only for its own global shortcuts; focused
 * shortcuts never conflict; labels read correctly on Windows and macOS; v1.3.0 (ADR-0056): a desktop
 * app with the six positions (and the browser) gets the jump, nudge and Transcript rows, an older one
 * its own move row. Desktop 1.5.0 (ADR-0068): the recording row (Ctrl+Alt+R) only where meetings can be
 * recorded, and it reports a conflict when another app holds the keys. ADR-0110: a Mac lists the Mac keys.
 */
import { DEFAULT_GLOBAL_HOTKEYS, HOTKEY_ROWS, hotkeyLabel, type HotkeyStatus } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({ getPlatform: () => ({}) }));
const { hotkeyRowsFor, rowHasConflict, rowKeys } = await import('@/features/settings/HotkeyList');

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

describe('the recording row (desktop 1.5.0, ADR-0068)', () => {
  it('shows only where meetings can be recorded, and reports a taken Ctrl+Alt+R', () => {
    const label = 'Start or stop recording (asks first)';
    expect(hotkeyRowsFor(true).map((row) => row.label)).not.toContain(label);
    expect(hotkeyRowsFor(true, true).map((row) => row.label)).toContain(label);
    const taken: HotkeyStatus[] = [
      { action: 'record', accelerator: DEFAULT_GLOBAL_HOTKEYS.record, registered: false },
    ];
    expect(HOTKEY_ROWS.filter((row) => rowHasConflict(row, taken)).map((row) => row.label)).toEqual(
      [label],
    );
    expect(DEFAULT_GLOBAL_HOTKEYS.record).toBe('CommandOrControl+Alt+R');
  });
});

describe('the keys a row shows (ADR-0095)', () => {
  const move = HOTKEY_ROWS.find((row) => row.actions.includes('overlay-row-top'))!;

  it('shows Ctrl+Shift+Arrows for moving the overlay, in a browser and in desktop 1.7.0', () => {
    expect(rowKeys(move, null)).toBe('CommandOrControl+Shift+Arrows');
    const current: HotkeyStatus[] = [
      { action: 'overlay-row-top', accelerator: 'CommandOrControl+Shift+Up', registered: true },
    ];
    expect(rowKeys(move, current)).toBe('CommandOrControl+Shift+Arrows');
  });

  it('shows the keys an older desktop app reports (Ctrl+Alt+Arrows until 1.6.5)', () => {
    const older: HotkeyStatus[] = [
      { action: 'overlay-row-top', accelerator: 'CommandOrControl+Alt+Up', registered: true },
    ];
    expect(rowKeys(move, older)).toBe('CommandOrControl+Alt+Arrows');
  });

  it('shows a plain row as it is when the app holds the same keys', () => {
    const answer = HOTKEY_ROWS.find((row) => row.actions.includes('answer'))!;
    expect(rowKeys(answer, TAKEN)).toBe(DEFAULT_GLOBAL_HOTKEYS.answer);
  });
});

describe('Settings on a Mac (ADR-0110)', () => {
  it('lists the Mac keys, and a Mac app reporting them shows them as they are', () => {
    const rows = hotkeyRowsFor(true, true, true);
    const clear = rows.find((row) => row.actions.includes('clear'))!;
    expect(clear.accelerator).toBe('Control+Alt+Backspace');
    const held: HotkeyStatus[] = [
      { action: 'clear', accelerator: 'Control+Alt+Backspace', registered: true },
    ];
    expect(rowKeys(clear, held, true)).toBe('Control+Alt+Backspace');
    expect(hotkeyLabel(rowKeys(clear, held, true), true)).toBe('⌃ ⌥ ⌫');
  });
});
