/**
 * File: apps/web/src/features/live/overlay/usePopupDismiss.ts
 * Purpose: Closes the overlay's open menu or list (the ⋮ menu, its sheets, the device, Rec and model lists;
 *          ADR-0105, desktop 1.7.1) when the person presses anywhere outside it (the bars, the panels, the
 *          gaps, the button that opened it), when the overlay window loses focus (a click in another app),
 *          or on Esc. The press that closes it does nothing else: it and the click it makes are swallowed,
 *          so the button under the pointer is not triggered. (Choosing an item closes the menu in
 *          LiveMenu.tsx.)
 * Used by: src/features/live/CompactView.tsx
 * Depends on: React
 * Architecture: ADR-0105
 *
 * The bars are the window's drag areas, where Windows sends the page no pointer events; while a menu is
 * open CompactView marks the overlay k-popup-open (theme.css), which turns the drag areas off, so a press on
 * the bars reaches this hook too.
 */
'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** Why an open menu closed. */
export type PopupCloseReason = 'outside' | 'blur' | 'escape';

/** The part of a menu's element used here (an Element in the page; a fake in tests). */
export type PopupElement = Pick<Element, 'contains'>;

/**
 * Capture-phase listening on the document, so these run before React's listeners on its root. An object,
 * not `true`: Node's EventTarget (the unit tests) only matches `{ capture: true }` when removing a listener.
 */
const CAPTURE = { capture: true } as const;

/**
 * Whether a press lands outside the open menu.
 *
 * @param target The element pressed.
 * @param popup  The open menu's element (null when it is not drawn yet).
 * @returns True when the press is outside it (the menu closes).
 * Called from: pressClosesPopup(); tests
 */
export function isOutside(target: EventTarget | null, popup: PopupElement | null): boolean {
  if (!popup || !target) return true;
  return !popup.contains(target as Node);
}

/**
 * Swallows the click that follows a press which closed a menu, so the button under the pointer is not
 * triggered. Armed until that click, or until just after the press ends (a press that became a drag makes
 * no click), so it never eats a later click.
 *
 * @param doc The page's document.
 * @returns A function that disarms it at once.
 * Called from: pressClosesPopup(); tests
 */
export function swallowNextClick(doc: EventTarget): () => void {
  let armed = true;
  const listeners = {
    swallow: (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      listeners.disarm();
    },
    // The click comes in the same task as the release; a timer set at the release runs after it.
    afterRelease: () => {
      setTimeout(listeners.disarm, 0);
    },
    disarm: () => {
      if (!armed) return;
      armed = false;
      doc.removeEventListener('click', listeners.swallow, CAPTURE);
      doc.removeEventListener('pointerup', listeners.afterRelease, CAPTURE);
      doc.removeEventListener('pointercancel', listeners.afterRelease, CAPTURE);
    },
  };
  // Capture on the document: before React's own listeners on its root.
  doc.addEventListener('click', listeners.swallow, CAPTURE);
  doc.addEventListener('pointerup', listeners.afterRelease, CAPTURE);
  doc.addEventListener('pointercancel', listeners.afterRelease, CAPTURE);
  return listeners.disarm;
}

/**
 * Handles a press while a menu is open: outside it, the press closes the menu and does nothing else (it is
 * stopped before anything under it sees it, and its click is swallowed). Inside it, nothing happens here.
 *
 * @param event The pointerdown (capture phase, on the document).
 * @param popup The open menu's element.
 * @param doc   The page's document (for the click that follows).
 * @returns True when the press closes the menu.
 * Called from: attachPopupDismiss(); tests
 */
export function pressClosesPopup(
  event: Pick<Event, 'target' | 'preventDefault' | 'stopPropagation'>,
  popup: PopupElement | null,
  doc: EventTarget,
): boolean {
  if (!isOutside(event.target, popup)) return false;
  // The press only closes the menu: nothing under it (a button, a resize grip, the divider) sees it.
  event.preventDefault();
  event.stopPropagation();
  swallowNextClick(doc);
  return true;
}

/**
 * Listens for what closes an open menu: a press outside it, the window losing focus, Esc.
 *
 * @param doc      The page's document.
 * @param win      The page's window (its blur means the person went to another app).
 * @param getPopup The open menu's element, read at each press.
 * @param close    Closes the menu, with the reason.
 * @returns Stops listening.
 * Called from: usePopupDismiss(); tests
 */
export function attachPopupDismiss(
  doc: EventTarget,
  win: EventTarget,
  getPopup: () => PopupElement | null,
  close: (reason: PopupCloseReason) => void,
): () => void {
  const onPointer = (event: Event) => {
    if (pressClosesPopup(event, getPopup(), doc)) close('outside');
  };
  const onKey = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape') close('escape');
  };
  // The window lost focus: the person clicked another app (or the overlay gave the keyboard back).
  const onBlur = () => close('blur');
  doc.addEventListener('pointerdown', onPointer, CAPTURE);
  doc.addEventListener('keydown', onKey);
  win.addEventListener('blur', onBlur);
  return () => {
    doc.removeEventListener('pointerdown', onPointer, CAPTURE);
    doc.removeEventListener('keydown', onKey);
    win.removeEventListener('blur', onBlur);
  };
}

/**
 * Closes an open menu on a press outside it, when the window loses focus, or on Esc.
 *
 * @param open    True while a menu or list is open.
 * @param popup   The open menu's element.
 * @param onClose Closes it, with the reason (Esc puts the focus back on the ⋮ button).
 * Called from: CompactView.tsx
 */
export function usePopupDismiss(
  open: boolean,
  popup: RefObject<HTMLElement | null>,
  onClose: (reason: PopupCloseReason) => void,
): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    // ADR-0107: the document the menu is in. In the browser's picture-in-picture window the overlay renders
    // into the PiP document, so listening on the opener's document missed every press and Esc there.
    const ownDocument = popup.current?.ownerDocument ?? document;
    const ownWindow = ownDocument.defaultView ?? window;
    return attachPopupDismiss(
      ownDocument,
      ownWindow,
      () => popup.current,
      (reason) => close.current(reason),
    );
  }, [open, popup]);
}
