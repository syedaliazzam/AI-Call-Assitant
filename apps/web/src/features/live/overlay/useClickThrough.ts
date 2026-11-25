/**
 * File: apps/web/src/features/live/overlay/useClickThrough.ts
 * Purpose: Lets clicks pass through the desktop overlay's transparent gaps to the app behind it (ADR-0055):
 *          the empty space around and between the bars and panels. The overlay marks those layout boxes
 *          with data-gap. While the pointer is over one, the shell passes clicks through (pointer moves
 *          still arrive, forwarded); over a bar, a panel or anything else it takes them again. Off while
 *          a menu or list is open, so a click beside it can still close it.
 *          v1.3.2: Click-through mode (W on bar 1, the ⋮ menu or Ctrl+Alt+X). ADR-0055 (amended 26 Nov 2026):
 *          the WHOLE overlay passes every click to the app behind (the bars, the chat bar, the script bar,
 *          the panels and W's own spot), at once, without waiting for the pointer to move. Only the
 *          shortcut turns it off (or the call window's button, or the call ending). Until then the bars
 *          (marked data-bars) kept their clicks; that is still the case while another app holds the
 *          shortcut (`keepBars`), so nobody is stuck with an overlay they cannot turn back.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: React
 * Architecture: ADR-0055 (amended 26 Nov 2026); v1.3.2
 */
'use client';

import { useEffect, useRef } from 'react';

/** The attribute that marks a transparent layout box (never a bar or a panel). */
export const GAP_ATTRIBUTE = 'data-gap';

/**
 * v1.3.2: the attribute that marks the bars. Since ADR-0055's amendment (26 Nov 2026) they pass clicks
 * in Click-through mode too, except while another app holds the shortcut (passesThrough's keepBars).
 */
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
 * Whether a click at the pointer goes to the app behind: over a gap; in Click-through mode, everywhere
 * (ADR-0055 amended 26 Nov 2026), or everywhere but the bars while another app holds the shortcut.
 *
 * @param target   The element under the pointer.
 * @param all      True in Click-through mode.
 * @param keepBars True while the Click-through shortcut cannot turn the mode off (another app holds it):
 *                 the bars then keep their clicks, so W can.
 * @returns True to pass clicks through.
 * Called from: useClickThrough(); tests
 */
export function passesThrough(target: EventTarget | null, all: boolean, keepBars = false): boolean {
  if (!all) return isGap(target);
  if (!keepBars) return true;
  if (typeof Element === 'undefined' || !(target instanceof Element)) return true;
  return target.closest(`[${BARS_ATTRIBUTE}]`) === null;
}

/**
 * Passes clicks through the gaps (or, in Click-through mode, the whole overlay) while enabled.
 *
 * @param enabled    True when the overlay may pass clicks through (desktop, full view or script bar, no
 *                   menu open, not the icon).
 * @param setThrough Tells the shell (getPlatform().setOverlayClickThrough).
 * @param all        v1.3.2: Click-through mode is on.
 * @param keepBars   True while another app holds the Click-through shortcut (see passesThrough()).
 * Called from: CompactView.tsx
 */
export function useClickThrough(
  enabled: boolean,
  setThrough: (through: boolean) => void,
  all = false,
  keepBars = false,
): void {
  // The last state sent, so the shell hears only changes (a move fires many events).
  const sent = useRef(false);
  const setter = useRef(setThrough);
  useEffect(() => {
    setter.current = setThrough;
  });

  useEffect(() => {
    if (!enabled) return;
    // ADR-0055 (amended 26 Nov 2026): the whole overlay passes at once in Click-through mode. Waiting for a
    // pointer move is not enough: on Windows a press on bar 1's drag area sends the page no move first, so
    // the bar would take the first click after Ctrl+Alt+X was pressed with the pointer elsewhere.
    if (all && !keepBars && !sent.current) {
      sent.current = true;
      setter.current(true);
    }
    const onMove = (event: MouseEvent) => {
      const through = passesThrough(event.target, all, keepBars);
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
  }, [enabled, all, keepBars]);
}
