/**
 * File: apps/desktop/src/macMenu.ts
 * Purpose: The macOS menu bar's application menu (desktop 1.8.0, ADR-0111). On a Mac the app menu's
 *          shortcuts work in every window, including the frameless overlay, which on Windows has no menu.
 *          Electron's default menu would let ⌘R reload a call's page (ending the call), ⌘W close the overlay
 *          mid-call, ⌘M minimise it, and ⌥⌘I open the developer tools. This menu keeps what a Mac app needs:
 *          About, Hide, Hide Others, Show All and Quit (⌘Q goes through the usual exit, so Drive uploads
 *          finish first, ADR-0106); Edit (⌘C / ⌘V / ⌘X / ⌘A / ⌘Z only work in text boxes on a Mac when
 *          the menu has them); the page zoom and full screen; and the Window menu's Zoom and Bring All to
 *          Front. Windows and Linux keep Electron's default (unchanged).
 * Used by: src/main.ts (start(), on macOS); tests/unit/macMenu.test.ts
 * Depends on: electron (MenuItemConstructorOptions type)
 * Architecture: docs/decisions/ADR-0111-mac-parity.md
 */
import type { MenuItemConstructorOptions } from 'electron';

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
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];
}
