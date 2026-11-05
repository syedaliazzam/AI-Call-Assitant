/**
 * Tests packages/shared/src/hotkeys.ts (v1.0.2, ADR-0035): no two Kite shortcuts share keys — the
 * call shortcuts, the focused ones and Ask Kite together — so adding the script bar (Ctrl+Alt+S)
 * cannot shadow another Kite shortcut; every global shortcut has a Settings row, and the script
 * bar is a page action the shell forwards (like Answer), not an overlay action.
 */
import {
  ASK_KITE_HOTKEY,
  DEFAULT_GLOBAL_HOTKEYS,
  FOCUSED_HOTKEYS,
  GLOBAL_HOTKEYS,
  HOTKEY_ACTIONS,
  hotkeyAccelerator,
  keycapParts,
  HOTKEY_ROWS,
  SCREENSHOT_SEND_HOTKEY,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';

describe('key-cap chips (spec §4)', () => {
  it('reads every kind of shortcut from the one map', () => {
    expect(hotkeyAccelerator('answer')).toBe(DEFAULT_GLOBAL_HOTKEYS.answer);
    expect(hotkeyAccelerator('clear-transcript')).toBe(FOCUSED_HOTKEYS['clear-transcript']);
    expect(hotkeyAccelerator('ask-kite')).toBe(ASK_KITE_HOTKEY);
  });

  it('draws the keys as the bars show them', () => {
    expect(keycapParts(hotkeyAccelerator('answer'), false)).toEqual(['Ctrl', '↵']);
    expect(keycapParts(hotkeyAccelerator('screenshot'), false)).toEqual(['Ctrl', '⇧', '↵']);
    expect(keycapParts(hotkeyAccelerator('chat'), false)).toEqual(['Ctrl', '⇧', '␣']);
    expect(keycapParts(hotkeyAccelerator('clear-transcript'), false)).toEqual(['Ctrl', '⇧', '⌫']);
    expect(keycapParts(hotkeyAccelerator('prev'), false)).toEqual(['Ctrl', '←']);
  });

  it('shows ⌘ and ⌥ on macOS', () => {
    expect(keycapParts(hotkeyAccelerator('answer'), true)).toEqual(['⌘', '↵']);
    expect(keycapParts(hotkeyAccelerator('ask-kite'), true)).toEqual(['⌘', '⌥', 'K']);
  });
});

describe('Kite shortcuts', () => {
  it('never share an accelerator (global, focused and Ask Kite together)', () => {
    const all = [
      ...Object.values(DEFAULT_GLOBAL_HOTKEYS),
      ...Object.values(FOCUSED_HOTKEYS),
      ASK_KITE_HOTKEY,
    ].map((accelerator) => accelerator.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });

  it('give the script bar Ctrl+Alt+S, as a page action with a Settings row', () => {
    expect(DEFAULT_GLOBAL_HOTKEYS['script-bar']).toBe('CommandOrControl+Alt+S');
    expect(GLOBAL_HOTKEYS).toContain('script-bar');
    expect(HOTKEY_ACTIONS).toContain('script-bar');
    expect(HOTKEY_ROWS.find((row) => row.label === 'Script bar')).toMatchObject({
      scope: 'global',
      actions: ['script-bar'],
    });
  });

  it('list every global shortcut in exactly one Settings row', () => {
    const listed = HOTKEY_ROWS.flatMap((row) => row.actions);
    expect([...listed].sort()).toEqual([...GLOBAL_HOTKEYS, 'ask-kite', 'screenshot-send'].sort());
  });

  it('the chat bar has its key-caps from the map, and Settings lists the new shortcut', () => {
    expect(hotkeyAccelerator('screenshot-send')).toBe('CommandOrControl+Alt+Enter');
    expect(hotkeyAccelerator('chat-send')).toBe('Enter');
    expect(keycapParts(hotkeyAccelerator('screenshot-send'), false)).toEqual(['Ctrl', 'Alt', '↵']);
    expect(keycapParts(hotkeyAccelerator('chat-send'), false)).toEqual(['↵']);
    const row = HOTKEY_ROWS.find((one) => one.actions.includes('screenshot-send'));
    expect(row?.accelerator).toBe(SCREENSHOT_SEND_HOTKEY);
    expect(HOTKEY_ACTIONS).toContain('screenshot-send');
  });
});
