/**
 * File: apps/web/src/features/live/overlay/useClickThrough.ts
 * Purpose: Lets clicks pass through the desktop overlay's transparent gaps to the app behind it (ADR-0055):
 *          the empty space around and between the bars and panels. The overlay marks those layout boxes
 *          with data-gap. While the pointer is over one, the shell passes clicks through (pointer moves
 *          still arrive, forwarded); over a bar, a panel or anything else it takes them again. Off while
 *          a menu or list is open, so a click beside it can still close it.
 *          v1.3.2: Click-through mode (the ⋮ menu or Ctrl+Alt+X): everything but the bars (marked
 *          data-bars) passes clicks through, the panels too, so the app behind gets them; the bars still
 *          take clicks, so the mouse can turn the mode off.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: React
 * Architecture: ADR-0055; v1.3.2
 */
'use client';

import { useEffect, useRef } from 'react';

/** The attribute that marks a transparent layout box (never a bar or a panel). */
export const GAP_ATTRIBUTE = 'data-gap';

/** v1.3.2: the attribute that marks the bars: they take clicks even in Click-through mode. */
export const BARS_ATTRIBUTE = 'data-bars';

/**
 * Whether the pointer is over a transparent gap: the element under it is a layout box marked data-gap
 * (the bars and panels inside it are not).
 *
 * @param target The element under the pointer.
 * @returns True over a gap.
 * Called from: passesThrough(); tests
 */
export function isGap(target: EventTarget | null): boolean {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    target.hasAttribute(GAP_ATTRIBUTE)
  );
}

/**
 * Whether a click at the pointer goes to the app behind (v1.3.2): over a gap; in Click-through mode,
 * anywhere outside the bars.
 *
 * @param target The element under the pointer.
 * @param all    True in Click-through mode.
 * @returns True to pass clicks through.
 * Called from: useClickThrough(); tests
 */
export function passesThrough(target: EventTarget | null, all: boolean): boolean {
  if (!all) return isGap(target);
  if (typeof Element === 'undefined' || !(target instanceof Element)) return true;
  return target.closest(`[${BARS_ATTRIBUTE}]`) === null;
}

/**
 * Passes clicks through the gaps (or, in Click-through mode, everything but the bars) while enabled.
 *
 * @param enabled    True when the overlay may pass clicks through (desktop, full view, no menu open).
 * @param setThrough Tells the shell (getPlatform().setOverlayClickThrough).
 * @param all        v1.3.2: Click-through mode is on.
 * Called from: CompactView.tsx
 */
export function useClickThrough(
  enabled: boolean,
  setThrough: (through: boolean) => void,
  all = false,
): void {
  // The last state sent, so the shell hears only changes (a move fires many events).
  const sent = useRef(false);
  const setter = useRef(setThrough);
  useEffect(() => {
    setter.current = setThrough;
  });

  useEffect(() => {
    if (!enabled) return;
    const onMove = (event: MouseEvent) => {
      const through = passesThrough(event.target, all);
      if (through === sent.current) return;
      sent.current = through;
      setter.current(through);
    };
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      // Turned off (a menu opened, the icon, the view closing, the mode changing): the window takes its
      // clicks again until the next move says otherwise.
      if (sent.current) {
        sent.current = false;
        setter.current(false);
      }
    };
  }, [enabled, all]);
}
