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
  HOTKEY_ROWS,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';

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
    expect([...listed].sort()).toEqual([...GLOBAL_HOTKEYS, 'ask-kite'].sort());
  });
});
