/**
 * Tests heldAccelerator() and heldRowKeys() in packages/shared/src/hotkeys.ts (ADR-0128): the one rule every screen
 * uses for a shortcut's keys. With no report (a browser) the table's keys for the computer; with a desktop app's
 * report, the keys it holds, for a single shortcut and for a group row ("Control+Left / Right", the zoom keys, the
 * arrows). The reports below are what each released app holds, rebuilt from its release's table: Mac 1.8.0
 * (ADR-0110 as of 19 Nov 2026: ⌘ for Answer, ⌃⌥ for Clear, previous / next and zoom, ⌃⌘ arrows for the jumps),
 * Windows 1.7.4 (Ctrl+Alt+H for show or hide), Windows 1.6.5 (Ctrl+Alt+Arrows for the jumps), and today's Mac 1.8.1
 * and Windows 1.7.5 (the table itself).
 */
import {
  DEFAULT_GLOBAL_HOTKEYS,
  GLOBAL_HOTKEYS,
  globalHotkeys,
  heldAccelerator,
  heldRowKeys,
  hotkeyLabel,
  hotkeyRows,
  type CallHotkey,
  type HotkeyRow,
  type HotkeyStatus,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';

/**
 * A desktop app's report: every call shortcut it holds, plus Ask AI and Transcript, all registered.
 *
 * @param keys       Its call shortcuts.
 * @param askKite    Its Ask AI key.
 * @param transcript The Transcript key it checks.
 * @returns The statuses, as checkHotkeys() returns them.
 */
function report(
  keys: Readonly<Record<CallHotkey, string>>,
  askKite: string,
  transcript: string,
): HotkeyStatus[] {
  return [
    ...GLOBAL_HOTKEYS.map((action) => ({ action, accelerator: keys[action], registered: true })),
    { action: 'transcript', accelerator: transcript, registered: true },
    { action: 'ask-kite', accelerator: askKite, registered: true },
  ];
}

/** Windows 1.7.4: today's table with Ctrl+Alt+H for show or hide. */
const WINDOWS_174 = report(
  { ...DEFAULT_GLOBAL_HOTKEYS, 'overlay-toggle': 'CommandOrControl+Alt+H' },
  'CommandOrControl+Alt+K',
  'CommandOrControl+Alt+T',
);

/** Windows 1.6.5: as 1.7.4, with the jumps on Ctrl+Alt+Arrows (ADR-0095 moved them in 1.7.0). */
const WINDOWS_165 = report(
  {
    ...DEFAULT_GLOBAL_HOTKEYS,
    'overlay-toggle': 'CommandOrControl+Alt+H',
    'overlay-spot-left': 'CommandOrControl+Alt+Left',
    'overlay-spot-right': 'CommandOrControl+Alt+Right',
    'overlay-row-top': 'CommandOrControl+Alt+Up',
    'overlay-row-bottom': 'CommandOrControl+Alt+Down',
  },
  'CommandOrControl+Alt+K',
  'CommandOrControl+Alt+T',
);

/** Mac 1.8.0: its DEFAULT_GLOBAL_HOTKEYS (Ctrl+Alt+H) with MAC_HOTKEY_CHANGES, as released (0fab1af). */
const MAC_180 = report(
  {
    ...DEFAULT_GLOBAL_HOTKEYS,
    'clear-transcript': 'Control+Alt+Shift+Backspace',
    clear: 'Control+Alt+Backspace',
    prev: 'Control+Alt+Left',
    next: 'Control+Alt+Right',
    'zoom-in': 'Control+Alt+=',
    'zoom-out': 'Control+Alt+-',
    'zoom-reset': 'Control+Alt+0',
    'overlay-toggle': 'Control+Alt+H',
    'overlay-spot-left': 'Control+Command+Left',
    'overlay-spot-right': 'Control+Command+Right',
    'overlay-row-top': 'Control+Command+Up',
    'overlay-row-bottom': 'Control+Command+Down',
  },
  'CommandOrControl+Alt+K',
  'CommandOrControl+Alt+T',
);

/** Mac 1.8.1 and Windows 1.7.5: the table itself. */
const MAC_181 = report(globalHotkeys(true), 'Control+Alt+K', 'Control+Alt+T');
const WINDOWS_175 = report(
  globalHotkeys(false),
  'CommandOrControl+Alt+K',
  'CommandOrControl+Alt+T',
);

/**
 * The words a row shows for a report.
 *
 * @param mac      True for the Mac's rows.
 * @param action   One of the row's shortcuts.
 * @param statuses The report.
 * @returns The keys in words.
 */
function rowWords(mac: boolean, action: string, statuses: HotkeyStatus[] | null): string {
  const row = hotkeyRows(mac).find((candidate: HotkeyRow) =>
    (candidate.actions as readonly string[]).includes(action),
  )!;
  return hotkeyLabel(heldRowKeys(row, statuses, mac), mac);
}

describe('heldAccelerator (ADR-0128)', () => {
  it('gives the table’s keys with no report: a browser, or before the app answers', () => {
    expect(heldAccelerator('answer', false, null)).toBe('CommandOrControl+Enter');
    expect(heldAccelerator('answer', true, null)).toBe('Control+Enter');
    expect(hotkeyLabel(heldAccelerator('ask-kite', true, null), true)).toBe('⌃ ⌥ K');
  });

  it('gives the keys a Mac 1.8.0 app holds until it updates', () => {
    expect(hotkeyLabel(heldAccelerator('answer', true, MAC_180), true)).toBe('⌘ ↵');
    expect(hotkeyLabel(heldAccelerator('clear', true, MAC_180), true)).toBe('⌃ ⌥ ⌫');
    expect(hotkeyLabel(heldAccelerator('overlay-toggle', true, MAC_180), true)).toBe('⌃ ⌥ H');
    expect(hotkeyLabel(heldAccelerator('ask-kite', true, MAC_180), true)).toBe('⌘ ⌥ K');
  });

  it('gives Ctrl+Alt+H for show or hide in a Windows 1.7.4 app, and Ctrl+Alt+Y from 1.7.5', () => {
    expect(heldAccelerator('overlay-toggle', false, WINDOWS_174)).toBe('CommandOrControl+Alt+H');
    expect(heldAccelerator('overlay-toggle', false, WINDOWS_175)).toBe('CommandOrControl+Alt+Y');
    expect(heldAccelerator('answer', false, WINDOWS_174)).toBe('CommandOrControl+Enter');
  });

  it('keeps the table’s Transcript key whatever the app checked (the page reads it, never the app)', () => {
    expect(hotkeyLabel(heldAccelerator('transcript', true, MAC_180), true)).toBe('⌃ ⌥ T');
  });

  it('agrees with the table for today’s apps on both computers', () => {
    for (const action of GLOBAL_HOTKEYS) {
      expect(heldAccelerator(action, true, MAC_181)).toBe(globalHotkeys(true)[action]);
      expect(heldAccelerator(action, false, WINDOWS_175)).toBe(globalHotkeys(false)[action]);
    }
  });
});

describe('heldRowKeys (ADR-0128, ADR-0095 generalised)', () => {
  it('shows the table’s rows with no report', () => {
    expect(rowWords(true, 'prev', null)).toBe('⌃ ← / →');
    expect(rowWords(false, 'prev', null)).toBe('Ctrl+← / →');
    expect(rowWords(true, 'zoom-in', null)).toBe('⌃ = / - / 0');
  });

  it('shows a Mac 1.8.0 app’s group rows with its own modifiers (they showed the new keys before)', () => {
    expect(rowWords(true, 'prev', MAC_180)).toBe('⌃ ⌥ ← / →');
    expect(rowWords(true, 'zoom-in', MAC_180)).toBe('⌃ ⌥ = / - / 0');
    expect(rowWords(true, 'overlay-row-top', MAC_180)).toBe('⌃ ⌘ Arrows');
    // 1.8.0 kept the Windows nudge keys, which are ⌘ on a Mac.
    expect(rowWords(true, 'overlay-up', MAC_180)).toBe('⌘ ⌥ ⇧ Arrows');
    expect(rowWords(true, 'answer', MAC_180)).toBe('⌘ ↵');
    expect(rowWords(true, 'clear-transcript', MAC_180)).toBe('⌃ ⌥ ⇧ ⌫');
  });

  it('shows a Windows 1.6.5 app’s Ctrl+Alt+Arrows and a 1.7.4 app’s Ctrl+Alt+H', () => {
    expect(rowWords(false, 'overlay-row-top', WINDOWS_165)).toBe('Ctrl+Alt+Arrows');
    expect(rowWords(false, 'overlay-toggle', WINDOWS_174)).toBe('Ctrl+Alt+H');
    expect(rowWords(false, 'overlay-row-top', WINDOWS_174)).toBe('Ctrl+Shift+Arrows');
  });

  it('shows every row as the table has it for today’s apps', () => {
    for (const mac of [true, false]) {
      for (const row of hotkeyRows(mac)) {
        const statuses = mac ? MAC_181 : WINDOWS_175;
        expect(heldRowKeys(row, statuses, mac)).toBe(row.keysOverride ?? row.accelerator);
      }
    }
  });
});
