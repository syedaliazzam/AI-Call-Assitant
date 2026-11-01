/**
 * File: apps/web/src/platform/pip.ts
 * Purpose: The browser's compact view window: Chrome / Edge 116+ Document Picture-in-Picture.
 *          Opens a small always-on-top window from a button click, copies the page's styles into
 *          it, and hands a container to the caller to render into (the features layer renders
 *          the compact view; this file has no React). Closes it on request.
 * Used by: src/platform/browser.ts (openCompactView, closeCompactView)
 * Depends on: the browser's Document Picture-in-Picture API (window.documentPictureInPicture)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (openCompactView), §5 (compact
 *               view); day-05-overlay-screenshots-notes.md Stage 4
 *
 * The picture-in-picture window runs in the same page (same JavaScript, same memory), so the
 * compact view inside it talks to the live page over the same session channel as the desktop
 * compact window does. A browser cannot hide this window from screen sharing.
 */

/** The parts of Chrome's Document Picture-in-Picture API used here (not in TypeScript's DOM types yet). */
export interface DocumentPictureInPictureApi {
  /**
   * Opens the window. Must be called during a user gesture (a click).
   *
   * @param options Its size in CSS pixels.
   * @returns The window.
   */
  requestWindow(options: PipWindowSize): Promise<Window>;
  /** The open window, or null. */
  window: Window | null;
}

/** The picture-in-picture window's size, in CSS pixels. */
export interface PipWindowSize {
  /** Width. */
  width: number;
  /** Height. */
  height: number;
}

/** The compact window's size. */
export const PIP_SIZE: PipWindowSize = { width: 380, height: 320 };

/**
 * Renders into the window's container; returns a function that unmounts it.
 *
 * @param container An element in the picture-in-picture window's document.
 * @returns Cleanup.
 */
export type PipRenderer = (container: HTMLElement) => () => void;

/**
 * The browser's Document Picture-in-Picture API, or null where it does not exist (Firefox,
 * Safari, older Chrome and Edge).
 *
 * @param scope The window (default the page's).
 * @returns The API, or null.
 * Called from: openPictureInPicture(); tests
 */
export function pictureInPicture(scope: unknown = globalThis): DocumentPictureInPictureApi | null {
  const api = (scope as { documentPictureInPicture?: DocumentPictureInPictureApi })
    .documentPictureInPicture;
  return api && typeof api.requestWindow === 'function' ? api : null;
}

/**
 * Copies the page's stylesheets into another document, so the compact view looks the same: the
 * rules of same-origin sheets are copied as text, other sheets are linked by URL.
 *
 * @param from The page's document.
 * @param to   The picture-in-picture window's document.
 * Called from: openPictureInPicture()
 */
function copyStyles(from: Document, to: Document): void {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement('style');
      style.textContent = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      to.head.append(style);
    } catch {
      // A cross-origin sheet cannot be read: link it instead.
      if (sheet.href) {
        const link = to.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        to.head.append(link);
      }
    }
  }
}

/** The open picture-in-picture window and its cleanup, or null. */
let open: { window: Window; cleanup: () => void } | null = null;

/**
 * Opens (or brings back) the compact picture-in-picture window and renders into it.
 *
 * @param render Renders the compact view into a container; returns its cleanup.
 * @param api    The Document Picture-in-Picture API (tests pass a fake).
 * @returns Resolves once the window is open and rendered.
 * @throws Error('NO_PIP') where the browser has no Document Picture-in-Picture.
 * Called from: browserPlatform.openCompactView()
 */
export async function openPictureInPicture(
  render: PipRenderer,
  api: DocumentPictureInPictureApi | null = pictureInPicture(),
): Promise<void> {
  if (!api) throw new Error('NO_PIP');
  if (open && !open.window.closed) {
    open.window.focus();
    return;
  }
  const pip = await api.requestWindow(PIP_SIZE);
  pip.document.title = 'Kite (compact)';
  copyStyles(document, pip.document);
  const container = pip.document.createElement('div');
  pip.document.body.style.margin = '0';
  pip.document.body.append(container);
  const unmount = render(container);
  const entry = { window: pip, cleanup: unmount };
  open = entry;
  // The user closed it (or the page closed it): unmount the view.
  pip.addEventListener('pagehide', () => {
    entry.cleanup();
    if (open === entry) open = null;
  });
}

/**
 * Closes the compact picture-in-picture window, if open.
 *
 * Called from: browserPlatform.closeCompactView()
 */
export function closePictureInPicture(): void {
  if (open && !open.window.closed) open.window.close();
  open = null;
}
