/**
 * Tests for rowHasConflict() in apps/web/src/features/settings/HotkeyList.tsx, and the shared
 * hotkey list (ADR-0029): a row reports a conflict only for its own global shortcuts; focused
 * shortcuts never conflict; labels read correctly on Windows and macOS; v1.3.0 (ADR-0056): a desktop
 * app with the six positions (and the browser) gets the jump, nudge and Transcript rows, an older one
 * its own move row. Desktop 1.5.0 (ADR-0068): the recording row (Ctrl+Alt+R) only where meetings can be
 * recorded, and it reports a conflict when another app holds the keys. ADR-0110: a Mac lists the Mac keys;
 * amended 25 Nov 2026: a browser marks the desktop-only shortcuts, a taken shortcut says whether it still works
 * with Paramount AI in front or not at all, and a Mac gets the note that macOS may not report a clash.
 * ADR-0055 (amended 26 Nov 2026): a taken Click-through key says it cannot turn Click-through off, and gets a
 * warning of its own naming the key and the ways back (W on bar 1, the call window's button).
 */
import {
  DEFAULT_GLOBAL_HOTKEYS,
  HOTKEY_ROWS,
  hotkeyLabel,
  macSystemNotes,
  type HotkeyStatus,
} from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({ getPlatform: () => ({}) }));
const {
  clickThroughClashWarning,
  conflictEffect,
  hotkeyRowsFor,
  isClickThroughRow,
  MAC_CLASH_NOTE,
  rowHasConflict,
  rowKeys,
  rowWhere,
  statusesForView,
} = await import('@/features/settings/HotkeyList');

describe('the Mac / Windows switch (ADR-0128)', () => {
  const report: HotkeyStatus[] = [
    { action: 'answer', accelerator: 'CommandOrControl+Enter', registered: false },
  ];

  it('uses the desktop app’s report only for this computer’s own set', () => {
    expect(statusesForView(true, true, report)).toBe(report);
    expect(statusesForView(false, false, report)).toBe(report);
    // Viewing the other computer's keys: the table's, and no clash from this app.
    expect(statusesForView(false, true, report)).toBeNull();
    expect(statusesForView(true, false, report)).toBeNull();
  });

  it('lists the Mac’s keys and the Windows keys for the same rows', () => {
    const mac = hotkeyRowsFor(true, true, true);
    const windows = hotkeyRowsFor(true, true, false);
    expect(mac.map((row) => row.label)).toEqual(windows.map((row) => row.label));
    const answer = (rows: typeof mac) => rows.find((row) => row.actions.includes('answer'))!;
    expect(hotkeyLabel(rowKeys(answer(mac), null, true), true)).toBe('⌃ ↵');
    expect(hotkeyLabel(rowKeys(answer(windows), null, false), false)).toBe('Ctrl+↵');
  });

  it('shows a Mac 1.8.0 app’s previous / next and zoom keys (⌃ ⌥), not the new ones', () => {
    const rows = hotkeyRowsFor(true, true, true);
    const row = (action: string) =>
      rows.find((candidate) => (candidate.actions as readonly string[]).includes(action))!;
    const mac180: HotkeyStatus[] = [
      { action: 'prev', accelerator: 'Control+Alt+Left', registered: true },
      { action: 'zoom-in', accelerator: 'Control+Alt+=', registered: true },
    ];
    expect(hotkeyLabel(rowKeys(row('prev'), mac180, true), true)).toBe('⌃ ⌥ ← / →');
    expect(hotkeyLabel(rowKeys(row('zoom-in'), mac180, true), true)).toBe('⌃ ⌥ = / - / 0');
  });
});

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
    // ADR-0123: the Answer row says who it answers.
    expect(labels(false)).toContain(
      'Answer (on a call: their newest question; on your own: yours)',
    );
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

