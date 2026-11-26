/**
 * File: apps/web/src/features/live/overlay/usePairWindow.ts
 * Purpose: ADR-0119 amended (27 Nov 2026, like ParakeetAI): while the transcript and the answer sit side by side,
 *          the overlay window is wide enough for their row (about 1.4 × bar 1, overlay/panelWidth.ts
 *          pairWindowWidth()), and it goes back to its own width when they close. The bars do not move or change:
 *          the window grows on the side its position allows (right on a left position, left on a right one, both
 *          halves centred), and the bars' column is held at the width it had (written to its style, no render). Web only: it uses the
 *          resize steps every desktop app has had since 1.0.2 (resizeOverlay), so Windows 1.7.4 and Mac 1.8.0 need
 *          no release. Where there are none (a browser's picture-in-picture window) nothing grows, and the row is
 *          as wide as the window allows.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: src/features/live/overlay/panelWidth.ts (pairWindowWidth, widthSteps), src/core/storage/overlayPrefs.ts
 *             (getPairGrowth, setPairGrowth)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0119, ADR-0113, ADR-0055
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { OverlayResizeStep } from '@kite/shared';
import { getPairGrowth, setPairGrowth, type PairGrowth } from '@/core/storage/overlayPrefs';
import { pairWindowWidth, widthSteps, type OverlayColumn } from './panelWidth';

/** How close (CSS px) the window's width must be to a remembered one to be the same width (rounding). */
const SAME_WIDTH = 2;

/** The longest the bars stay held after the window was asked to narrow, ms (normally it narrows at once). */
const NARROW_WAIT_MS = 1_000;

/** What usePairWindow() needs. */
export interface PairWindowInput {
  /** True while the transcript and the answer are both open and shown (full mode, during the call). */
  shown: boolean;
  /** True in the full overlay (not the icon, the collapsed bar or the script bar): only then is the width changed. */
  full: boolean;
  /** The position's column: which edge or edges move. */
  column: OverlayColumn;
  /** The shell's resize steps (absent in a browser): the window grows only where they exist. */
  onResize: ((step: OverlayResizeStep) => void) | undefined;
  /** The overlay's root (its width is the window's, in CSS px of the page). */
  root: RefObject<HTMLDivElement | null>;
  /** Bar 1's box (the row is about 1.4 × its width). */
  bar1: RefObject<HTMLDivElement | null>;
}

/**
 * ADR-0119 amended: grows the overlay window for the pair and narrows it back afterwards (see the file header).
 *
 * @param input See PairWindowInput.
 * Called from: CompactView.tsx
 */
export function usePairWindow(input: PairWindowInput): void {
  const { shown, full, column, root, bar1 } = input;
  // The growth not yet undone.
  const growthRef = useRef<PairGrowth | null>(null);
  // The page passes a new function on each render: the latest is used, and its change never re-runs the effect.
  const onResize = useRef(input.onResize);
  useEffect(() => {
    onResize.current = input.onResize;
  });
  // A growth left from an overlay that closed while grown is adopted once, on the first measurement.
  const adopted = useRef(false);

  useLayoutEffect(() => {
    const resize = onResize.current;
    const page = root.current;
    const bar = bar1.current;
    // The bars' column (CompactView's data-bars-column), held at its width while the window is grown.
    const barsColumn = page?.querySelector<HTMLElement>('[data-bars-column]');
    const view = page?.ownerDocument.defaultView;
    if (!resize || !full || !page || !bar || !barsColumn || !view) return;
    /**
     * Holds the bars' column at a width (CSS px), or lets it go (null). Written to the style directly, so the
     * hold is in place before the window grows, with no render in between.
     *
     * @param width The width, or null.
     */
    const hold = (width: number | null) => {
      if (width === null) barsColumn.style.removeProperty('max-width');
      else barsColumn.style.maxWidth = `min(100%, ${width}px)`;
    };
    const rootWidth = page.clientWidth;
    const windowWidth = view.innerWidth;
    if (!(rootWidth > 0) || !(windowWidth > 0)) return;
    // DIPs per CSS px of the page (the UI zoom).
    const scale = windowWidth / rootWidth;
    if (!adopted.current) {
      adopted.current = true;
      const stored = getPairGrowth();
      // Saved wide by the shell when the last overlay closed while grown: this window is that width.
      if (stored && Math.abs(rootWidth - stored.grown) <= SAME_WIDTH) {
        growthRef.current = stored;
        hold(stored.bars);
      } else if (stored) {
        setPairGrowth(null);
      }
    }
    const current = growthRef.current;
    if (shown) {
      if (current) return;
      const wanted = pairWindowWidth({
        bar1: bar.offsetWidth,
        root: rootWidth,
        window: windowWidth,
        screen: view.screen?.availWidth ?? 0,
      });
      const delta = wanted - Math.round(windowWidth);
      if (delta <= 1) return;
      // The bars' own width now: bar 1 is often squeezed (it gives way in a narrow window), and in the wider
      // window it would spread out again; held at this width it stays exactly as it is.
      const record = {
        base: rootWidth,
        grown: rootWidth + delta / scale,
        bars: barsColumn.offsetWidth,
      };
      growthRef.current = record;
      // The bars are held at their width before the window grows, so they never move.
      hold(record.bars);
      setPairGrowth(record);
      for (const step of widthSteps(column, delta)) resize(step);
      return;
    }
    if (!current) return;
    growthRef.current = null;
    setPairGrowth(null);
    const delta = Math.round(windowWidth - current.base * scale);
    if (delta <= 1) {
      // Already narrower (the user narrowed it, or a preset put it at its default size): nothing to undo.
      hold(null);
      return;
    }
    for (const step of widthSteps(column, -delta)) resize(step);
    // The bars stay held until the window has narrowed, so bar 1 never widens for a moment in between.
    // Safe to call more than once (the window's resize, the time limit, the effect's clean-up).
    const release = () => {
      view.removeEventListener('resize', onWindowResize);
      clearTimeout(timer);
      hold(null);
    };
    const onWindowResize = () => {
      if (view.innerWidth <= current.base * scale + SAME_WIDTH) release();
    };
    view.addEventListener('resize', onWindowResize);
    const timer = setTimeout(release, NARROW_WAIT_MS);
    return release;
  }, [shown, full, column, root, bar1]);
}
