/**
 * File: apps/desktop/src/updater.ts
 * Purpose: Keeps the installed Kite desktop app up to date (Day 6 Stage 3; ADR-0028): checks
 *          the public releases-only repository on start and every 6 hours, downloads a new
 *          version in the background, and asks the user to restart, but never during a live
 *          call (the page says when one is live through window.kiteDesktop.setCallActive()).
 *          If the user chooses Later, the update is installed when Kite quits. 1.7.2 (ADR-0106): never
 *          while a Drive upload is left either: the question waits until the queue is done, and an app
 *          finishing its uploads after the user exited installs the update when it quits by itself.
 *          1.8.0 (ADR-0109): macOS reads its own channel (mac-latest, set in electron-builder.yml), and a
 *          local test feed can be set for the real-Mac update test (testUpdateFeed()); only addresses on
 *          this computer are accepted. Squirrel.Mac installs only a build signed with our certificate.
 *          Mac 1.8.1 / Windows 1.7.5: "Check for Updates…" (checkNow(), manualCheckReply()) checks at once and says
 *          "You're up to date", or downloads and then asks Restart now / Later under the same rules.
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

/**
 * 1.8.0 (ADR-0109 §5): the file in the app's data folder that points the updater at a test feed on this
 * computer, for the real-Mac update test (docs/testing/mac-release-test.md). A file, not only a variable:
 * on macOS an app started from Terminal has its permissions counted against Terminal, which would spoil a
 * test of whether the app's own permissions survive an update. Outside the signed app, so writing it never
 * changes the app's signature.
 */
export const TEST_FEED_FILE = 'test-update-feed.txt';

/** The hosts a test feed may use: this computer only, so it can never point an installed app elsewhere. */
const TEST_FEED_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * The local test feed to use instead of the release channel, when one is set and is on this computer.
 *
 * @param fromEnv  KITE_TEST_UPDATE_FEED, if set.
 * @param fromFile The text of TEST_FEED_FILE, or null when there is none.
 * @returns The feed's address, or null (no test feed, or one that is not http:// on this computer).
 * Called from: start() in main.ts; tests
 */
