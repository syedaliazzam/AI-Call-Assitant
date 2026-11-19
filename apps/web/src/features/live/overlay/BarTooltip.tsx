/**
 * File: apps/web/src/features/live/overlay/BarTooltip.tsx
 * Purpose: Bar 1's tooltip (1.6.3, ADR-0075): one tooltip for the whole bar, naming the control under the
 *          pointer (or with the keyboard focus) and its shortcut, from the control's data-tip
 *          ("Answer · Ctrl+Enter"). Solid dark with white text in every theme, so it reads over any page.
 *          Drawn in the page (never a title attribute: a browser's title tooltip is a separate window that
 *          Private may not hide, ADR-0042), into document.body above everything: inside bar 1 the glass
 *          pieces after it (bar 2, the warning, the panels) painted over it. Placed below bar 1 (above it
 *          on the bottom row), on the other side when that does not fit, and beside its control when
 *          neither does (the collapsed overlay is only bar 1 tall); always inside the window.
 * Used by: src/features/live/overlay/ControlBar.tsx
 * Depends on: react, react-dom (createPortal), src/ui/tokens/theme.css (.k-bar-tip)
 * Architecture: ADR-0042 (in-page hints), ADR-0075
 *
 * In the desktop app the bar's background is the window's drag handle: the system sends the page no
 * pointer events there, so only controls that opt out of dragging (buttons, the device icons) can show a
 * tooltip.
 */
'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** A box in the window, in the page's viewport pixels. */
export interface TipBox {
  /** Left edge. */
  left: number;
  /** Top edge. */
  top: number;
  /** Width. */
  width: number;
  /** Height. */
  height: number;
}

/** Where the tooltip goes: its top-left corner in viewport pixels, and which side it took. */
export interface TipPlace {
  /** Left edge. */
  left: number;
  /** Top edge. */
  top: number;
  /** Below or above bar 1, or beside its control. */
  side: 'below' | 'above' | 'beside';
}

/** Space between the bar (or the control) and the tooltip, px. */
const TIP_GAP = 6;

/** The least space between the tooltip and the window's edges, px. */
const TIP_MARGIN = 4;

/** How long the pointer rests on a control before its tooltip shows, in ms. */
const TIP_DELAY_MS = 250;

/**
 * Where a tooltip goes so that it is whole inside the window (1.6.3, ADR-0075): centred on its control,
 * below bar 1 on the top row and above it on the bottom row; on the other side of the bar when that
 * does not fit; else beside the control, level with it. Shifted sideways to stay inside the window.
 *
 * @param control The control it names.
 * @param bar     Bar 1.
 * @param tip     The tooltip's size (its width already limited to the window's).
 * @param win     The window.
 * @param up      True on the overlay's bottom row.
 * @returns The place, in the same pixels as the boxes.
 * Called from: BarTooltip; tests
 */
export function placeTip(
  control: TipBox,
  bar: TipBox,
  tip: { width: number; height: number },
  win: TipBox,
  up: boolean,
): TipPlace {
  const minLeft = win.left + TIP_MARGIN;
  const maxLeft = win.left + win.width - TIP_MARGIN - tip.width;
  const minTop = win.top + TIP_MARGIN;
  const maxTop = win.top + win.height - TIP_MARGIN - tip.height;
  const clamp = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(value, Math.max(low, high)));
  const centred = clamp(control.left + control.width / 2 - tip.width / 2, minLeft, maxLeft);
  const below = bar.top + bar.height + TIP_GAP;
  const above = bar.top - TIP_GAP - tip.height;
  const fitsBelow = below <= maxTop;
  const fitsAbove = above >= minTop;
  if (up ? fitsAbove : fitsBelow) {
    return { left: centred, top: up ? above : below, side: up ? 'above' : 'below' };
  }
  if (up ? fitsBelow : fitsAbove) {
    return { left: centred, top: up ? below : above, side: up ? 'below' : 'above' };
  }
  // Neither: level with the control, to its right if there is room, else to its left.
  const right = control.left + control.width + TIP_GAP;
  const left = right <= maxLeft ? right : control.left - TIP_GAP - tip.width;
  return {
    left: clamp(left, minLeft, maxLeft),
    top: clamp(control.top + control.height / 2 - tip.height / 2, minTop, maxTop),
    side: 'beside',
  };
}

/**
 * A box from an element's client rectangle.
 *
 * @param element The element.
 * @returns Its box.
 * Called from: BarTooltip
 */
