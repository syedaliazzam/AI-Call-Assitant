/**
 * File: apps/desktop/src/main.ts
 * Purpose: Electron main process: starts one instance of the app, opens the home panel on KITE_URL
 *          (v1.1.0, ADR-0041), applies every security rule from src/security.ts, and wires the global
 *          shortcuts (src/hotkeys.ts, Day 4), screenshots (src/screenshot.ts), the compact live window
 *          (src/windows.ts) and screen-share protection on every window (src/protection.ts, ADR-0042).
 * Used by: Electron (package.json "main": dist/main.js, built by esbuild)
 * Depends on: electron, src/config.ts, src/security.ts, src/media.ts, src/hotkeys.ts,
 *             src/screenshot.ts, src/windows.ts, src/snapZones.ts, src/home.ts, src/protection.ts,
 *             src/store.ts, src/icon.ts, src/accurate/host.ts (accurate transcription, ADR-0034),
 *             src/recordings/host.ts (meeting recording and the player, 1.5.0, ADR-0068),
 *             src/drive/host.ts (Google Drive uploads and the saved notification, 1.6.0, ADR-0072)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (main.ts), §8.3
 *
 * The windows (v1.1.0): the home panel between calls; the main window for the dashboard, the wizard,
 * Settings and the call itself (it holds the audio and the speech engine, so it runs the call while
 * minimised); the overlay during a call; a side window for pages opened during a call, because
 * navigating the main window then would end the call; and the snap zones during a drag.
 *
 * Kite never hides from the taskbar, Dock or process lists, and does not try to evade
 * monitoring or proctoring software (CLAUDE.md).
 */
import os from 'node:os';
import path from 'node:path';
import {
  DESKTOP_PROTOCOL,
  RECORDING_SCHEME,
  isSessionId,
  PAGES_WINDOW_PATH,
  parseDesktopLink,
  type DesktopLink,
  type WindowControlAction,
} from '@kite/shared';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  Notification,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  utilityProcess,
} from 'electron';
import { installAccurate, type WorkerProcess } from './accurate/host';
import { MODEL_FOLDER } from './accurate/model';
import {
  CALL_ACTIVE_CHANNEL,
  LINK_CODE_CHANNEL,
  OPEN_CALL_WINDOW_CHANNEL,
  OPEN_PAGES_CHANNEL,
  SIZE_PANEL_CHANNEL,
  WINDOW_CONTROL_CHANNEL,
} from './channels';
import { APP_NAME, loadConfig, pinnedDataFolder, type DesktopConfig } from './config';

/** 1.5.1 (ADR-0069): electron-builder.yml's appId, which the installer gives the Start Menu shortcut. */
const APP_USER_MODEL_ID = 'co.paramountintelligence.kite';
import { linkFromArgv, shouldRegisterProtocol } from './links';
import { createHomeWindow, isPanelSize, type HomeWindow } from './home';
import { startUpdater } from './updater';
import { installHotkeys, isKiteSender, type HotkeyController } from './hotkeys';
import { appIconPath } from './icon';
import { createProtection, installProtection, type Protection } from './protection';
import { installScreenshot } from './screenshot';
import { createSnapZones } from './snapZones';
import {
  BUNDLED_MODEL_FOLDER,
  installBundledModel,
  MODEL_SCHEME,
  VERIFIED_FILE,
} from './speechModel';
import { installRecordings, type FinaliseProcess, type RecordingsHost } from './recordings/host';
import { installDrive, type DriveHost } from './drive/host';
import { createStore } from './store';
import {
  createCompactWindows,
  installCompactWindows,
  overlayShortcut,
  type CompactWindows,
} from './windows';
import { allowSystemAudioLoopback } from './media';
import {
  allowOnlyOurPermissions,
  lockNavigation,
  openInSystemBrowser,
  secureWebPreferences,
} from './security';

/** The main window, or null before it is first needed and after it closes. */
let mainWindow: BrowserWindow | null = null;

/** The side window for pages opened during a call (v1.1.0), or null. */
let sideWindow: BrowserWindow | null = null;

/** 1.5.0 (ADR-0068): the recording player window, or null. */
let playerWindow: BrowserWindow | null = null;

/** 1.5.0 (ADR-0068): meeting recording (created when the app is ready). */
let recordings: RecordingsHost | null = null;

