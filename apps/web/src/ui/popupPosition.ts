/**
 * File: apps/web/src/ui/popupPosition.ts
 * Purpose: Where an anchored popup (a select's list, a menu, a tooltip) goes: next to its anchor, on
 *          the side with room, and always inside the window. Plain arithmetic, so it can be tested
 *          without a browser.
 * Used by: src/ui/useAnchoredPopup.ts
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (menus); docs/architecture/kite-architecture-v3.1.md §9.1
 */

/** Where a popup prefers to sit against its anchor. */
export type PopupPlacement =
  /** Under the anchor, left edges together. */
  | 'bottom-start'
  /** Under the anchor, right edges together. */
  | 'bottom-end'
  /** Over the anchor, left edges together. */
  | 'top-start'
  /** Over the anchor, right edges together (the user menu, inside the sidebar). */
  | 'top-end'
  /** Over the anchor, centred (tooltips). */
  | 'top-center'
  /** Right of the anchor, top edges together (a sub-menu). */
  | 'right-start';

/** A rectangle in the window's coordinates. */
export interface PopupRect {
  /** Distance from the window's left edge, in px. */
  left: number;
  /** Distance from the window's top edge, in px. */
  top: number;
  /** Width in px. */
  width: number;
  /** Height in px. */
  height: number;
}

/** A popup's size or the window's size. */
export interface PopupSize {
  /** Width in px. */
  width: number;
  /** Height in px. */
  height: number;
}

/** The gap kept between a popup and the window's edge, in px. */
export const POPUP_MARGIN = 8;

/**
 * Works out where a popup goes. It takes its preferred side when it fits there; otherwise the side
 * with more room; then it is slid along so it stays inside the window.
 *
 * @param anchor    The anchor's rectangle.
 * @param popup     The popup's size.
 * @param viewport  The window's size.
 * @param placement The preferred side and alignment.
 * @param gap       The gap between anchor and popup, in px.
 * @returns The popup's left and top, and the most height it may use before it must scroll.
 * Called from: useAnchoredPopup(); tests
 */
export function placePopup(
  anchor: PopupRect,
  popup: PopupSize,
  viewport: PopupSize,
  placement: PopupPlacement,
  gap: number,
): { left: number; top: number; maxHeight: number } {
  const anchorBottom = anchor.top + anchor.height;
  const anchorRight = anchor.left + anchor.width;
  const roomBelow = viewport.height - anchorBottom - gap - POPUP_MARGIN;
  const roomAbove = anchor.top - gap - POPUP_MARGIN;
  const wantsTop =
    placement === 'top-start' || placement === 'top-end' || placement === 'top-center';

  let left: number;
  if (placement === 'bottom-end' || placement === 'top-end') left = anchorRight - popup.width;
  else if (placement === 'top-center') left = anchor.left + (anchor.width - popup.width) / 2;
  else if (placement === 'right-start') left = anchorRight + gap;
  else left = anchor.left;
  left = Math.max(POPUP_MARGIN, Math.min(left, viewport.width - popup.width - POPUP_MARGIN));

  if (placement === 'right-start') {
    const top = Math.max(
      POPUP_MARGIN,
      Math.min(anchor.top, viewport.height - popup.height - POPUP_MARGIN),
    );
    return { left, top, maxHeight: viewport.height - top - POPUP_MARGIN };
  }

  // The preferred side if the popup fits; otherwise whichever side has more room.
  const fitsWanted = popup.height <= (wantsTop ? roomAbove : roomBelow);
  const onTop = fitsWanted ? wantsTop : roomAbove > roomBelow;
  const maxHeight = Math.max(0, onTop ? roomAbove : roomBelow);
  const height = Math.min(popup.height, maxHeight);
  return { left, top: onTop ? anchor.top - gap - height : anchorBottom + gap, maxHeight };
}
