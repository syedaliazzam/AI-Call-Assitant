/**
 * Tests shortKeys() in apps/web/src/features/live/CompactView.tsx (v1.0.3): the overlay's key hints
 * in the reference's short form, on Windows and macOS.
 */
import { DEFAULT_GLOBAL_HOTKEYS, FOCUSED_HOTKEYS } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { shortKeys } from '@/features/live/CompactView';

describe('shortKeys', () => {
  it('writes Answer, Screenshot and Chat as Ctrl↵, Ctrl⇧↵ and Ctrl⇧⌫ (⌘↵… on a Mac)', () => {
    expect(shortKeys(DEFAULT_GLOBAL_HOTKEYS.answer, false)).toBe('Ctrl↵');
    expect(shortKeys(DEFAULT_GLOBAL_HOTKEYS.screenshot, false)).toBe('Ctrl⇧↵');
    expect(shortKeys(FOCUSED_HOTKEYS.chat, false)).toBe('Ctrl⇧⌫');
    expect(shortKeys(DEFAULT_GLOBAL_HOTKEYS.answer, true)).toBe('⌘↵');
    expect(shortKeys(FOCUSED_HOTKEYS.chat, true)).toBe('⌘⇧⌫');
  });
});
