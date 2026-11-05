/**
 * File: apps/web/src/ui/useAnchoredPopup.ts
 * Purpose: Opens a popup next to an anchor in the browser's top layer (the Popover API), so a select's
 *          list inside a scrolling modal is never cut off and always sits above the modal. Drawn in the
 *          page on purpose: a browser's own <select> list or title tooltip is a separate window, which
 *          screen-share protection may not reach (ADR-0042).
 * Used by: src/ui/Select.tsx, src/ui/MultiSelect.tsx, src/ui/Menu.tsx, src/ui/SplitButton.tsx,
 *          src/ui/Tooltip.tsx
 * Depends on: React, ./popupPosition.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3; ADR-0042
 */
'use client';

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { placePopup, type PopupPlacement } from './popupPosition';

/** Options for useAnchoredPopup(). */
export interface AnchoredPopupOptions {
  /** The preferred side and alignment (default 'bottom-start'). */
  placement?: PopupPlacement;
  /** The gap between anchor and popup, in px (default 6). */
  gap?: number;
  /** True to make the popup at least as wide as the anchor (selects). */
  matchWidth?: boolean;
  /** False to stay open on a click elsewhere (tooltips open on hover). Default true. */
  closeOnOutside?: boolean;
}

/** What useAnchoredPopup() returns. */
export interface AnchoredPopup<A extends HTMLElement, P extends HTMLElement> {
  /** True while the popup is showing. */
  open: boolean;
  /** Opens or closes it. */
  setOpen: (open: boolean) => void;
  /** Goes on the element the popup is placed against. */
  anchorRef: RefObject<A | null>;
  /** Goes on the popup, which is rendered only while `open` and has `popover="manual"`. */
  popupRef: RefObject<P | null>;
}

/**
 * The page's CSS zoom. The desktop panels zoom the root element (useAppearance): measurements come back
 * in window pixels, while the popup's own top and left are multiplied by the zoom.
 *
 * @returns The zoom factor (1 when none is set).
 * Called from: the positioning effect in useAnchoredPopup()
 */
function rootZoom(): number {
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * The open state and positioning of one anchored popup. While it is open it follows its anchor when
 * the window scrolls or resizes, and (by default) closes on a click outside.
 *
 * @param options See AnchoredPopupOptions.
 * @returns The state and the two refs.
 * Called from: Select, MultiSelect, Menu, SplitButton, Tooltip
 */
export function useAnchoredPopup<A extends HTMLElement, P extends HTMLElement>(
  options: AnchoredPopupOptions = {},
): AnchoredPopup<A, P> {
  const {
    placement = 'bottom-start',
    gap = 6,
    matchWidth = false,
    closeOnOutside = true,
  } = options;
  const [open, setOpenState] = useState(false);
  const anchorRef = useRef<A>(null);
  const popupRef = useRef<P>(null);
  const setOpen = useCallback((next: boolean) => setOpenState(next), []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const popup = popupRef.current;
    const anchor = anchorRef.current;
    if (!popup || !anchor) return undefined;
    popup.showPopover();

    /** Measures, and puts the popup where it fits. */
    const place = () => {
      const zoom = rootZoom();
      const rect = anchor.getBoundingClientRect();
      if (matchWidth) popup.style.minWidth = `${rect.width / zoom}px`;
      // Measured at its natural height, so a list that fits again grows back.
      popup.style.maxHeight = '';
      const size = popup.getBoundingClientRect();
      const where = placePopup(
        rect,
        { width: size.width, height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
        gap,
      );
      popup.style.left = `${where.left / zoom}px`;
      popup.style.top = `${where.top / zoom}px`;
      popup.style.maxHeight = `${where.maxHeight / zoom}px`;
    };
    place();
    window.addEventListener('resize', place);
    // Capture: a scroll inside a modal does not bubble to the window.
    window.addEventListener('scroll', place, true);

    /**
     * Closes on a press anywhere but the anchor and the popup.
     *
     * @param event The press.
     */
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popup.contains(target) && !anchor.contains(target)) setOpenState(false);
    };
    if (closeOnOutside) document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, placement, gap, matchWidth, closeOnOutside]);

  return { open, setOpen, anchorRef, popupRef };
}
