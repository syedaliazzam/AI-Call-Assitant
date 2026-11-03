/**
 * File: apps/desktop/src/main.ts
 * Purpose: Electron main process: starts one instance of the app, opens the Kite window on
 *          KITE_URL, applies every security rule from src/security.ts, and wires the global
 *          shortcuts (src/hotkeys.ts, Day 4) screenshots (src/screenshot.ts), the compact live window
 *          (src/windows.ts) and its screen-share protection (src/protection.ts), Day 5.
 * Used by: Electron (package.json "main": dist/main.js, built by esbuild)
 * Depends on: electron, src/config.ts, src/security.ts, src/media.ts, src/hotkeys.ts,
 *             src/screenshot.ts, src/windows.ts, src/protection.ts, src/store.ts, src/icon.ts,
 *             src/accurate/host.ts (accurate transcription, ADR-0034)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (main.ts), §8.3
 *
 * Kite never hides from the taskbar, Dock or process lists, and does not try to evade
 * monitoring or proctoring software (CLAUDE.md).
 */
import os from 'node:os';
import path from 'node:path';
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
import { APP_NAME, loadConfig, type DesktopConfig } from './config';
import { startUpdater } from './updater';
import { installHotkeys, type HotkeyController } from './hotkeys';
import { appIconPath } from './icon';
import { createProtection, installProtection } from './protection';
import { installScreenshot } from './screenshot';
import { createStore } from './store';
import {
  createCompactWindows,
  installCompactWindows,
  overlayShortcut,
  type CompactWindows,
} from './windows';
import { allowSystemAudioLoopback } from './media';
import { allowOnlyOurPermissions, lockNavigation, secureWebPreferences } from './security';

/** The single Kite window, or null before it exists / after it closes. */
let mainWindow: BrowserWindow | null = null;

/** The compact live window (created when the app is ready). */
let compact: CompactWindows | null = null;

/** The global shortcuts (created when the app is ready). */
let hotkeys: HotkeyController | null = null;

/**
 * Makes sure only one copy of Kite runs. A second launch focuses the existing window instead
 * of opening another one (two windows would compete for the microphone and hotkeys).
 *
 * @returns True if this is the first instance; false if it is quitting in favour of another.
 * Called from: start()
 */
function ensureSingleInstance(): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  return true;
}

/**
 * Creates the Kite window and loads the web app. The window stays hidden until the page has
 * painted (ready-to-show), so users never see an empty white frame.
 *
 * @param config The URL to load.
 * @returns The new window.
 * Called from: start() (on ready, and on macOS 'activate' when no window is open)
 */
function createMainWindow(config: DesktopConfig): BrowserWindow {
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
      // This page runs the call while it is minimised (calls start in the overlay, ADR-0029):
      // its timers must keep their normal speed.
      backgroundThrottling: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  // v1.0.4 (ADR-0040): one call view at a time. Bringing this window back (the taskbar, the Dock, or
  // the overlay's ⛶) hides the overlay, which would otherwise float over it; minimising it brings
  // the overlay back, so the user is never left with neither during a call.
  window.on('restore', () => compact?.window()?.hide());
  window.on('minimize', () => compact?.window()?.showInactive());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    // The compact window belongs to the main window's call.
    compact?.close();
    // No page left to receive them: give the keys back to other apps.
    hotkeys?.disable();
  });
  // A reload or navigation ends the page's call; the live page turns them on again if needed.
  window.webContents.on('did-navigate', () => hotkeys?.disable());
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    // Log the code only; the URL is known from the configuration.
    console.error('desktop: page failed to load', { errorCode, errorDescription });
  });
  void window.loadURL(config.kiteUrl);
  return window;
}

/**
 * Starts the app: reads the configuration, turns on the sandbox for every renderer, takes the
 * single-instance lock, applies the security rules and opens the window.
 *
 * Called from: the bottom of this file
 */
function start(): void {
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
          mainWindow = createMainWindow(config);
          return;
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      },
      allowedOrigin: config.allowedOrigin,
    });
    // Screenshot answers (Day 5): the display under the Kite window, scaled, in memory only.
    installScreenshot({
      desktopCapturer,
      screen,
      systemPreferences,
      platform: process.platform,
      ipcMain,
      getWindow: () => mainWindow,
      allowedOrigin: config.allowedOrigin,
    });
    // The compact live window and its screen-share protection (Day 5); the shell remembers
    // the window's position and size and the protection setting in its own small file.
    const store = createStore(path.join(app.getPath('userData'), 'kite-shell.json'));
    const protection = createProtection(store, process.platform, os.release());
    compact = createCompactWindows({
      createWindow: (options) => new BrowserWindow({ ...options, icon: appIconPath(__dirname) }),
      screen,
      kiteUrl: config.kiteUrl,
      preloadPath: path.join(__dirname, 'preload.js'),
      appVersion: app.getVersion(),
      store,
      protection,
      // The overlay is gone: never leave the user with the main window still minimised.
      onClosed: () => {
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
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
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
          serviceName: 'Kite accurate transcription',
          stdio: 'ignore',
        }) as unknown as WorkerProcess,
    });
    installProtection(ipcMain, protection, () => compact?.window() ?? null, config.allowedOrigin);
    mainWindow = createMainWindow(config);
    // Updates (Day 6, ADR-0028): installed builds only; tests turn them off. Store builds
    // (process.windowsStore) are updated by the Microsoft Store, which forbids self-updating.
    if (app.isPackaged && !process.windowsStore && process.env.KITE_NO_UPDATE_CHECK !== '1') {
      startUpdater({
        ipcMain,
        allowedOrigin: config.allowedOrigin,
        getWindow: () => mainWindow,
      });
    }
    // macOS convention: clicking the Dock icon re-opens a window if none is open.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(config);
    });
  });

  // Global shortcuts must be released before the app exits (Electron docs).
  app.on('will-quit', () => hotkeys?.releaseAll());

  // Quit when the window is closed, except on macOS, where apps stay in the Dock.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

start();
