/**
 * File: apps/web/src/features/live/overlay/useClickThrough.ts
 * Purpose: Lets clicks pass through the desktop overlay's transparent gaps to the app behind it (ADR-0055):
 *          the empty space around and between the bars and panels. The overlay marks those layout boxes
 *          with data-gap. While the pointer is over one, the shell passes clicks through (pointer moves
 *          still arrive, forwarded); over a bar, a panel or anything else it takes them again. Off while
 *          a menu or list is open, so a click beside it can still close it.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: React
 * Architecture: ADR-0055
 */
'use client';

import { useEffect, useRef } from 'react';

/** The attribute that marks a transparent layout box (never a bar or a panel). */
export const GAP_ATTRIBUTE = 'data-gap';

/**
 * Whether the pointer is over a transparent gap: the element under it is a layout box marked data-gap
 * (the bars and panels inside it are not).
 *
 * @param target The element under the pointer.
 * @returns True over a gap.
 * Called from: useClickThrough(); tests
 */
export function isGap(target: EventTarget | null): boolean {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    target.hasAttribute(GAP_ATTRIBUTE)
  );
}

/**
 * Passes clicks through the gaps while enabled.
 *
 * @param enabled  True when the overlay may pass clicks through (desktop, full view, no menu open).
 * @param setThrough Tells the shell (getPlatform().setOverlayClickThrough).
 * Called from: CompactView.tsx
 */
export function useClickThrough(enabled: boolean, setThrough: (through: boolean) => void): void {
  // The last state sent, so the shell hears only changes (a move fires many events).
  const sent = useRef(false);
  const setter = useRef(setThrough);
  useEffect(() => {
    setter.current = setThrough;
  });

  useEffect(() => {
    if (!enabled) return;
    const onMove = (event: MouseEvent) => {
      const through = isGap(event.target);
      if (through === sent.current) return;
      sent.current = through;
      setter.current(through);
    };
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      // Turned off (a menu opened, the icon, the view closing): the window takes its clicks again.
      if (sent.current) {
        sent.current = false;
        setter.current(false);
      }
    };
  }, [enabled]);
}