export function testUpdateFeed(
  fromEnv: string | undefined,
  fromFile: string | null,
): string | null {
  const value = (fromEnv ?? fromFile ?? '').trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || !TEST_FEED_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/** What the updater knows when deciding whether to ask the user to restart. */
export interface UpdateState {
  /** A new version has been downloaded and is ready to install. */
  downloaded: boolean;
  /** A live call is going on in the page. */
  callActive: boolean;
  /** The user has already been asked about this version (and chose Later). */
  asked: boolean;
  /** 1.7.2 (ADR-0106): Drive uploads are left on this computer (or the app runs on to finish them). */
  uploading?: boolean;
}

/**
 * Whether to ask the user to restart now.
 *
 * @param state See UpdateState.
 * @returns 'ask' to show the restart question; 'wait' while a call is live or Drive uploads are left
 *          (ask when they end); 'none' when there is nothing to ask.
 * Called from: startUpdater() (after a download, and when a call ends); tests
 */
export function nextUpdateStep(state: UpdateState): 'ask' | 'wait' | 'none' {
  if (!state.downloaded || state.asked) return 'none';
  return state.callActive || state.uploading ? 'wait' : 'ask';
}

/** What startUpdater() needs from main.ts. */
export interface UpdaterOptions {
  /** Electron's ipcMain. */
  ipcMain: IpcMain;
  /** The Kite origin (only the Kite page may say a call is live). */
  allowedOrigin: string;
  /** The main window, for the restart question (null when closed). */
  getWindow: () => BrowserWindow | null;
  /**
   * 1.7.2 (ADR-0106): true while Drive uploads are left or the app runs on in the background to finish
   * them; a restart then waits.
   */
  uploadsBusy?: () => boolean;
  /** 1.8.0 (ADR-0109): a local test feed (testUpdateFeed()), or null for the release channel. */
  testFeed?: string | null;
}

/** What startUpdater() gives main.ts. */
export interface Updater {
  /** 1.7.2 (ADR-0106): the Drive uploads are done: ask now if an update was waiting for them. */
  uploadsIdle(): void;
  /**
   * Mac 1.8.1 / Windows 1.7.5: "Check for Updates…" (the Mac app menu, the tray): checks now and says what it
   * found. A downloaded update gets the usual Restart now / Later question, never during a call or while Drive
   * uploads are left (it then says it will ask afterwards).
   *
   * @returns What the check found (the message shown is manualCheckReply() of it).
   */
  checkNow(): Promise<ManualCheckOutcome>;
  /**
   * The newer version the last check found (downloading or downloaded), for the manual check's message.
   *
   * @returns Its version, or null when none was found.
   */
  foundVersion(): string | null;
}

/**
 * What "Check for Updates…" found (Mac 1.8.1 / Windows 1.7.5).
 * - `up-to-date`: this is the newest version.
 * - `downloading`: a newer version is downloading; the restart question comes when it is ready.
 * - `ready`: a newer version is downloaded; the Restart now / Later question is shown instead of a message.
 * - `ready-later`: downloaded, but a call or Drive uploads are on: the question comes when they end.
 * - `failed`: the check could not reach the release feed (offline, GitHub down).
 * - `unavailable`: this app does not update itself (a development run, or a Microsoft Store install).
 */
export type ManualCheckOutcome =
  'up-to-date' | 'downloading' | 'ready' | 'ready-later' | 'failed' | 'unavailable';

/** A message box's text for a manual check. */
export interface ManualCheckReply {
  /** The bold first line. */
  message: string;
  /** The line under it. */
  detail: string;
}

/**
 * The message "Check for Updates…" shows for an outcome (Mac 1.8.1 / Windows 1.7.5).
 *
 * @param outcome  What the check found.
 * @param versions The running version, and the newer one when there is one.
 * @returns The message, or null for `ready` (the Restart now / Later question is shown instead).
 * Called from: showManualCheck() in main.ts; tests
 */
export function manualCheckReply(
  outcome: ManualCheckOutcome,
  versions: { current: string; next?: string | null },
): ManualCheckReply | null {
  const next = versions.next ? ` ${versions.next}` : '';
  switch (outcome) {
    case 'ready':
      return null;
    case 'up-to-date':
      return {
        message: "You're up to date",
        detail: `Paramount AI ${versions.current} is the newest version.`,
      };
    case 'downloading':
      return {
        message: `Downloading Paramount AI${next}`,
        detail:
          'It downloads in the background. When it is ready, Paramount AI asks you to restart (never during a call).',
      };
    case 'ready-later':
      return {
        message: `Paramount AI${next} is ready`,
        detail:
          'Paramount AI asks you to restart when your call ends and any Drive uploads have finished.',
      };
    case 'failed':
      return {
        message: 'Could not check for updates',
        detail: 'Check your internet connection and try again.',
      };
    case 'unavailable':
      return {
        message: 'Updates are not checked here',
        detail:
          'This copy of Paramount AI does not update itself (a test run, or the Microsoft Store keeps it up to date).',
      };
  }
}

/**
 * Starts checking for updates (installed builds only; see main.ts).
 *
 * Test hook: KITE_TEST_UPDATE_ACCEPT=1 restarts into a downloaded update without asking (the
 * update test on Day 6 runs without anyone to click).
 *
 * @param options See UpdaterOptions.
 * @returns The hook main.ts calls when the Drive uploads are done.
 * Called from: main.ts (after the main window opens)
 */
export function startUpdater(options: UpdaterOptions): Updater {
  const state: UpdateState = { downloaded: false, callActive: false, asked: false };
  autoUpdater.autoDownload = true;
  // "Later": the downloaded version is installed when Kite quits.
  autoUpdater.autoInstallOnAppQuit = true;
  // electron-updater logs to the console by default; Kite logs versions only (below).
  autoUpdater.logger = null;
  if (options.testFeed) {
    // The real-Mac update test only (ADR-0109 §5): the same checks as the release channel (SHA-512 from the
    // feed's update file; on macOS Squirrel.Mac's signature check), from a server on this computer.
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: options.testFeed,
      useMultipleRangeRequest: false,
    });
    console.log('[kite] update feed: local test feed');
  }

  /** Asks to restart when the state allows it. */
  const maybeAsk = () => {
    state.uploading = options.uploadsBusy?.() ?? false;
    if (nextUpdateStep(state) !== 'ask') return;
    state.asked = true;
    if (process.env.KITE_TEST_UPDATE_ACCEPT === '1') {
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    const window = options.getWindow();
    const question = {
      type: 'info' as const,
      title: 'Paramount AI update',
      message: 'A new version of Paramount AI is ready.',
      detail:
        'Restart Paramount AI now to use it, or choose Later and it is installed when you quit Paramount AI.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };
    void (window ? dialog.showMessageBox(window, question) : dialog.showMessageBox(question)).then(
      ({ response }) => {
        if (response !== 0) return;
        // 1.7.2 (ADR-0106): an upload that started while the question was open goes first; the
        // question comes back when the queue is done.
        if (options.uploadsBusy?.()) {
          state.asked = false;
          return;
        }
        autoUpdater.quitAndInstall(true, true);
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

  // Mac 1.8.1 / Windows 1.7.5: the version a check found and is downloading (for "Check for Updates…").
  let found: string | null = null;
  autoUpdater.on('update-available', (info) => {
    found = info.version;
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, CHECK_EVERY_MS);

  /**
   * "Check for Updates…": checks now (see Updater.checkNow).
   *
   * @returns What it found.
   */
  const checkNow = async (): Promise<ManualCheckOutcome> => {
    if (state.downloaded) {
      // Asked before and the user chose Later: a manual check asks again (outside a call and uploads).
      state.asked = false;
      state.uploading = options.uploadsBusy?.() ?? false;
      if (nextUpdateStep(state) === 'wait') return 'ready-later';
      maybeAsk();
      return 'ready';
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) return 'unavailable';
      if (!result.isUpdateAvailable) return 'up-to-date';
      found = result.updateInfo.version;
      // autoDownload is on, so the download has started; 'update-downloaded' asks as usual.
      return 'downloading';
    } catch {
      return 'failed';
    }
  };
  return { uploadsIdle: maybeAsk, checkNow, foundVersion: () => found };
}
