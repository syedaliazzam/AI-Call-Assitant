/**
 * File: apps/desktop/src/macMenu.ts
 * Purpose: The macOS menu bar's application menu (desktop 1.8.0, ADR-0111). On a Mac the app menu's
 *          shortcuts work in every window, including the frameless overlay, which on Windows has no menu.
 *          Electron's default menu would let ⌘R reload a call's page (ending the call), ⌘W close the overlay
 *          mid-call, ⌘M minimise it, and ⌥⌘I open the developer tools. This menu keeps what a Mac app needs:
 *          About, Hide, Hide Others, Show All and Quit (⌘Q goes through the usual exit, so Drive uploads
 *          finish first, ADR-0106); Edit (⌘C / ⌘V / ⌘X / ⌘A / ⌘Z only work in text boxes on a Mac when
 *          the menu has them); full screen; and the Window menu's Zoom and Bring All to Front. Windows and
 *          Linux keep Electron's default (unchanged).
 *
 *          ADR-0120: no page zoom (⌘0 / ⌘+ / ⌘−). Those roles were Chromium's own zoom, which nothing in the
 *          app limits or follows: ⌘+ on the overlay shrank its page in CSS pixels, so the transcript and the
 *          answer stacked, and the shell's window sizing (made for Kite's own zoom) no longer fitted it.
 *          Kite's own zoom stays: ⌃⌥= / ⌃⌥− / ⌃⌥0 during a call (ADR-0110) and Settings → Zoom.
 * Used by: src/main.ts (start() and the 'web-contents-created' handler, on macOS); tests/unit/macMenu.test.ts
 * Depends on: electron (MenuItemConstructorOptions and WebContents types)
 * Architecture: docs/decisions/ADR-0111-mac-parity.md, ADR-0120
 */
import type { MenuItemConstructorOptions, WebContents } from 'electron';

/**
 * The application menu for macOS.
 *
 * @param appName The app's name ("Paramount AI"), the first menu's title.
 * @returns The menu's template.
 * Called from: start() in main.ts (Menu.setApplicationMenu on macOS); tests
 */
export function macMenuTemplate(appName: string): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      // ADR-0120: full screen only; no resetZoom / zoomIn / zoomOut (Chromium's page zoom, see the file header).
      submenu: [{ role: 'togglefullscreen' }],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];
}

/**
 * ADR-0120: puts a page's Chromium zoom back to 100 % each time it loads, on a Mac. Kite never uses Chromium's
 * page zoom (its own zoom is CSS zoom, Settings → Zoom and ⌃⌥= / − / 0). The 1.8.0 test builds' menu had
 * ⌘+ / ⌘−, and Chromium applies a zoom level to every window of the same site (so ⌘+ in the dashboard zoomed the
 * overlay too); whatever level is left, a load puts it back, so it cannot shrink the overlay's page and stack its
 * panels. A page at 100 % already is left as it is.
 *
 * @param contents A window's web contents (only its load event and zoom are used).
 * Called from: the 'web-contents-created' handler in main.ts (on macOS); tests
 */
export function resetPageZoomOnLoad(
  contents: Pick<WebContents, 'on' | 'getZoomLevel' | 'setZoomLevel'>,
): void {
  contents.on('did-finish-load', () => {
    if (contents.getZoomLevel() !== 0) contents.setZoomLevel(0);
  });
}
