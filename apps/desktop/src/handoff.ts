/**
 * File: apps/desktop/src/handoff.ts
 * Purpose: The desktop side of the browser-to-desktop hand-off (spec S9, option B): finds a
 *          paramountai:// link in the command line, decides when the app registers the protocol, lets
 *          the person pick a session file, and deletes that one file when they ask. The page never
 *          names a path: the only file this can delete is the last one picked in the system's own file
 *          dialog, once.
 * Used by: src/main.ts; tests/unit/handoff.test.ts
 * Depends on: @kite/shared (the link), electron (types), src/channels.ts, src/hotkeys.ts (isKiteSender)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S9); ADR-0045
 *
 * The file's text goes to the page in memory; it is never logged.
 */
import {
  DESKTOP_PROTOCOL,
  parseDesktopLink,
  type DesktopLink,
  type HandoffPick,
} from '@kite/shared';
import type { BrowserWindow, Dialog, IpcMain } from 'electron';
import { HANDOFF_DELETE_CHANNEL, HANDOFF_PICK_CHANNEL } from './channels';
import { isKiteSender } from './hotkeys';

/** Largest file read, in bytes: the same limit as any import in the web app. */
export const MAX_HANDOFF_BYTES = 50 * 1024 * 1024;

/**
 * Finds a paramountai:// link among a process's arguments. Windows passes the link as an argument, both
 * on a first start and to a running copy.
 *
 * @param argv The arguments.
 * @returns What the link asks for, or null when there is no valid one.
 * Called from: main.ts; tests
 */
export function linkFromArgv(argv: readonly string[]): DesktopLink | null {
  const raw = argv.find((arg) => arg.startsWith(`${DESKTOP_PROTOCOL}://`));
  return raw ? parseDesktopLink(raw) : null;
}

/**
 * Whether this run should register the protocol with the system. Only an installed app, on its own
 * profile: a test run (--user-data-dir) must never change what the person's computer opens.
 *
 * @param context.isPackaged           True in an installed app.
 * @param context.hasUserDataDirSwitch True when --user-data-dir was passed.
 * @returns True to register.
 * Called from: start() in main.ts; tests
 */
export function shouldRegisterProtocol(context: {
  /** True in an installed app. */
  isPackaged: boolean;
  /** True when --user-data-dir was passed (every test run). */
  hasUserDataDirSwitch: boolean;
}): boolean {
  return context.isPackaged && !context.hasUserDataDirSwitch;
}

/** What installHandoff() needs. */
export interface HandoffDeps {
  /** Electron's ipcMain. */
  ipcMain: Pick<IpcMain, 'handle'>;
  /** Electron's dialog. */
  dialog: Pick<Dialog, 'showOpenDialog'>;
  /** The window asking, for the dialog to sit over. */
  windowFor: (event: Electron.IpcMainInvokeEvent) => BrowserWindow | null;
  /** The file operations (node:fs/promises in the app; fakes in tests). */
  files: {
    /** The file's size in bytes. */
    size: (path: string) => Promise<number>;
    /** The file's text. */
    read: (path: string) => Promise<string>;
    /** Deletes the file. */
    remove: (path: string) => Promise<void>;
  };
  /** The only origin allowed to ask. */
  allowedOrigins: readonly string[];
}

/**
 * Installs the two calls. Both are for the Kite page only.
 *
 * @param deps See HandoffDeps.
 * Called from: start() in main.ts; tests
 */
export function installHandoff(deps: HandoffDeps): void {
  // Set only by the system's dialog, never by the page, and forgotten once used.
  let picked: string | null = null;

  deps.ipcMain.handle(HANDOFF_PICK_CHANNEL, async (event): Promise<HandoffPick | null> => {
    if (!isKiteSender(event, deps.allowedOrigins)) throw new Error('Not for this page');
    const window = deps.windowFor(event);
    const options = {
      title: 'Choose the session file',
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'Session file', extensions: ['json'] }],
    };
    const choice = await (window
      ? deps.dialog.showOpenDialog(window, options)
      : deps.dialog.showOpenDialog(options));
    const path = choice.filePaths[0];
    if (choice.canceled || !path) return null;
    if ((await deps.files.size(path)) > MAX_HANDOFF_BYTES) {
      picked = null;
      return { name: fileName(path), text: '', tooLarge: true };
    }
    const text = await deps.files.read(path);
    picked = path;
    return { name: fileName(path), text };
  });

  deps.ipcMain.handle(HANDOFF_DELETE_CHANNEL, async (event): Promise<boolean> => {
    if (!isKiteSender(event, deps.allowedOrigins)) throw new Error('Not for this page');
    const path = picked;
    picked = null;
    if (!path) return false;
    try {
      await deps.files.remove(path);
      return true;
    } catch {
      // Moved or already gone. Its path stays out of the log.
      console.warn('desktop: the hand-off file could not be deleted');
      return false;
    }
  });
}

/**
 * The last part of a path, on Windows or macOS.
 *
 * @param path The path.
 * @returns The file's name.
 * Called from: installHandoff()
 */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
