/**
 * File: apps/desktop/src/tray.ts
 * Purpose: The app's tray icon (Windows notification area, macOS menu bar; desktop 1.7.2, ADR-0106). It is
 *          always there while the app runs: "Open Paramount AI" and "Quit Paramount AI". While Drive work is
 *          left it also shows the progress ("Uploading 1 recording to Drive: 42%"); after the user exits
 *          with work left it stays as the app's visible sign, with the progress, "Open Paramount AI" and
 *          "Quit now". The app is never hidden from the tray, the taskbar, the Dock or the process list
 *          (CLAUDE.md). ADR-0055 (amended 26 Nov 2026; desktop 1.8.0 on a Mac, the next Windows release): during a
 *          call it also offers "Turn click-through off", since the whole overlay passes clicks while it is on.
 *          Windows 1.7.5 (first Windows release with that item): also "Check for Updates…".
 * Used by: src/main.ts; tests/unit/tray.test.ts
 * Depends on: electron (types only), src/drive/background.ts (BackgroundView), src/config.ts (APP_NAME)
 * Architecture: docs/decisions/ADR-0106-background-upload-on-exit.md
 */
import path from 'node:path';
import type { MenuItemConstructorOptions, NativeImage, Tray } from 'electron';
import { APP_NAME } from './config';
import type { BackgroundView } from './drive/background';

/** What a tray menu item does. */
export type TrayAction = 'open' | 'quit' | 'quit-now' | 'click-through-off' | 'check-updates';

/** ADR-0055 (amended 26 Nov 2026): the tray's way to turn the overlay's Click-through off during a call. */
export const CLICK_THROUGH_OFF_LABEL = 'Turn click-through off';

/** Windows 1.7.5: the tray's way to check for a new version now (the Mac has it in the app menu). */
export const CHECK_UPDATES_LABEL = 'Check for Updates…';

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
 * @param call ADR-0055 (amended 26 Nov 2026): true while a call is on (its shortcuts are held): the menu then
 *             starts with "Turn click-through off".
 * @param updates Windows 1.7.5: true when this app updates itself: the menu offers "Check for Updates…" (not
 *                after an exit, when the app only finishes its uploads).
 * @returns The menu's lines, top first.
 * Called from: installTray() update(); tests
 */
export function trayItems(view: BackgroundView, call = false, updates = false): TrayItem[] {
  const items: TrayItem[] = [];
  if (call)
    items.push(
      { label: CLICK_THROUGH_OFF_LABEL, action: 'click-through-off' },
      { separator: true },
    );
  if (view.status) items.push({ label: view.status }, { separator: true });
  items.push({ label: `Open ${APP_NAME}`, action: 'open' });
  if (updates && !view.background)
    items.push({ label: CHECK_UPDATES_LABEL, action: 'check-updates' });
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

/** The macOS menu bar's icon size, in points (Apple's guidance: about 18 pt; 36 px on a Retina screen). */
export const MENU_BAR_ICON_POINTS = 18;

/**
 * 1.8.0 (ADR-0111): the menu bar's picture on a Mac, sharp on Retina screens: the logo at 18 px for a normal
 * screen and 36 px for a Retina one, in one image (a single 18 px picture was drawn blurry at 2×). The logo
 * keeps its colours (a monochrome "template" picture needs the designer's artwork; listed in ADR-0111).
 *
 * @param source The logo (build/icon.png, 256 px).
 * @param empty  Makes an empty image to add the two sizes to (nativeImage.createEmpty in the app).
 * @returns The picture for the menu bar.
 * Called from: start() in main.ts (macOS); tests
 */
export function menuBarImage<T extends Pick<NativeImage, 'addRepresentation'>>(
  source: Pick<NativeImage, 'resize'>,
  empty: () => T,
): T {
  const image = empty();
  for (const scaleFactor of [1, 2]) {
    const side = MENU_BAR_ICON_POINTS * scaleFactor;
    image.addRepresentation({
      scaleFactor,
      buffer: source.resize({ width: side, height: side, quality: 'best' }).toPNG(),
    });
  }
  return image;
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
  /** ADR-0055 (amended 26 Nov 2026): "Turn click-through off" (during a call). */
  onClickThroughOff(): void;
  /**
   * Windows 1.7.5: "Check for Updates…". Absent: the menu has no such item (the Mac has it in the app menu).
   */
  onCheckForUpdates?: (() => void) | undefined;
}

/** The installed tray. */
export interface AppTray {
  /**
   * Shows a new state.
   * @param view The state.
   */
  update(view: BackgroundView): void;
  /**
   * ADR-0055 (amended 26 Nov 2026): a call started or ended ("Turn click-through off" shows only during one).
   * @param on True while a call is on.
   */
  setCall(on: boolean): void;
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
    'click-through-off': deps.onClickThroughOff,
    'check-updates': () => deps.onCheckForUpdates?.(),
  };
  // Windows: a click on the icon opens the app (the menu is on a right-click). macOS shows the menu.
  tray.on('click', () => deps.onOpen());
  let shown = '';
  let last = view;
  let call = false;
  const update = (next: BackgroundView) => {
    last = next;
    // The menu is rebuilt only when it changes (reports come often while uploading).
    const key = JSON.stringify({ next, call });
    if (key === shown) return;
    shown = key;
    tray.setToolTip(trayTooltip(next));
    tray.setContextMenu(
      deps.buildMenu(
        trayItems(next, call, deps.onCheckForUpdates !== undefined).map(
          (item): MenuItemConstructorOptions => {
            if (item.separator) return { type: 'separator' };
            const action = item.action;
            return action
              ? { label: item.label!, click: () => run[action]() }
              : { label: item.label!, enabled: false };
          },
        ),
      ),
    );
  };
  update(view);
  return {
    update,
    setCall(on) {
      call = on;
      update(last);
    },
  };
}