/** 1.6.0 (ADR-0072): Google Drive uploads of recordings and the "saved" notification. */
let drive: DriveHost | null = null;

/** The Kite URL, once loaded (the player opens on it). */
let kiteConfig: DesktopConfig | null = null;

/** The home panel (created when the app is ready; v1.1.0). */
let home: HomeWindow | null = null;

/** The compact live window (created when the app is ready). */
let compact: CompactWindows | null = null;

/** The global shortcuts (created when the app is ready). */
let hotkeys: HotkeyController | null = null;

/** Screen-share protection of every window (created when the app is ready). */
let protection: Protection | null = null;

/** True while a live call is connected (the Kite page says so; v1.1.0). */
let callActive = false;

/** A paramountai:// link that arrived before the windows existed (macOS sends it early). */
let earlyLink: DesktopLink | null = null;

/**
 * v1.3.0 (ADR-0055): the main window was opened for a call started from the home panel's Connect card.
 * It then stays minimised when the call ends (the panel comes back instead) and closes itself once the
 * call's notes are saved.
 */
let callWindowFromPanel = false;

/** True once the app is quitting: closing the main window then really closes it. */
let quitting = false;

/**
 * How long Windows takes to apply protection before a capture leaves a window out, in ms. It takes
 * effect with the next desktop composition (protection.ts), a frame or two; the rest is margin.
 */
const PROTECTION_SETTLE_MS = 120;

/**
 * Whether a value from the page is a window action.
 *
 * @param value What arrived over IPC.
 * @returns True for 'minimize' or 'close'.
 * Called from: start()
 */
function isWindowControl(value: unknown): value is WindowControlAction {
  return value === 'minimize' || value === 'close';
}

/**
 * Brings up the first window a person should see: the overlay during a call, otherwise the panel.
 *
 * Called from: a second launch; the macOS Dock icon
 */
function showFront(): void {
  const overlay = compact?.window();
  if (callActive && overlay) {
    overlay.showInactive();
    return;
  }
  home?.open();
}

/**
 * Acts on a paramountai:// link. It only brings a window forward: a link can come from any web page, so
 * it never starts a call or changes anything. During a call it brings up the overlay, as a launch does.
 *
 * @param link What the link asks for, or null for an invalid one.
 * Called from: a second launch, macOS's open-url, the first start
 */
function followLink(link: DesktopLink | null): void {
  if (!home) {
    earlyLink = link;
    return;
  }
  // 1.5.0 (ADR-0068): a recording link opens the player; the page says when the file is not here.
  if (link?.kind === 'recording') openPlayer(`/player/${link.recordingId}`);
  else if (link?.kind === 'session' && !callActive) home.openSession(link.sessionId, link.code);
  else showFront();
}

/**
 * 1.5.0 (ADR-0068): opens the player window on a page (or brings it forward on that page). It is a
 * normal window of its own, so playing a recording never navigates a window that runs a call.
 *
 * @param page The player's path, /player/<id> (the id was checked by the link parser or the index).
 * Called from: followLink(), the recordings host (Play)
 */
function openPlayer(page: string): void {
  if (!kiteConfig) return;
  const url = new URL(page, kiteConfig.kiteUrl).toString();
  if (playerWindow && !playerWindow.isDestroyed()) {
    if (playerWindow.webContents.getURL() !== url) void playerWindow.loadURL(url);
    bringForward(playerWindow);
    return;
  }
  const window = createPagesWindow(kiteConfig, page, true);
  window.setSize(1180, 760);
  window.on('closed', () => {
    if (playerWindow === window) playerWindow = null;
  });
  playerWindow = window;
}

/**
 * Makes sure only one copy of Kite runs. A second launch brings up the running copy instead of
 * opening another one (two copies would compete for the microphone and hotkeys). A
 * paramountai:// link on Windows arrives this way too, as an argument of the second launch.
 *
 * @returns True if this is the first instance; false if it is quitting in favour of another.
 * Called from: start()
 */
function ensureSingleInstance(): boolean {
  // 1.5.1 (ADR-0069): the same AppUserModelID as the installer's Start Menu shortcut (electron-builder's
  // appId), so Windows treats the running app and the shortcut as one app (Start, search, taskbar pins).
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', (_event, argv) => followLink(linkFromArgv(argv)));
  return true;
}

