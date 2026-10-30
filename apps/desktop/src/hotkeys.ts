/**
 * File: apps/desktop/src/hotkeys.ts
 * Purpose: The desktop app's global shortcuts (architecture §7.3): Electron globalShortcut with
 *          the default accelerators, forwarded to the Kite page as `kite:hotkey` messages
 *          (preload.ts hands them to window.kiteDesktop.onHotkey). The page turns them on for a
 *          live call and off at End (`kite:set-hotkeys`, from the Kite origin only); they are
 *          also released when the app quits. A shortcut another app already uses is reported
 *          back, so the page can say which one.
 * Used by: src/main.ts (installHotkeys)
 * Depends on: electron (globalShortcut, ipcMain types), @kite/shared (DEFAULT_GLOBAL_HOTKEYS,
 *             HOTKEY_ACTIONS, HotkeyStatus), src/channels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (hotkeys.ts); day-04-answers.md
 *               Stage 8
 *
 * Why only during a call: a global shortcut takes its keys away from every other app while it
 * is registered (Electron docs), and Ctrl+Backspace / Ctrl+← / Ctrl+→ edit text everywhere.
 * Electron's register() returns false, silently, when another app already holds a shortcut.
 */
import {
  DEFAULT_GLOBAL_HOTKEYS,
  HOTKEY_ACTIONS,
  type HotkeyAction,
  type HotkeyStatus,
} from '@kite/shared';
import type { GlobalShortcut, IpcMain, IpcMainInvokeEvent } from 'electron';
import { HOTKEY_CHANNEL, SET_HOTKEYS_CHANNEL } from './channels';

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
}

/**
 * Creates the global-shortcut controller.
 *
 * @param globalShortcut Electron's globalShortcut (mocked in tests).
 * @param send           Forwards an action to the Kite page.
 * @param accelerators   The shortcuts (default DEFAULT_GLOBAL_HOTKEYS).
 * @returns The controller.
 * Called from: installHotkeys(); tests
 */
export function createHotkeys(
  globalShortcut: Pick<GlobalShortcut, 'register' | 'unregister'>,
  send: (action: HotkeyAction) => void,
  accelerators: Readonly<Record<HotkeyAction, string>> = DEFAULT_GLOBAL_HOTKEYS,
): HotkeyController {
  /** Accelerators this controller registered (and so may release). */
  let registered: string[] = [];
  let on = false;

  const disable = () => {
    for (const accelerator of registered) globalShortcut.unregister(accelerator);
    registered = [];
    on = false;
  };

  return {
    enable() {
      disable();
      on = true;
      return HOTKEY_ACTIONS.map((action) => {
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
    },
    disable,
    enabled: () => on,
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
  sendToPage: (channel: string, action: HotkeyAction) => void;
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
  const controller = createHotkeys(deps.globalShortcut, (action) =>
    deps.sendToPage(HOTKEY_CHANNEL, action),
  );
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
