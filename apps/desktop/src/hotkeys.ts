/**
 * File: apps/desktop/src/hotkeys.ts
 * Purpose: The desktop app's global shortcuts (architecture §7.3; ADR-0029): Electron
 *          globalShortcut with the default accelerators. Answer, Screenshot, Chat (v1.1.0) and
 *          (v1.0.2, ADR-0035) the script bar are forwarded to the Kite page as `kite:hotkey` messages
 *          (preload.ts hands them to
 *          window.kiteDesktop.onHotkey); showing, hiding and moving the overlay is done by the
 *          shell itself. The page turns them on for a live call and off at End
 *          (`kite:set-hotkeys`, from the Kite origin only); they are also released when the app
 *          quits. A shortcut another app already uses is reported back, so the page can say which
 *          one, and Settings can check them all before a call (`kite:check-hotkeys`). The chat bar's
 *          screenshot shortcut (v1.2.0, spec S14) is held only while the bar is open. Click-through
 *          (v1.3.2, ADR-0061: Ctrl+Alt+X) goes to the page like the script bar.
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
  ASK_KITE_HOTKEY,
  DEFAULT_GLOBAL_HOTKEYS,
  GLOBAL_HOTKEYS,
  SCREENSHOT_SEND_HOTKEY,
  TRANSCRIPT_HOTKEY,
  type CallHotkey,
  type GlobalHotkey,
  type HotkeyStatus,
} from '@kite/shared';
import type { GlobalShortcut, IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  CHAT_HOTKEY_CHANNEL,
  CHECK_HOTKEYS_CHANNEL,
  HOTKEY_CHANNEL,
  SET_HOTKEYS_CHANNEL,
} from './channels';

/** The global shortcuts and what they do. */
export interface HotkeyController {
  /**
   * Registers every shortcut (first releasing any registered earlier).
   *
   * @returns Whether each one could be registered.
   */
  enable(): HotkeyStatus[];
  /**
   * Holds or releases the chat bar's screenshot shortcut (only during a call).
   *
   * @param on True while the chat bar is open.
   * @returns Whether it could be registered, when turning it on; otherwise null.
   */
  setChatSend(on: boolean): HotkeyStatus | null;
  /** Releases every shortcut this controller registered. */
  disable(): void;
  /** True while the shortcuts are on. */
  enabled(): boolean;
  /**
   * Holds the Ask Kite shortcut for as long as the app runs (ADR-0030). disable() leaves it.
   *
   * @returns Whether it could be registered.
   */
  enableAskKite(): HotkeyStatus;
  /** Releases everything, the Ask Kite shortcut too (the app is quitting). */
  releaseAll(): void;
  /**
   * Finds which shortcuts another app already uses (Settings). Outside a call it registers each
   * one for a moment and releases it again; during a call it reports the current state. v1.3.0
   * (ADR-0056): it also tries Transcript's keys (Ctrl+Alt+T) for a moment; they are never held, but
   * another app holding them globally would keep them from the bars.
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
  accelerators: Readonly<Record<CallHotkey, string>> = DEFAULT_GLOBAL_HOTKEYS,
): HotkeyController {
  /** The Ask Kite shortcut, once the app has asked for it. */
  let askKite: HotkeyStatus | null = null;
  /** Accelerators this controller registered (and so may release). */
  let registered: string[] = [];
  let on = false;
  let statuses: HotkeyStatus[] = [];
  /** The chat bar's screenshot shortcut, while it is held. */
  let chatSend: HotkeyStatus | null = null;

  /** Releases the chat bar's screenshot shortcut, if held. */
  const releaseChatSend = () => {
    if (chatSend?.registered) globalShortcut.unregister(SCREENSHOT_SEND_HOTKEY);
    chatSend = null;
  };

  const disable = () => {
    for (const accelerator of registered) globalShortcut.unregister(accelerator);
    registered = [];
    on = false;
    releaseChatSend();
  };

  /**
   * Registers the chat bar's screenshot shortcut.
   *
   * @returns Whether it could be registered.
   */
  const holdChatSend = (): HotkeyStatus => {
    let ok = false;
    try {
      ok = globalShortcut.register(SCREENSHOT_SEND_HOTKEY, () => send('screenshot-send'));
    } catch {
      // An accelerator the OS cannot register at all counts as unavailable.
      ok = false;
    }
    return { action: 'screenshot-send', accelerator: SCREENSHOT_SEND_HOTKEY, registered: ok };
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
    setChatSend(wanted) {
      if (!wanted) {
        releaseChatSend();
        return null;
      }
      // Only during a call: a late message after End must not take the keys from other apps.
      if (!on) return null;
      if (!chatSend) chatSend = holdChatSend();
      return chatSend;
    },
    enableAskKite() {
      let ok = false;
      try {
        ok = globalShortcut.register(ASK_KITE_HOTKEY, () => send('ask-kite'));
      } catch {
        // An accelerator the OS cannot register at all counts as unavailable.
        ok = false;
      }
      askKite = { action: 'ask-kite', accelerator: ASK_KITE_HOTKEY, registered: ok };
      return askKite;
    },
    releaseAll() {
      disable();
      if (askKite?.registered) globalShortcut.unregister(ASK_KITE_HOTKEY);
      askKite = null;
    },
    check() {
      const always = askKite ? [askKite] : [];
      // Tried for a moment unless it is already held, so Settings can report a clash before a call.
      const tryChatSend = () => {
        if (chatSend) return chatSend;
        const tried = holdChatSend();
        if (tried.registered) globalShortcut.unregister(SCREENSHOT_SEND_HOTKEY);
        return tried;
      };
      // Never held: tried for a moment and released straight away.
      const tryTranscript = (): HotkeyStatus => {
        let ok = false;
        try {
          ok = globalShortcut.register(TRANSCRIPT_HOTKEY, () => undefined);
        } catch {
          // An accelerator the OS cannot register at all counts as unavailable.
          ok = false;
        }
        if (ok) globalShortcut.unregister(TRANSCRIPT_HOTKEY);
        return { action: 'transcript', accelerator: TRANSCRIPT_HOTKEY, registered: ok };
      };
      if (on) return [...statuses, tryChatSend(), tryTranscript(), ...always];
      const found = enable();
      disable();
      return [...found, tryChatSend(), tryTranscript(), ...always];
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
  /** Brings up the window where Ask Kite will open (ADR-0030). Optional in tests. */
  showForAskKite?: () => void;
  /** Gives the overlay the keyboard for the Chat shortcut (v1.1.0). Optional in tests. */
  showForChat?: () => void;
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
    else {
      // The page has to be in view for Ask Kite: main.ts brings up the right window first.
      if (action === 'ask-kite') deps.showForAskKite?.();
      if (action === 'chat') deps.showForChat?.();
      deps.sendToPage(HOTKEY_CHANNEL, action);
    }
  });
  const askKite = controller.enableAskKite();
  if (!askKite.registered) console.info('desktop: Ask Kite shortcut taken by another app');
  deps.ipcMain.handle(CHECK_HOTKEYS_CHANNEL, (event) => {
    if (!isKiteSender(event, deps.allowedOrigin)) {
      throw new Error('Hotkeys can only be checked by the Kite page');
    }
    return controller.check();
  });
  deps.ipcMain.handle(CHAT_HOTKEY_CHANNEL, (event, on: unknown) => {
    if (!isKiteSender(event, deps.allowedOrigin)) {
      throw new Error('Hotkeys can only be changed by the Kite page');
    }
    controller.setChatSend(on === true);
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