/**
 * Creates a normal Kite window at a page. The window stays hidden until the page has painted
 * (ready-to-show), so users never see an empty white frame.
 *
 * @param config The Kite URL.
 * @param page   The path to open.
 * @param throttle False for the window that runs a call: its timers must keep their normal speed
 *                 while it is minimised.
 * @param minimized True to open it minimised (v1.3.0: a call started from the home panel's Connect
 *                  card; the window is in the taskbar, out of the way).
 * @returns The new window.
 * Called from: createMainWindow(), openPages()
 */
function createPagesWindow(
  config: DesktopConfig,
  page: string,
  throttle: boolean,
  minimized = false,
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    title: APP_NAME,
    // The company logo mark (UI U4): the title bar and taskbar icon on Windows.
    icon: appIconPath(__dirname),
    show: false,
    backgroundColor: '#f8fafc',
    webPreferences: {
      ...secureWebPreferences(path.join(__dirname, 'preload.js'), app.getVersion()),
      backgroundThrottling: throttle,
    },
  });
  protection?.attach(window);
  // Minimised, it still shows in the taskbar (never hidden: CLAUDE.md).
  window.once('ready-to-show', () => (minimized ? window.minimize() : window.show()));
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    // Log the code only; the URL is known from the configuration.
    console.error('desktop: page failed to load', { errorCode, errorDescription });
  });
  void window.loadURL(new URL(page, config.kiteUrl).toString());
  return window;
}

/**
 * Creates the main window and loads a page.
 *
 * @param config The URL to load.
 * @param page   The path to open (default the dashboard).
 * @param minimized True to open it minimised (v1.3.0, openCallWindow()).
 * @returns The new window.
 * Called from: openPages(), openCallWindow(), start()
 */
