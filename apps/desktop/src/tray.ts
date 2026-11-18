/**
 * File: apps/desktop/src/tray.ts
 * Purpose: The app's tray icon (Windows notification area, macOS menu bar; desktop 1.7.2, ADR-0106). It is
 *          always there while the app runs: "Open Paramount AI" and "Quit Paramount AI". While Drive work is
 *          left it also shows the progress ("Uploading 1 recording to Drive: 42%"); after the user exits
 *          with work left it stays as the app's visible sign, with the progress, "Open Paramount AI" and
 *          "Quit now". The app is never hidden from the tray, the taskbar, the Dock or the process list
 *          (CLAUDE.md).
 * Used by: src/main.ts; tests/unit/tray.test.ts
 * Depends on: electron (types only), src/drive/background.ts (BackgroundView), src/config.ts (APP_NAME)
 * Architecture: docs/decisions/ADR-0106-background-upload-on-exit.md
 */
import path from 'node:path';
import type { MenuItemConstructorOptions, NativeImage, Tray } from 'electron';
import { APP_NAME } from './config';
import type { BackgroundView } from './drive/background';

/** What a tray menu item does. */
export type TrayAction = 'open' | 'quit' | 'quit-now';

/** One line of the tray menu, before it becomes an Electron menu item. */
export interface TrayItem {
  /** The words, or absent for a separator. */
  label?: string;
  /** What choosing it does; absent for a line that only shows the progress. */
  action?: TrayAction;
  /** True for a separator. */
  separator?: boolean;
}

/**
 * The tray menu for a state.
 *
 * @param view The state (background or not, and the progress line).
 * @returns The menu's lines, top first.
 * Called from: installTray() update(); tests
 */
export function trayItems(view: BackgroundView): TrayItem[] {
  const items: TrayItem[] = [];
  if (view.status) items.push({ label: view.status }, { separator: true });
  items.push({ label: `Open ${APP_NAME}`, action: 'open' });
  items.push(
    view.background
      ? { label: 'Quit now', action: 'quit-now' }
      : { label: `Quit ${APP_NAME}`, action: 'quit' },
  );
  return items;
}

/**
 * The tray icon's tooltip.
 *
 * @param view The state.
 * @returns "Paramount AI", or "Paramount AI: Uploading 1 recording to Drive: 42%".
 * Called from: installTray() update(); tests
 */
export function trayTooltip(view: BackgroundView): string {
  return view.status ? `${APP_NAME}: ${view.status}` : APP_NAME;
}

/**
 * The tray icon's file: the .ico on Windows (it holds every size), the PNG elsewhere. An installed app
 * has them in resources/tray (electron-builder.yml extraResources); a development run uses build/.
 *
 * @param options.isPackaged    True for an installed app.
 * @param options.resourcesPath process.resourcesPath.
 * @param options.baseDir       The folder holding main.js (dist/).
 * @param options.platform      process.platform.
 * @returns The file's path.
 * Called from: start() in main.ts; tests
 */
export function trayIconFile(options: {
  /** True for an installed app. */
  isPackaged: boolean;
  /** process.resourcesPath. */
  resourcesPath: string;
  /** The folder holding main.js. */
  baseDir: string;
  /** process.platform. */
  platform: NodeJS.Platform;
}): string {
  const name = options.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return options.isPackaged
    ? path.join(options.resourcesPath, 'tray', name)
    : path.join(options.baseDir, '..', 'build', name);
}

/** What installTray() needs (Electron's Tray, Menu and nativeImage in the app; fakes in tests). */
export interface TrayDeps {
  /**
   * Makes the tray icon.
   * @param image Its picture.
   */
  createTray(image: NativeImage): Pick<Tray, 'setToolTip' | 'setContextMenu' | 'on' | 'destroy'>;
  /**
   * Builds a menu from a template.
   * @param template The items.
   */
  buildMenu(template: MenuItemConstructorOptions[]): Parameters<Tray['setContextMenu']>[0];
  /** The icon's picture. */
  image: NativeImage;
  /** "Open Paramount AI", and a click on the icon (Windows). */
  onOpen(): void;
  /** "Quit Paramount AI". */
  onQuit(): void;
  /** "Quit now" (in the background). */
  onQuitNow(): void;
}

/** The installed tray. */
export interface AppTray {
  /**
   * Shows a new state.
   * @param view The state.
   */
  update(view: BackgroundView): void;
}

/**
 * Creates the tray icon.
 *
 * @param deps See TrayDeps.
 * @param view The first state.
 * @returns The tray.
 * Called from: start() in main.ts; tests
 */
export function installTray(deps: TrayDeps, view: BackgroundView): AppTray {
  const tray = deps.createTray(deps.image);
  const run: Record<TrayAction, () => void> = {
    open: deps.onOpen,
    quit: deps.onQuit,
    'quit-now': deps.onQuitNow,
  };
  // Windows: a click on the icon opens the app (the menu is on a right-click). macOS shows the menu.
  tray.on('click', () => deps.onOpen());
  let shown = '';
  const update = (next: BackgroundView) => {
    // The menu is rebuilt only when it changes (reports come often while uploading).
    const key = JSON.stringify(next);
    if (key === shown) return;
    shown = key;
    tray.setToolTip(trayTooltip(next));
    tray.setContextMenu(
      deps.buildMenu(
        trayItems(next).map((item): MenuItemConstructorOptions => {
          if (item.separator) return { type: 'separator' };
          const action = item.action;
          return action
            ? { label: item.label!, click: () => run[action]() }
            : { label: item.label!, enabled: false };
        }),
      ),
    );
  };
  update(view);
  return { update };
}
