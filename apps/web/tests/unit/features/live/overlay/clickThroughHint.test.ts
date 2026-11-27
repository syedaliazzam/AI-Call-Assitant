/**
 * Tests for apps/web/src/features/live/overlay/clickThroughHint.ts (ADR-0055 amended 26 Nov 2026): bar 1's hint
 * while the whole overlay passes clicks names the one key that turns Click-through off, Ctrl+Alt+X on Windows
 * and ⌃ ⌥ X on a Mac, in the words the developer asked for.
 */
import { describe, expect, it } from 'vitest';
import { clickThroughHint, clickThroughKeyLabel } from '@/features/live/overlay/clickThroughHint';

describe('clickThroughHint', () => {
  it('names Ctrl+Alt+X on Windows', () => {
    expect(clickThroughKeyLabel(false)).toBe('Ctrl+Alt+X');
    expect(clickThroughHint(false)).toBe('Click-through on — press Ctrl+Alt+X to turn off');
  });

  it('names ⌃ ⌥ X on a Mac (Mac 1.8.1: Control for Ctrl)', () => {
    expect(clickThroughKeyLabel(true)).toBe('⌃ ⌥ X');
    expect(clickThroughHint(true)).toBe('Click-through on — press ⌃ ⌥ X to turn off');
  });
});