function createMainWindow(config: DesktopConfig, page = '/', minimized = false): BrowserWindow {
  // This page runs the call while it is minimised (calls start in the overlay, ADR-0029).
  const window = createPagesWindow(config, page, false, minimized);
  // v1.0.4 (ADR-0040): one call view at a time. Bringing this window back (the taskbar, the Dock, or
  // the overlay's ⋮) hides the overlay, which would otherwise float over it; minimising it brings
  // the overlay back, so the user is never left with neither during a call.
  window.on('restore', () => compact?.window()?.hide());
  window.on('minimize', () => compact?.window()?.showInactive());
  window.on('close', (event) => {
    // v1.1.0: closing this window would end a running call. It steps aside instead: End is on the
    // overlay. A quitting app (an update, or Windows shutting down) still closes it.
    if (callActive && !quitting) {
      event.preventDefault();
      window.minimize();
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    callWindowFromPanel = false;
    // The compact window belongs to the main window's call.
    compact?.close();
    // No page left to receive them: give the keys back to other apps.
    hotkeys?.disable();
    callActive = false;
    // v1.1.0: back to the panel. It has nothing to come back to only when the app is quitting.
    if (!quitting) home?.open();
  });
  // A reload or navigation ends the page's call; the live page turns them on again if needed.
  window.webContents.on('did-navigate', () => hotkeys?.disable());
  return window;
}

/**
 * Brings a window forward with focus.
 *
 * @param window The window.
 * Called from: openPages(), start()
 */
function bringForward(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Opens a Kite page in a normal window (v1.1.0, ADR-0041). With no call running that is the main
 * window. During a call it is the side window, because navigating the main window would end the call.
 *
 * @param config The Kite URL.
 * @param page   The path, already checked against PAGES_WINDOW_PATH.
 * Called from: the OPEN_PAGES_CHANNEL handler in start()
 */
function openPages(config: DesktopConfig, page: string): void {
  const url = new URL(page, config.kiteUrl).toString();
  if (callActive && mainWindow) {
    if (sideWindow && !sideWindow.isDestroyed()) {
      void sideWindow.loadURL(url);
      bringForward(sideWindow);
      return;
    }
    const side = createPagesWindow(config, page, true);
    side.on('closed', () => {
      if (sideWindow === side) sideWindow = null;
    });
    sideWindow = side;
    return;
  }
  // Any page opened this way is shown in front: no longer the panel's background call window.
  callWindowFromPanel = false;
  if (!mainWindow) {
    mainWindow = createMainWindow(config, page);
    return;
  }
  if (mainWindow.webContents.getURL() !== url) void mainWindow.loadURL(url);
  bringForward(mainWindow);
}

/**
 * v1.3.0 (ADR-0055): opens the main window on a session's live page, minimised, for a call started from
 * the home panel's Connect card. The panel stays in front while the call connects; the live page then
 * opens the overlay, and the shell hides the panel. During a call nothing changes (the running call is
 * never navigated away; its page reports that a call is already running).
 *
 * @param config    The Kite URL.
 * @param sessionId The session, already checked to be a UUID.
 * Called from: the OPEN_CALL_WINDOW_CHANNEL handler in start()
 */
function openCallWindow(config: DesktopConfig, sessionId: string): void {
  if (callActive) return;
  const page = `/live/${sessionId}`;
  const url = new URL(page, config.kiteUrl).toString();
  callWindowFromPanel = true;
  if (!mainWindow) {
    mainWindow = createMainWindow(config, page, true);
    return;
  }
  if (mainWindow.webContents.getURL() !== url) void mainWindow.loadURL(url);
  if (!mainWindow.isMinimized()) mainWindow.minimize();
}

/**
 * Starts the app: reads the configuration, turns on the sandbox for every renderer, takes the
 * single-instance lock, applies the security rules and opens the home panel.
 *
 * Called from: the bottom of this file
 */
function start(): void {
  // Before anything that uses the folder: the single-instance lock lives in it, and an upgrade from
  // 1.1.0 must find its sessions, settings and sign-in where they are (spec §2).
  const dataFolder = pinnedDataFolder({
    isPackaged: app.isPackaged,
    hasUserDataDirSwitch: app.commandLine.hasSwitch('user-data-dir'),
    appData: app.getPath('appData'),
  });
  if (dataFolder) app.setPath('userData', dataFolder);

  let config: DesktopConfig;
  try {
    config = loadConfig();
    kiteConfig = config;
  } catch (error) {
    dialog.showErrorBox(APP_NAME, error instanceof Error ? error.message : String(error));
    app.exit(1);
    return;
  }

  // Sandbox every renderer process, even if a window were ever created without the setting.
  app.enableSandbox();
  if (!ensureSingleInstance()) return;

  // v1.3.1 (ADR-0059): the private scheme the bundled speech model is served on. Before 'ready'
  // (Electron's rule). Privileged so the page's and the worker's fetch() can read it after the
  // redirect (secure, fetch, CORS, streamed); nothing navigates to it (security.ts locks navigation).
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MODEL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
    // 1.5.0 (ADR-0068): the player's video. Streamed with byte ranges so it seeks; secure, so an https
    // page may play it. Nothing navigates to it (security.ts locks navigation).
    {
      scheme: RECORDING_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);

  // spec S9: the system opens this app for paramountai:// links. A test run must not change that.
  if (
    shouldRegisterProtocol({
      isPackaged: app.isPackaged,
      hasUserDataDirSwitch: app.commandLine.hasSwitch('user-data-dir'),
    })
  ) {
    app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL);
  }
  // macOS sends a link as an event, possibly before the app is ready.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    followLink(parseDesktopLink(url));
  });

  // Lock every web contents the app ever creates, not only the main window's.
  app.on('web-contents-created', (_event, contents) => {
    lockNavigation(contents, config.allowedOrigin);
  });
  app.on('before-quit', () => {
    quitting = true;
  });

  void app.whenReady().then(() => {
    allowOnlyOurPermissions(session.defaultSession, config.allowedOrigin);
    // v1.3.1 (ADR-0059): the streaming speech model ships in the installer. Its exact addresses are
    // answered from the bundle (checked against SHA-256 first); anything missing or damaged still
    // downloads as before. KITE_BUNDLED_MODEL_DIR points tests at another folder (or none).
    const bundledModel = installBundledModel({
      session: session.defaultSession,
      fetchFile: (url) => net.fetch(url),
      dir:
        process.env.KITE_BUNDLED_MODEL_DIR ??
        (app.isPackaged
          ? path.join(process.resourcesPath, BUNDLED_MODEL_FOLDER)
          : path.join(__dirname, '..', 'native', BUNDLED_MODEL_FOLDER)),
      origin: config.allowedOrigin,
      verifiedFile: path.join(app.getPath('userData'), VERIFIED_FILE),
    });
    // Checked in the background now, so the first Connect does not wait for the hashing (about a
    // second, once per install: a file that passed is remembered).
    void bundledModel
      ?.verifyAll()
      .then((result) => console.info('speech model: bundled files checked', result));
    // "Them": the page's getDisplayMedia gets system audio with no picker (Kite origin only). 1.5.0
    // (ADR-0068): a video-only request (the recording's screen) gets the display picked for recordings.
    allowSystemAudioLoopback(session.defaultSession, config.allowedOrigin, {
      getSources: (options) => desktopCapturer.getSources(options),
      platform: process.platform,
      osVersion: process.getSystemVersion(),
      recordingDisplay: () => recordings?.pickedDisplay() ?? null,
    });
    hotkeys = installHotkeys({
      globalShortcut,
      ipcMain,
      sendToPage: (channel, action) => mainWindow?.webContents.send(channel, action),
      overlayAction: (action) => {
        if (compact) overlayShortcut(compact, action);
      },
      // During a call the overlay opens its chat box, and the main window stays where it is;
      // otherwise the main window opens the Ask Kite page.
      showForAskKite: () => {
        const overlay = compact?.window();
        // v1.0.4: a hidden overlay means the full call window is in front: its message box takes
        // the typing (the page handles the shortcut too), so the overlay stays hidden.
        if (overlay?.isVisible()) {
          overlay.show();
          overlay.focus();
          return;
        }
        if (!mainWindow) {
          mainWindow = createMainWindow(config, '/ask-kite');
          return;
        }
        bringForward(mainWindow);
      },
      // v1.1.0: the Chat shortcut from another app gives the overlay the keyboard, for typing.
      showForChat: () => {
        const overlay = compact?.window();
        if (overlay?.isVisible()) {
          overlay.show();
          overlay.focus();
        }
      },
      allowedOrigin: config.allowedOrigin,
    });
    // The compact live window and screen-share protection (Day 5); the shell remembers the
    // window's position and size and the protection setting in its own small file.
    const store = createStore(path.join(app.getPath('userData'), 'kite-shell.json'));
    const shield = createProtection(store, process.platform, os.release());
    protection = shield;
    // v1.3.0 (ADR-0055): every window, including any created later (by Electron itself or by future
    // code), gets the protection setting as it is created. Owners still attach their own windows too;
    // attaching twice changes nothing. Never hidden from the taskbar or process lists (CLAUDE.md).
    app.on('browser-window-created', (_event, window) => shield.attach(window));
    // Screenshot answers (Day 5): in memory only. During a call: the display under the overlay
    // (v1.1.0: the main window is minimised then, maybe on another display).
    installScreenshot({
      desktopCapturer,
      screen,
      systemPreferences,
      platform: process.platform,
      ipcMain,
      getWindow: () => compact?.window() ?? mainWindow ?? home?.window() ?? null,
      allowedOrigin: config.allowedOrigin,
      // v1.1.0 (ADR-0043): the answer should be about what is behind Kite, not about Kite. With
      // protection on, its windows are already left out, so nothing changes.
      hideOwnWindows: async () => {
        const windows = BrowserWindow.getAllWindows();
        const wanted = shield.state().on;
        if (wanted) return () => undefined;
        for (const window of windows) window.setContentProtection(true);
        await new Promise((resolve) => setTimeout(resolve, PROTECTION_SETTLE_MS));
        return () => {
          for (const window of windows) {
            if (!window.isDestroyed()) window.setContentProtection(false);
          }
        };
      },
    });
    const snap = createSnapZones({
      createWindow: (options) => {
        const window = new BrowserWindow(options);
        shield.attach(window);
        return window;
      },
      screen,
      kiteUrl: config.kiteUrl,
      preloadPath: path.join(__dirname, 'preload.js'),
      appVersion: app.getVersion(),
      platform: process.platform,
      snapTo: (preset) => compact?.snapTo(preset),
    });
    compact = createCompactWindows({
      createWindow: (options) => new BrowserWindow({ ...options, icon: appIconPath(__dirname) }),
      screen,
      kiteUrl: config.kiteUrl,
      preloadPath: path.join(__dirname, 'preload.js'),
      appVersion: app.getVersion(),
      store,
      protection: shield,
      snap,
      // v1.3.1 (ADR-0058): jumps between the six places slide over 150 ms, unless the system asks for
      // reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects off).
      slideJumps: () => !systemPreferences.getAnimationSettings().prefersReducedMotion,
      // The overlay is gone: never leave the user with the main window still minimised.
      onClosed: () => {
        snap.close();
        // v1.3.0 (ADR-0055): a call from the panel's Connect card: the panel comes back instead, and
        // the main window closes itself once the notes are saved.
        if (mainWindow?.isMinimized() && !callWindowFromPanel) mainWindow.restore();
      },
    });
    installCompactWindows(
      ipcMain,
      compact,
      config.allowedOrigin,
      () => mainWindow?.minimize(),
      () => {
        if (!mainWindow) return;
        compact?.window()?.hide();
        bringForward(mainWindow);
      },
    );
    // Accurate transcription (v1.0.1, ADR-0034; opt-in, off by default in the page's Settings):
    // the model downloads to the app's data folder only when the user turns it on; the engine
    // runs in a utility process. KITE_ACCURATE_MODEL_DIR points tests at an existing copy.
    installAccurate({
      ipcMain,
      allowedOrigin: config.allowedOrigin,
      modelDir:
        process.env.KITE_ACCURATE_MODEL_DIR ??
        path.join(app.getPath('userData'), 'models', MODEL_FOLDER),
      // Installed: shipped next to the app (extraResources); development: staged by the build.
      nativeDir: app.isPackaged
        ? path.join(process.resourcesPath, 'sherpa-onnx')
        : path.join(__dirname, '..', 'native', 'sherpa-onnx'),
      workerPath: path.join(__dirname, 'accurate-worker.js'),
      fork: (modulePath, env) => {
        const child = utilityProcess.fork(modulePath, [], {
          env,
          serviceName: `${APP_NAME} accurate transcription`,
          stdio: 'ignore',
        });
        // 1.5.1 (ADR-0069): below-normal priority, so the live speech engine (in the page) always comes
        // first on a busy computer. A failure only leaves the normal priority.
        child.once('spawn', () => {
          try {
            if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
          } catch {
            console.warn('desktop: accurate priority not lowered');
          }
        });
        return child as unknown as WorkerProcess;
      },
    });
    // ADR-0042: one toggle, one state, every window.
    installProtection(ipcMain, shield, () => BrowserWindow.getAllWindows(), config.allowedOrigin);
    // 1.5.0 (ADR-0068): meeting recording. The files go to Documents/Paramount AI/Recordings (or
    // KITE_RECORDINGS_DIR, for tests), never anywhere else; a background process finalises them.
    recordings = installRecordings({
      ipcMain,
      allowedOrigin: config.allowedOrigin,
      session: session.defaultSession,
      folder: () =>
        process.env.KITE_RECORDINGS_DIR ??
        path.join(app.getPath('documents'), APP_NAME, 'Recordings'),
      dataFolder: app.getPath('userData'),
      store,
      forkWorker: () =>
        utilityProcess.fork(path.join(__dirname, 'recording-worker.js'), [], {
          serviceName: `${APP_NAME} recording finaliser`,
          stdio: 'ignore',
        }) as unknown as FinaliseProcess,
      openPlayer,
      dialog,
      shell,
      screen,
      windowOf: (contents) => BrowserWindow.fromWebContents(contents),
    });
    // Recordings a crash or a quit left open are finalised now, in the background process.
    void recordings.manager.recover();
    // 1.6.0 (ADR-0072): Google Drive. The page decides what goes where; the shell sends recording files
    // from its index to Google's upload address only (net.fetch: the system's proxy applies), and
    // stops while a call is live.
    drive = installDrive({
      ipcMain,
      allowedOrigin: config.allowedOrigin,
      recordings: recordings.manager,
      fetch: (url, init) => net.fetch(url, init),
      notices: {
        supported: () => Notification.isSupported(),
        create: (options) => new Notification({ ...options, icon: appIconPath(__dirname) }),
        openExternal: (url) => {
          openInSystemBrowser(url);
        },
      },
    });

    // v1.1.0 (ADR-0041): the panel's own buttons, and the pages it opens. Each value is checked.
    ipcMain.handle(OPEN_PAGES_CHANNEL, (event, page: unknown) => {
      if (!isKiteSender(event, config.allowedOrigin)) {
        throw new Error('Only the Kite page can do this');
      }
      if (typeof page !== 'string' || !PAGES_WINDOW_PATH.test(page)) {
        throw new Error('Not a Kite page');
      }
      openPages(config, page);
    });
    // v1.3.0 (ADR-0055): the Connect card starts a call in the main window; the panel asks for its size.
    ipcMain.handle(OPEN_CALL_WINDOW_CHANNEL, (event, sessionId: unknown) => {
      if (!isKiteSender(event, config.allowedOrigin)) {
        throw new Error('Only the Kite page can do this');
      }
      if (!isSessionId(sessionId)) throw new Error('Not a session');
      openCallWindow(config, sessionId);
    });
    ipcMain.handle(SIZE_PANEL_CHANNEL, (event, size: unknown) => {
      if (!isKiteSender(event, config.allowedOrigin)) {
        throw new Error('Only the Kite page can do this');
      }
      if (!isPanelSize(size)) throw new Error('Not a size');
      // Only the panel may resize itself this way.
      if (BrowserWindow.fromWebContents(event.sender) !== home?.window()) return;
      home?.resize(size);
    });
    ipcMain.handle(WINDOW_CONTROL_CHANNEL, (event, action: unknown) => {
      if (!isKiteSender(event, config.allowedOrigin)) {
        throw new Error('Only the Kite page can do this');
      }
      if (!isWindowControl(action)) throw new Error('Not a window action');
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;
      if (action === 'minimize') {
        window.minimize();
        return;
      }
      // The panel's close button: it quits when nothing else is open. With the main window open it
      // only steps aside, and that window's close brings it back.
      if (window === home?.window() && mainWindow) window.hide();
      else window.close();
    });
    // v1.1.0: a call hides the panel, and the end of a call brings it back behind the call's review.
    ipcMain.on(CALL_ACTIVE_CHANNEL, (event, active: unknown) => {
      if (!isKiteSender(event, config.allowedOrigin)) return;
      const next = active === true;
      if (next === callActive) return;
      callActive = next;
      // 1.6.0 (ADR-0072): a call stops every Drive upload at once; the page resumes them afterwards.
      drive?.setCallActive(next);
      if (next) home?.hide();
      else home?.showInactive();
    });

    home = createHomeWindow({
      createWindow: (options) => {
        const window = new BrowserWindow({ ...options, icon: appIconPath(__dirname) });
        shield.attach(window);
        return window;
      },
      screen,
      kiteUrl: config.kiteUrl,
      preloadPath: path.join(__dirname, 'preload.js'),
      appVersion: app.getVersion(),
      store,
      // A rolled-back web app has no /home: behave as a 1.0.x shell does.
      onUnavailable: () => {
        mainWindow ??= createMainWindow(config);
      },
    });
    // A first start may come from a paramountai:// link (on Windows, an argument).
    const firstLink = earlyLink ?? linkFromArgv(process.argv);
    earlyLink = null;
    if (firstLink?.kind === 'session') home.openSession(firstLink.sessionId, firstLink.code);
    else home.open();
    // 1.5.0 (ADR-0068): a first start from a recording link also opens the player, beside the panel.
    if (firstLink?.kind === 'recording') openPlayer(`/player/${firstLink.recordingId}`);

    // v1.3.0 (ADR-0052): a link's one-time sign-in code goes to the Kite page once, and only from the
    // shell's memory: it is never put in an address. (1.2.0's session file hand-off is gone.)
    ipcMain.handle(LINK_CODE_CHANNEL, (event) => {
      if (!isKiteSender(event, config.allowedOrigin)) return null;
      return home?.takeLinkCode() ?? null;
    });

    // Updates (Day 6, ADR-0028): installed builds only; tests turn them off. Store builds
    // (process.windowsStore) are updated by the Microsoft Store, which forbids self-updating.
    if (app.isPackaged && !process.windowsStore && process.env.KITE_NO_UPDATE_CHECK !== '1') {
      startUpdater({
        ipcMain,
        allowedOrigin: config.allowedOrigin,
        getWindow: () => mainWindow ?? home?.window() ?? null,
      });
    }
    // macOS convention: clicking the Dock icon re-opens a window if none is open.
    app.on('activate', showFront);
  });

  // Global shortcuts must be released before the app exits (Electron docs). 1.5.0: open recordings
  // are closed with what they hold; the next start finalises them.
  app.on('will-quit', () => {
    hotkeys?.releaseAll();
    recordings?.manager.closeAllNow();
  });

  // Quit when the window is closed, except on macOS, where apps stay in the Dock.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

start();
