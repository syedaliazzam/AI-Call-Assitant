/**
 * File: apps/desktop/src/main.ts
 * Purpose: Electron main process: starts one instance of the app, opens the Kite window on
 *          KITE_URL and applies every security rule from src/security.ts.
 * Used by: Electron (package.json "main": dist/main.js, built by esbuild)
 * Depends on: electron, src/config.ts, src/security.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (main.ts), §8.3
 *
 * Kite never hides from the taskbar, Dock or process lists, and does not try to evade
 * monitoring or proctoring software (CLAUDE.md).
 */
import path from 'node:path';
import { app, BrowserWindow, dialog, session } from 'electron';
import { APP_NAME, loadConfig, type DesktopConfig } from './config';
import { allowOnlyOurPermissions, lockNavigation, secureWebPreferences } from './security';

/** The single Kite window, or null before it exists / after it closes. */
let mainWindow: BrowserWindow | null = null;

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
    show: false,
    backgroundColor: '#f8fafc',
    webPreferences: secureWebPreferences(path.join(__dirname, 'preload.js'), app.getVersion()),
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
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
    mainWindow = createMainWindow(config);
    // macOS convention: clicking the Dock icon re-opens a window if none is open.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(config);
    });
  });

  // Quit when the window is closed, except on macOS, where apps stay in the Dock.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

start();
