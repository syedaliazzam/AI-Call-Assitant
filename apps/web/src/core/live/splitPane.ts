/**
 * File: apps/web/src/core/live/splitPane.ts
 * Purpose: The browser split call view's resizable divider (ADR companion to the live-ui-split
 *          work): the left column (the shared-tab preview) takes a fraction of the width, kept
 *          between SPLIT_RANGE.min and .max and remembered per device. Pure helpers plus two
 *          localStorage accessors, so the maths is unit-tested and the storage never throws.
 * Used by: src/features/live/BrowserCallLayout.tsx
 * Depends on: localStorage
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session)
 */

/** The left column's width as a fraction of the split: smallest, largest and the starting value. */
export const SPLIT_RANGE = { min: 0.3, max: 0.7, default: 0.5 } as const;

/** The localStorage key of the remembered split fraction. */
export const SPLIT_KEY = 'kite.splitFraction';

/**
 * Keeps a fraction inside the allowed range (and turns anything not a finite number into the
 * default).
 *
 * @param fraction A left-column width fraction.
 * @returns The fraction, clamped to [SPLIT_RANGE.min, SPLIT_RANGE.max].
 * Called from: getSplit(), BrowserCallLayout (while dragging); tests
 */
export function clampSplit(fraction: number): number {
  if (!Number.isFinite(fraction)) return SPLIT_RANGE.default;
  return Math.min(SPLIT_RANGE.max, Math.max(SPLIT_RANGE.min, fraction));
}

/**
 * The remembered split fraction for this device.
 *
 * @returns The saved fraction (clamped), or SPLIT_RANGE.default when none is saved or storage is
 *          blocked.
 * Called from: BrowserCallLayout
 */
export function getSplit(): number {
  try {
    const stored = localStorage.getItem(SPLIT_KEY);
    return stored === null ? SPLIT_RANGE.default : clampSplit(Number(stored));
  } catch {
    return SPLIT_RANGE.default;
  }
}

/**
 * Saves the split fraction for this device (clamped first). The default is stored as nothing, so a
 * device that never moved the divider keeps using whatever the default is.
 *
 * @param fraction The fraction to save.
 * @returns Nothing.
 * Called from: BrowserCallLayout (when the drag ends)
 */
export function setSplit(fraction: number): void {
  try {
    const value = clampSplit(fraction);
    if (value === SPLIT_RANGE.default) localStorage.removeItem(SPLIT_KEY);
    else localStorage.setItem(SPLIT_KEY, String(value));
  } catch {
    // Storage blocked: the divider simply resets to the default next time.
  }
}
