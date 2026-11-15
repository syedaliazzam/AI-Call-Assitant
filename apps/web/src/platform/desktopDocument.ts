/**
 * File: apps/web/src/platform/desktopDocument.ts
 * Purpose: Keeps every popup of a desktop app's page inside its window, so screen-share protection
 *          (setContentProtection, which applies to the app's windows only) covers it too (ADR-0055):
 *          - a native tooltip (an element's title) and a <select>'s own list are separate system windows
 *            on Windows, which protection does not reach;
 *          - so in the desktop app the page is marked k-desktop, every <select> lists its choices in the
 *            page (theme.css: appearance: base-select), and each title is moved to aria-description
 *            (screen readers still read it; no tooltip window opens).
 *          The browser is unchanged.
 * Used by: src/platform/desktop.ts (keepPopupsInWindow, from SyncScope for every account since ADR-0085);
 *          tests/unit/platform/desktopDocument.test.ts
 * Depends on: the DOM (MutationObserver)
 * Architecture: ADR-0042 (Private covers every window), ADR-0055
 */

/** The class on <html> in the desktop app (theme.css keys the in-page select lists on it). */
export const DESKTOP_CLASS = 'k-desktop';

/** The part of an element moveTitle() uses. */
export interface TitledElement {
  /** Reads an attribute. */
  getAttribute(name: string): string | null;
  /** Sets an attribute. */
  setAttribute(name: string, value: string): void;
  /** Removes an attribute. */
  removeAttribute(name: string): void;
}

/**
 * Moves an element's title to aria-description (kept if one is already there), and removes the title,
 * so no native tooltip window opens.
 *
 * @param element The element.
 * @returns True when it had a title.
 * Called from: installDesktopDocument(); tests
 */
export function moveTitle(element: TitledElement): boolean {
  const title = element.getAttribute('title');
  if (title === null) return false;
  if (title !== '' && element.getAttribute('aria-description') === null) {
    element.setAttribute('aria-description', title);
  }
  element.removeAttribute('title');
  return true;
}

/** Documents already set up (SyncScope may render, and call this, many times). */
const installed = new WeakSet<Document>();

/**
 * Sets up a desktop app's page: the k-desktop class, and titles moved now and whenever one appears.
 * Does nothing a second time for the same document, or where there is no DOM.
 *
 * @param doc The page's document (default: this page's).
 * Called from: keepPopupsInWindow() in src/platform/desktop.ts
 */
export function installDesktopDocument(doc: Document | undefined = globalThis.document): void {
  if (!doc || installed.has(doc) || typeof MutationObserver === 'undefined') return;
  installed.add(doc);
  doc.documentElement.classList.add(DESKTOP_CLASS);
  for (const element of doc.querySelectorAll('[title]')) moveTitle(element);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        moveTitle(record.target);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        moveTitle(node);
        for (const element of node.querySelectorAll('[title]')) moveTitle(element);
      }
    }
  }).observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  });
}
