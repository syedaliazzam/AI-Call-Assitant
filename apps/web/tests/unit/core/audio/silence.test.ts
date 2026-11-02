/**
 * Tests for apps/web/src/core/audio/silence.ts (Day 6 Stage 4e): a level above 0.1 is sound,
 * and "Them" counts as silent only after 20 s without sound.
 */
import { describe, expect, it } from 'vitest';
import { isSound, SILENT_AFTER_MS, themSilent } from '@/core/audio/silence';

describe('silence', () => {
  it('treats levels above 0.1 as sound', () => {
    expect(isSound(0)).toBe(false);
    expect(isSound(0.1)).toBe(false);
    expect(isSound(0.3)).toBe(true);
  });

  it('says silent only after 20 s without sound', () => {
    expect(themSilent(1_000, 1_000 + SILENT_AFTER_MS - 1)).toBe(false);
    expect(themSilent(1_000, 1_000 + SILENT_AFTER_MS)).toBe(true);
  });
});