describe('Settings on a Mac (ADR-0110 amended 27 Nov 2026, Mac 1.8.1)', () => {
  it('lists the Mac keys (Control for Ctrl), and a Mac 1.8.0 app reporting its own keys shows those', () => {
    const rows = hotkeyRowsFor(true, true, true);
    const clear = rows.find((row) => row.actions.includes('clear'))!;
    expect(clear.accelerator).toBe('Control+Backspace');
    const now: HotkeyStatus[] = [
      { action: 'clear', accelerator: 'Control+Backspace', registered: true },
    ];
    expect(hotkeyLabel(rowKeys(clear, now, true), true)).toBe('⌃ ⌫');
    // A Mac 1.8.0 app still holds ADR-0110's earlier keys until it updates: the row shows them.
    const old: HotkeyStatus[] = [
      { action: 'clear', accelerator: 'Control+Alt+Backspace', registered: true },
    ];
    expect(hotkeyLabel(rowKeys(clear, old, true), true)).toBe('⌃ ⌥ ⌫');
    // So does a Windows 1.7.4 app for show or hide (Ctrl+Alt+H until 1.7.5).
    const toggle = hotkeyRowsFor(true, true, false).find((row) =>
      row.actions.includes('overlay-toggle'),
    )!;
    const windows174: HotkeyStatus[] = [
      { action: 'overlay-toggle', accelerator: 'CommandOrControl+Alt+H', registered: true },
    ];
    expect(rowKeys(toggle, windows174, false)).toBe('CommandOrControl+Alt+H');
    expect(rowKeys(toggle, null, false)).toBe('CommandOrControl+Alt+Y');
  });

  it('notes the macOS shortcuts a row shares: Mission Control, Teams, text keys, VoiceOver', () => {
    const rows = hotkeyRowsFor(true, true, true);
    const notes = (action: string) =>
      macSystemNotes(rows.find((row) => (row.actions as readonly string[]).includes(action))!);
    expect(notes('prev').join(' ')).toMatch(/Mission Control/);
    expect(notes('zoom-in').join(' ')).toMatch(/Teams/);
    expect(notes('clear').join(' ')).toMatch(/edit text/);
    expect(notes('overlay-toggle').join(' ')).toMatch(/VoiceOver/);
    expect(notes('answer')).toEqual([]);
  });
});

describe('where each shortcut works (ADR-0110, amended 25 Nov 2026)', () => {
  /**
   * The row that holds an action.
   *
   * @param action The action.
   * @returns Its row.
   */
  const rowOf = (action: string) =>
    HOTKEY_ROWS.find((row) => (row.actions as readonly string[]).includes(action))!;

  it('marks show or hide, the moves, Click-through and Rec "Desktop app only" in a browser', () => {
    for (const action of [
      'overlay-toggle',
      'overlay-row-top',
      'overlay-up',
      'click-through',
      'record',
    ]) {
      expect(rowWhere(rowOf(action), false), action).toBe('Desktop app only');
      expect(rowWhere(rowOf(action), true), action).toBe('Any app');
    }
    // The ones the page handles work in a browser tab while it has the keyboard.
    for (const action of ['answer', 'chat', 'clear', 'prev', 'zoom-in', 'script-bar', 'ask-kite']) {
      expect(rowWhere(rowOf(action), false), action).toBe('Paramount AI in front');
      expect(rowWhere(rowOf(action), true), action).toBe('Any app');
    }
    expect(rowWhere(rowOf('transcript'), true)).toBe('Paramount AI in front');
  });

  it('says whether a taken shortcut still works with Paramount AI in front, or not at all', () => {
    expect(conflictEffect(rowOf('answer'))).toBe('works only while Paramount AI is in front');
    expect(conflictEffect(rowOf('clear'))).toBe('works only while Paramount AI is in front');
    expect(conflictEffect(rowOf('overlay-toggle'))).toBe('does not work during calls');
    // ADR-0055 (amended 26 Nov 2026): Click-through's key is the way to turn the mode off.
    expect(conflictEffect(rowOf('click-through'))).toBe(
      'cannot turn Click-through off, so the bars keep their clicks in Click-through mode (W turns it off)',
    );
  });

  it('ADR-0055 (amended 26 Nov 2026): warns on its own when another app holds the Click-through key', () => {
    expect(isClickThroughRow(rowOf('click-through'))).toBe(true);
    expect(isClickThroughRow(rowOf('answer'))).toBe(false);
    const taken: HotkeyStatus[] = [
      {
        action: 'click-through',
        accelerator: DEFAULT_GLOBAL_HOTKEYS['click-through'],
        registered: false,
      },
    ];
    expect(rowHasConflict(rowOf('click-through'), taken)).toBe(true);
    const windows = clickThroughClashWarning(
      hotkeyLabel(rowKeys(rowOf('click-through'), taken), false),
    );
    expect(windows).toContain(
      'Another app uses Ctrl+Alt+X, the shortcut that turns Click-through off',
    );
    expect(windows).toContain('W on bar 1');
    expect(windows).toContain('Turn click-through off');
    expect(
      clickThroughClashWarning(hotkeyLabel(rowKeys(rowOf('click-through'), taken, true), true)),
    ).toContain('⌘ ⌥ X');
  });

  it('on a Mac, says macOS may not report a clash, naming the usual ⌃ ⌥ users', () => {
    expect(MAC_CLASH_NOTE).toContain('macOS may not tell Paramount AI');
    expect(MAC_CLASH_NOTE).toContain('Rectangle');
    expect(MAC_CLASH_NOTE).toContain('VoiceOver');
  });
});
