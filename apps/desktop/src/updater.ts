/**
 * File: apps/desktop/src/updater.ts
 * Purpose: Keeps the installed Kite desktop app up to date (Day 6 Stage 3; ADR-0028): checks
 *          the public releases-only repository on start and every 6 hours, downloads a new
 *          version in the background, and asks the user to restart, but never during a live
 *          call (the page says when one is live through window.kiteDesktop.setCallActive()).
 *          If the user chooses Later, the update is installed when Kite quits.
 * Used by: src/main.ts (installed builds only)
 * Depends on: electron (app, dialog, ipcMain), electron-updater (autoUpdater; the feed is the
 *             "publish" setting in electron-builder.yml, written into the installed app),
 *             src/channels.ts, src/hotkeys.ts (isKiteSender)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10 (installation); ADR-0028
 *
 * Logs only versions and outcomes. No token: the releases repository is public.
 */
import { app, dialog, type BrowserWindow, type IpcMain } from 'electron';
// A named import: once esbuild bundles this CommonJS package, it has no default export (a
// default import was undefined in the installed app, Day 6 update test).
import { autoUpdater } from 'electron-updater';
import { CALL_ACTIVE_CHANNEL } from './channels';
import { isKiteSender } from './hotkeys';

/** How often to check for a new version, ms (6 hours). */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** What the updater knows when deciding whether to ask the user to restart. */
export interface UpdateState {
  /** A new version has been downloaded and is ready to install. */
  downloaded: boolean;
  /** A live call is going on in the page. */
  callActive: boolean;
  /** The user has already been asked about this version (and chose Later). */
  asked: boolean;
}

/**
 * Whether to ask the user to restart now.
 *
 * @param state See UpdateState.
 * @returns 'ask' to show the restart question; 'wait' while a call is live (ask when it ends);
 *          'none' when there is nothing to ask.
 * Called from: startUpdater() (after a download, and when a call ends); tests
 */
export function nextUpdateStep(state: UpdateState): 'ask' | 'wait' | 'none' {
  if (!state.downloaded || state.asked) return 'none';
  return state.callActive ? 'wait' : 'ask';
}

/** What startUpdater() needs from main.ts. */
export interface UpdaterOptions {
  /** Electron's ipcMain. */
  ipcMain: IpcMain;
  /** The Kite origin (only the Kite page may say a call is live). */
  allowedOrigin: string;
  /** The main window, for the restart question (null when closed). */
  getWindow: () => BrowserWindow | null;
}

/**
 * Starts checking for updates (installed builds only; see main.ts).
 *
 * Test hook: KITE_TEST_UPDATE_ACCEPT=1 restarts into a downloaded update without asking (the
 * update test on Day 6 runs without anyone to click).
 *
 * @param options See UpdaterOptions.
 * @returns Nothing.
 * Called from: main.ts (after the main window opens)
 */
export function startUpdater(options: UpdaterOptions): void {
  const state: UpdateState = { downloaded: false, callActive: false, asked: false };
  autoUpdater.autoDownload = true;
  // "Later": the downloaded version is installed when Kite quits.
  autoUpdater.autoInstallOnAppQuit = true;
  // electron-updater logs to the console by default; Kite logs versions only (below).
  autoUpdater.logger = null;

  /** Asks to restart when the state allows it. */
  const maybeAsk = () => {
    if (nextUpdateStep(state) !== 'ask') return;
    state.asked = true;
    if (process.env.KITE_TEST_UPDATE_ACCEPT === '1') {
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    const window = options.getWindow();
    const question = {
      type: 'info' as const,
      title: 'Kite update',
      message: 'A new version of Kite is ready.',
      detail: 'Restart Kite now to use it, or choose Later and it is installed when you quit Kite.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };
    void (window ? dialog.showMessageBox(window, question) : dialog.showMessageBox(question)).then(
      ({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(true, true);
      },
    );
  };

  options.ipcMain.on(CALL_ACTIVE_CHANNEL, (event, active: unknown) => {
    if (!isKiteSender(event, options.allowedOrigin)) return;
    state.callActive = active === true;
    // A call just ended: ask now if an update was waiting for it.
    maybeAsk();
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[kite] update ${info.version} downloaded (running ${app.getVersion()})`);
    state.downloaded = true;
    state.asked = false;
    maybeAsk();
  });
  autoUpdater.on('error', (error) => {
    // Offline or the feed unreachable: try again at the next check.
    console.warn(`[kite] update check failed: ${error.name}`);
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, CHECK_EVERY_MS);
}
