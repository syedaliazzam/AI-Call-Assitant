/**
 * File: apps/desktop/src/main.ts
 * Purpose: Electron main process: starts one instance of the app, opens the home panel on KITE_URL
 *          (v1.1.0, ADR-0041), applies every security rule from src/security.ts, and wires the global
 *          shortcuts (src/hotkeys.ts, Day 4), screenshots (src/screenshot.ts), the compact live window
 *          (src/windows.ts) and screen-share protection on every window (src/protection.ts, ADR-0042).
 * Used by: Electron (package.json "main": dist/main.js, built by esbuild)
 * Depends on: electron, src/config.ts, src/security.ts, src/media.ts, src/hotkeys.ts,
 *             src/screenshot.ts, src/windows.ts, src/snapZones.ts, src/home.ts, src/protection.ts,
 *             src/store.ts, src/icon.ts, src/accurate/host.ts (accurate transcription, ADR-0034)
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
import { PAGES_WINDOW_PATH, type WindowControlAction } from '@kite/shared';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  session,
  systemPreferences,
  utilityProcess,
} from 'electron';
import { installAccurate, type WorkerProcess } from './accurate/host';
import { MODEL_FOLDER } from './accurate/model';
import { CALL_ACTIVE_CHANNEL, OPEN_PAGES_CHANNEL, WINDOW_CONTROL_CHANNEL } from './channels';
import { APP_NAME, loadConfig, pinnedDataFolder, type DesktopConfig } from './config';
import { createHomeWindow, type HomeWindow } from './home';
import { startUpdater } from './updater';
import { installHotkeys, isKiteSender, type HotkeyController } from './hotkeys';
import { appIconPath } from './icon';
import { createProtection, installProtection, type Protection } from './protection';
import { installScreenshot } from './screenshot';
import { createSnapZones } from './snapZones';
import { createStore } from './store';
import {
  createCompactWindows,
  installCompactWindows,
  overlayShortcut,
  type CompactWindows,
} from './windows';
import { allowSystemAudioLoopback } from './media';
import { allowOnlyOurPermissions, lockNavigation, secureWebPreferences } from './security';

/** The main window, or null before it is first needed and after it closes. */
let mainWindow: BrowserWindow | null = null;

/** The side window for pages opened during a call (v1.1.0), or null. */
let sideWindow: BrowserWindow | null = null;

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
 * Makes sure only one copy of Kite runs. A second launch brings up the running copy instead of
 * opening another one (two copies would compete for the microphone and hotkeys).
 *
 * @returns True if this is the first instance; false if it is quitting in favour of another.
 * Called from: start()
 */
function ensureSingleInstance(): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', showFront);
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
 * @returns The new window.
 * Called from: createMainWindow(), openPages()
 */
function createPagesWindow(config: DesktopConfig, page: string, throttle: boolean): BrowserWindow {
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
  window.once('ready-to-show', () => window.show());
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
 * @returns The new window.
 * Called from: openPages(), start()
 */
function createMainWindow(config: DesktopConfig, page = '/'): BrowserWindow {
  // This page runs the call while it is minimised (calls start in the overlay, ADR-0029).
  const window = createPagesWindow(config, page, false);
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
  if (!mainWindow) {
    mainWindow = createMainWindow(config, page);
    return;
  }
  if (mainWindow.webContents.getURL() !== url) void mainWindow.loadURL(url);
  bringForward(mainWindow);
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
  } catch (error) {
    dialog.showErrorBox(APP_NAME, error instanceof Error ? error.message : String(error));
    app.exit(1);
    return;
  }

  // Sandbox every renderer process, even if a window were ever created without the setting.
  app.enableSandbox();
  if (!ensureSingleInstance()) return;

  // Lock every web contents the app ever creates, not only the main window's.
  app.on('web-contents-created', (_event, contents) => {
    lockNavigation(contents, config.allowedOrigin);
  });
  app.on('before-quit', () => {
    quitting = true;
  });

  void app.whenReady().then(() => {
    allowOnlyOurPermissions(session.defaultSession, config.allowedOrigin);
    // "Them": the page's getDisplayMedia gets system audio with no picker (Kite origin only).
    allowSystemAudioLoopback(session.defaultSession, config.allowedOrigin);
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
      // The overlay is gone: never leave the user with the main window still minimised.
      onClosed: () => {
        snap.close();
        if (mainWindow?.isMinimized()) mainWindow.restore();
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
      fork: (modulePath, env) =>
        utilityProcess.fork(modulePath, [], {
          env,
          serviceName: `${APP_NAME} accurate transcription`,
          stdio: 'ignore',
        }) as unknown as WorkerProcess,
    });
    // ADR-0042: one toggle, one state, every window.
    installProtection(ipcMain, shield, () => BrowserWindow.getAllWindows(), config.allowedOrigin);

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
    home.open();

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

  // Global shortcuts must be released before the app exits (Electron docs).
  app.on('will-quit', () => hotkeys?.releaseAll());

  // Quit when the window is closed, except on macOS, where apps stay in the Dock.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

start();
