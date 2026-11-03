/**
 * Tests apps/web/src/core/stt/noiseLine.ts (v1.0.1): a lone, quiet, one-word line at the start of
 * a call ("Tree", "Um", "Wife", from a real call) is dropped; real short answers ("Yes", "No"),
 * louder words, words right after other speech and longer lines are kept.
 */
import { describe, expect, it } from 'vitest';
import { ISOLATION_MS, isNoiseLine } from '@/core/stt/noiseLine';

/** A quiet lone line at the gate's starting threshold (0.004): peak just above it. */
const quiet = { peakRms: 0.006, threshold: 0.004, msSincePrevious: Number.POSITIVE_INFINITY };

describe('isNoiseLine', () => {
  it('drops the lone quiet words heard from noise at the start of a call', () => {
    for (const text of ['TREE', 'UM', 'WIFE']) expect(isNoiseLine({ ...quiet, text })).toBe(true);
  });

  it('keeps real short answers however quiet', () => {
    for (const text of ['YES', 'NO', 'OKAY', 'Right.', 'yeah']) {
      expect(isNoiseLine({ ...quiet, text })).toBe(false);
    }
  });

  it('keeps a lone word that was clearly spoken (well above the threshold)', () => {
    expect(isNoiseLine({ ...quiet, text: 'KUBERNETES', peakRms: 0.05 })).toBe(false);
  });

  it('keeps a word that follows the same speaker closely, and any longer line', () => {
    expect(isNoiseLine({ ...quiet, text: 'TERRAFORM', msSincePrevious: ISOLATION_MS - 1 })).toBe(
      false,
    );
    expect(isNoiseLine({ ...quiet, text: 'I THINK SO' })).toBe(false);
  });
});
