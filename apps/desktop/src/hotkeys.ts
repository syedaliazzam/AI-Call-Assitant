/**
 * File: apps/desktop/src/hotkeys.ts
 * Purpose: The desktop app's global shortcuts (architecture §7.3; ADR-0029): Electron
 *          globalShortcut with the default accelerators. Answer and Screenshot are forwarded to
 *          the Kite page as `kite:hotkey` messages (preload.ts hands them to
 *          window.kiteDesktop.onHotkey); showing, hiding and moving the overlay is done by the
 *          shell itself. The page turns them on for a live call and off at End
 *          (`kite:set-hotkeys`, from the Kite origin only); they are also released when the app
 *          quits. A shortcut another app already uses is reported back, so the page can say which
 *          one, and Settings can check them all before a call (`kite:check-hotkeys`).
 * Used by: src/main.ts (installHotkeys)
 * Depends on: electron (globalShortcut, ipcMain types), @kite/shared (DEFAULT_GLOBAL_HOTKEYS,
 *             HOTKEY_ACTIONS, HotkeyStatus), src/channels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (hotkeys.ts); day-04-answers.md
 *               Stage 8
 *
 * Why only during a call: a global shortcut takes its keys away from every other app while it
 * is registered (Electron docs). Ctrl+Backspace / Ctrl+← / Ctrl+→ edit text everywhere, so they
 * are never global (the page handles them while Kite has focus).
 * Electron's register() returns false, silently, when another app already holds a shortcut.
 */
import {
  DEFAULT_GLOBAL_HOTKEYS,
  GLOBAL_HOTKEYS,
  type GlobalHotkey,
  type HotkeyStatus,
} from '@kite/shared';
import type { GlobalShortcut, IpcMain, IpcMainInvokeEvent } from 'electron';
import { CHECK_HOTKEYS_CHANNEL, HOTKEY_CHANNEL, SET_HOTKEYS_CHANNEL } from './channels';

/** The global shortcuts and what they do. */
export interface HotkeyController {
  /**
   * Registers every shortcut (first releasing any registered earlier).
   *
   * @returns Whether each one could be registered.
   */
  enable(): HotkeyStatus[];
  /** Releases every shortcut this controller registered. */
  disable(): void;
  /** True while the shortcuts are on. */
  enabled(): boolean;
  /**
   * Finds which shortcuts another app already uses (Settings). Outside a call it registers each
   * one for a moment and releases it again; during a call it reports the current state.
   *
   * @returns Whether each one can be registered.
   */
  check(): HotkeyStatus[];
}

/**
 * Creates the global-shortcut controller.
 *
 * @param globalShortcut Electron's globalShortcut (mocked in tests).
 * @param send           Carries out a shortcut (the page's actions go to the page, the overlay's
 *                       to the overlay window).
 * @param accelerators   The shortcuts (default DEFAULT_GLOBAL_HOTKEYS).
 * @returns The controller.
 * Called from: installHotkeys(); tests
 */
export function createHotkeys(
  globalShortcut: Pick<GlobalShortcut, 'register' | 'unregister'>,
  send: (action: GlobalHotkey) => void,
  accelerators: Readonly<Record<GlobalHotkey, string>> = DEFAULT_GLOBAL_HOTKEYS,
): HotkeyController {
  /** Accelerators this controller registered (and so may release). */
  let registered: string[] = [];
  let on = false;
  let statuses: HotkeyStatus[] = [];

  const disable = () => {
    for (const accelerator of registered) globalShortcut.unregister(accelerator);
    registered = [];
    on = false;
  };

  /**
   * Registers every shortcut.
   *
   * @returns Whether each one could be registered.
   */
  const enable = () => {
    disable();
    on = true;
    statuses = GLOBAL_HOTKEYS.map((action) => {
      const accelerator = accelerators[action];
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => send(action));
      } catch {
        // An accelerator the OS cannot register at all counts as unavailable.
        ok = false;
      }
      if (ok) registered.push(accelerator);
      return { action, accelerator, registered: ok };
    });
    return statuses;
  };

  return {
    enable,
    disable,
    enabled: () => on,
    check() {
      if (on) return statuses;
      const found = enable();
      disable();
      return found;
    },
  };
}

/**
 * Whether a set-hotkeys request comes from the Kite page itself (its top frame on the Kite
 * origin), so no other page or frame can take the user's shortcuts.
 *
 * @param event         The IPC event.
 * @param allowedOrigin The Kite origin.
 * @returns True for the Kite page's main frame.
 * Called from: installHotkeys(); tests
 */
export function isKiteSender(
  event: Pick<IpcMainInvokeEvent, 'senderFrame'>,
  allowedOrigin: string,
): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return false;
  try {
    return new URL(frame.url).origin === allowedOrigin;
  } catch {
    return false;
  }
}

/** What installHotkeys() needs from Electron and main.ts. */
export interface HotkeyDeps {
  /** Electron's globalShortcut. */
  globalShortcut: Pick<GlobalShortcut, 'register' | 'unregister'>;
  /** Electron's ipcMain. */
  ipcMain: Pick<IpcMain, 'handle'>;
  /** Sends a message to the Kite window (does nothing when it is closed). */
  sendToPage: (channel: string, action: GlobalHotkey) => void;
  /** Carries out an overlay shortcut (show, hide, move). Optional in tests. */
  overlayAction?: (action: GlobalHotkey) => void;
  /** The Kite origin. */
  allowedOrigin: string;
}

/**
 * Wires the global shortcuts: the page turns them on and off over IPC, presses are forwarded
 * to the page, and the caller releases them when the app quits.
 *
 * @param deps Electron objects, the window sender and the Kite origin.
 * @returns The controller (main.ts calls disable() on quit and when the window closes).
 * Called from: start() in main.ts; tests
 */
export function installHotkeys(deps: HotkeyDeps): HotkeyController {
  const controller = createHotkeys(deps.globalShortcut, (action) => {
    if (action.startsWith('overlay-')) deps.overlayAction?.(action);
    else deps.sendToPage(HOTKEY_CHANNEL, action);
  });
  deps.ipcMain.handle(CHECK_HOTKEYS_CHANNEL, (event) => {
    if (!isKiteSender(event, deps.allowedOrigin)) {
      throw new Error('Hotkeys can only be checked by the Kite page');
    }
    return controller.check();
  });
  deps.ipcMain.handle(SET_HOTKEYS_CHANNEL, (event, on: unknown) => {
    if (!isKiteSender(event, deps.allowedOrigin)) {
      throw new Error('Hotkeys can only be changed by the Kite page');
    }
    if (on === true) {
      const statuses = controller.enable();
      // Which shortcuts are taken (accelerators only; nothing about the call).
      const taken = statuses.filter((status) => !status.registered).map((s) => s.accelerator);
      console.info('desktop: hotkeys on', { taken });
      return statuses;
    }
    controller.disable();
    return [];
  });
  return controller;
}
