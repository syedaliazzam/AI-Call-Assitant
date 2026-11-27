/**
 * Tests apps/web/src/features/help/guideKeys.ts and the guide's keys (ADR-0128): on a Mac, /help writes the keys in
 * bold as the Mac's (⌃ ⌥ K), groups too (⌃ ← / ⌃ →, ⌃ ⇧ ← / →); elsewhere it leaves them as written. Every key the
 * guide names in bold is one of the shared table's, so the guide cannot drift from Settings. The guide's Hotkeys
 * section is the {{hotkeys}} marker (Settings → Hotkeys' own list), not a hand-written table, and no longer says
 * ⌘ ⌥ X for Click-through on a Mac.
 */
import { ASK_KITE_HOTKEY, DEFAULT_GLOBAL_HOTKEYS, TRANSCRIPT_HOTKEY } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { inlinePieces, markdownBlocks } from '@/core/answer/markdown';
import {
  GUIDE_KEYS,
  guideAccelerator,
  guideKeysFor,
  HOTKEYS_MARKER,
} from '@/features/help/guideKeys';
import { USER_GUIDE_MD } from '@/features/help/guideText';

describe('guideKeysFor', () => {
  it('writes the Mac’s keys on a Mac', () => {
    expect(guideKeysFor('Ctrl+Alt+K', true)).toBe('⌃ ⌥ K');
    expect(guideKeysFor('Ctrl+Enter', true)).toBe('⌃ ↵');
    expect(guideKeysFor('Ctrl+Shift+Space', true)).toBe('⌃ ⇧ ␣');
    expect(guideKeysFor('Ctrl+=', true)).toBe('⌃ =');
    expect(guideKeysFor('Ctrl+-', true)).toBe('⌃ -');
    expect(guideKeysFor('Ctrl+Left / Ctrl+Right', true)).toBe('⌃ ← / ⌃ →');
    expect(guideKeysFor('Ctrl+Shift+Left / Right', true)).toBe('⌃ ⇧ ← / →');
    expect(guideKeysFor('Ctrl+Alt+Shift+Arrows', true)).toBe('⌃ ⌥ ⇧ Arrows');
    expect(guideKeysFor('Click-through on — press Ctrl+Alt+X to turn off', true)).toBe(
      'Click-through on — press ⌃ ⌥ X to turn off',
    );
  });

  it('leaves the words alone on Windows, and words that are not keys everywhere', () => {
    expect(guideKeysFor('Ctrl+Alt+K', false)).toBe('Ctrl+Alt+K');
    expect(guideKeysFor('Enter a message…', true)).toBe('Enter a message…');
    expect(guideKeysFor('W', true)).toBe('W');
    expect(guideKeysFor('Control (⌃)', true)).toBe('Control (⌃)');
  });
});

describe('the guide’s keys', () => {
  it('names in bold only keys of the shared table', () => {
    const table = new Set([
      ...Object.values(DEFAULT_GLOBAL_HOTKEYS),
      ASK_KITE_HOTKEY,
      TRANSCRIPT_HOTKEY,
    ]);
    const bold = markdownBlocks(USER_GUIDE_MD)
      .flatMap((block) =>
        block.kind === 'list' ? block.items : block.kind === 'code' ? [] : [block.text],
      )
      .flatMap((line) => inlinePieces(line))
      .filter((piece) => piece.style === 'bold')
      .map((piece) => piece.text);
    const keys = bold.flatMap((text) => text.match(GUIDE_KEYS) ?? []);
    expect(keys.length).toBeGreaterThan(10);
    for (const group of keys) {
      for (const part of group.split(' / ')) {
        // A bare arrow belongs to the part before it ("Ctrl+Shift+Left / Right").
        if (!/^(Ctrl|Alt)\+/.test(part)) continue;
        const accelerator = guideAccelerator(part).replace(/\+Arrows$/, '+Left');
        expect(table, `${group} is not in the hotkey table`).toContain(accelerator);
      }
    }
  });

  it('shows Settings → Hotkeys’ list in place of a table, and no ⌘ ⌥ X for Click-through', () => {
    expect(USER_GUIDE_MD).toContain(`\n${HOTKEYS_MARKER}\n`);
    expect(USER_GUIDE_MD).not.toContain('| Action |');
    expect(USER_GUIDE_MD).not.toContain('⌘ ⌥ X');
  });
});