function boxOf(element: Element): TipBox {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Props for BarTooltip. */
export interface BarTooltipProps {
  /** Bar 1 (its controls carry data-tip). */
  bar: RefObject<HTMLElement | null>;
  /** True on the overlay's bottom row (ADR-0056). */
  up: boolean;
}

/**
 * Bar 1's tooltip.
 *
 * @param props See BarTooltipProps.
 * @returns The tooltip while one is shown, in document.body; otherwise nothing.
 * Rendered by: ControlBar.tsx
 */
export function BarTooltip({ bar, up }: BarTooltipProps) {
  // The control it names (a ref, read when placing), and its words (state: they are drawn).
  const named = useRef<HTMLElement | null>(null);
  const [text, setText] = useState<string | null>(null);
  const tipElement = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<TipPlace | null>(null);

  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Hides the tooltip and forgets a pending one. */
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      named.current = null;
      setText(null);
    };
    /**
     * Shows the tooltip of the control an event is on, after a short rest (at once for the keyboard).
     *
     * @param target What the event is on.
     * @param delay  How long to wait, in ms.
     */
    const show = (target: EventTarget | null, delay: number) => {
      // ADR-0107: not `instanceof Element`: in the picture-in-picture window elements belong to another
      // window, whose Element is a different class, so no tooltip ever showed there.
      const control = isElement(target) ? target.closest<HTMLElement>('[data-tip]') : null;
      // ADR-0107: no tooltip while a menu is open (k-popup-open, ADR-0105): the pointer still rests on ⋮
      // after the click that opened it, and the "Menu" tooltip came back on top of the menu.
      const menuOpen = element.closest('.k-popup-open') !== null;
      if (!control || !element.contains(control) || menuOpen) {
        hide();
        return;
      }
      if (control === named.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        named.current = control;
        setPlace(null);
        setText(control.dataset.tip ?? '');
      }, delay);
    };
    const onOver = (event: Event) => show(event.target, TIP_DELAY_MS);
    // Only the keyboard's focus: a click focuses its button too, and closes the tooltip.
    const onFocus = (event: Event) => {
      if (isElement(event.target) && event.target.matches(':focus-visible')) {
        show(event.target, 0);
      }
    };
    // ADR-0107: Enter or Space opens a menu from the keyboard; the tooltip goes with it (it sat on the menu).
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') hide();
    };
    // ADR-0107: the overlay's own document and window (the picture-in-picture window's, in the browser).
    const ownDocument = element.ownerDocument;
    const ownWindow = ownDocument.defaultView ?? window;
    element.addEventListener('pointerover', onOver);
    element.addEventListener('pointerleave', hide);
    element.addEventListener('pointerdown', hide);
    element.addEventListener('click', hide);
    element.addEventListener('focusin', onFocus);
    element.addEventListener('focusout', hide);
    ownDocument.addEventListener('keydown', onKey);
    ownWindow.addEventListener('blur', hide);
    return () => {
      if (timer) clearTimeout(timer);
      element.removeEventListener('pointerover', onOver);
      element.removeEventListener('pointerleave', hide);
      element.removeEventListener('pointerdown', hide);
      element.removeEventListener('click', hide);
      element.removeEventListener('focusin', onFocus);
      element.removeEventListener('focusout', hide);
      ownDocument.removeEventListener('keydown', onKey);
      ownWindow.removeEventListener('blur', hide);
    };
  }, [bar]);

  // Placed after it is drawn (hidden) at its real size, before it is painted where it goes.
  useLayoutEffect(() => {
    const control = named.current;
    const tip = tipElement.current;
    const barBox = bar.current;
    if (text === null || !control || !tip || !barBox || !control.isConnected) return;
    const root =
      barBox.closest<HTMLElement>('.k-overlay-root') ?? barBox.ownerDocument.documentElement;
    const win = boxOf(root);
    // The page may be zoomed (the UI scale is CSS zoom on the root): client rectangles are in the
    // window's pixels, a fixed element's left and top in the page's own. Their ratio converts.
    const scale = root.offsetWidth > 0 ? win.width / root.offsetWidth : 1;
    const spot = placeTip(boxOf(control), boxOf(barBox), boxOf(tip), win, up);
    setPlace({ ...spot, left: spot.left / scale, top: spot.top / scale });
  }, [text, up, bar]);

  if (text === null || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={tipElement}
      role="tooltip"
      data-bar-tip={place?.side ?? ''}
      className="k-bar-tip pointer-events-none fixed z-[1000] rounded-control px-2 py-1 text-[12px] leading-4 font-medium"
      style={
        place
          ? { left: place.left, top: place.top, maxWidth: 'calc(100vw - 8px)' }
          : { left: 0, top: 0, maxWidth: 'calc(100vw - 8px)', visibility: 'hidden' }
      }
    >
      {text}
    </div>,
    // ADR-0107: into the overlay's own document (the picture-in-picture window's, in the browser).
    bar.current?.ownerDocument.body ?? document.body,
  );
}

/**
 * ADR-0107: whether an event target is an element, from any window (an element of the picture-in-picture
 * window is not an instance of this window's Element).
 *
 * @param target The event target.
 * @returns True for an element.
 * Called from: BarTooltip (show, onFocus)
 */
function isElement(target: EventTarget | null): target is Element {
  return target !== null && typeof (target as Element).closest === 'function';
}
