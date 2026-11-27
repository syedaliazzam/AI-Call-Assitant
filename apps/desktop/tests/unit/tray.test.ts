/**
 * Tests for apps/desktop/src/tray.ts (desktop 1.7.2, ADR-0106): the tray menu has Open and Quit, plus the
 * progress line while Drive work is left; after an exit it offers "Quit now" instead of Quit; the tooltip
 * carries the progress; the icon's file is the .ico on Windows and the PNG elsewhere, from resources/tray
 * in an installed app; the menu's items run the right actions and the menu is rebuilt only on a change.
 * ADR-0055 (amended 26 Nov 2026): during a call the menu starts with "Turn click-through off", which runs its
 * action; the item goes when the call ends. Windows 1.7.5: "Check for Updates…" (only when the app updates itself,
 * and not after an exit) runs its action.
 */
import path from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  installTray,
  MENU_BAR_ICON_POINTS,
  menuBarImage,
  trayIconFile,
  trayItems,
  trayTooltip,
} from '../../src/tray';

describe('trayItems and trayTooltip', () => {
  it('offers Open and Quit while the app runs as usual', () => {
    expect(trayItems({ background: false, status: null })).toEqual([
      { label: 'Open Paramount AI', action: 'open' },
      { label: 'Quit Paramount AI', action: 'quit' },
    ]);
    expect(trayTooltip({ background: false, status: null })).toBe('Paramount AI');
  });

  it('shows the progress, and "Quit now" after an exit', () => {
    const view = { background: true, status: 'Uploading 1 recording to Drive: 42%' };
    expect(trayItems(view)).toEqual([
      { label: 'Uploading 1 recording to Drive: 42%' },
      { separator: true },
      { label: 'Open Paramount AI', action: 'open' },
      { label: 'Quit now', action: 'quit-now' },
    ]);
    expect(trayTooltip(view)).toBe('Paramount AI: Uploading 1 recording to Drive: 42%');
  });

  it('ADR-0055 (amended 26 Nov 2026): offers "Turn click-through off" first during a call only', () => {
    expect(trayItems({ background: false, status: null }, true)).toEqual([
      { label: 'Turn click-through off', action: 'click-through-off' },
      { separator: true },
      { label: 'Open Paramount AI', action: 'open' },
      { label: 'Quit Paramount AI', action: 'quit' },
    ]);
    expect(trayItems({ background: false, status: null }, false)).not.toContainEqual(
      expect.objectContaining({ action: 'click-through-off' }),
    );
  });
});

describe('Check for Updates… in the tray (Windows 1.7.5)', () => {
  it('shows only for an app that updates itself, under Open, and not after an exit', () => {
    expect(trayItems({ background: false, status: null }, false, true)).toEqual([
      { label: 'Open Paramount AI', action: 'open' },
      { label: 'Check for Updates…', action: 'check-updates' },
      { label: 'Quit Paramount AI', action: 'quit' },
    ]);
    expect(trayItems({ background: true, status: null }, false, true)).not.toContainEqual(
      expect.objectContaining({ action: 'check-updates' }),
    );
    // During a call too, under "Turn click-through off".
    expect(
      trayItems({ background: false, status: null }, true, true).map((item) => item.action),
    ).toEqual(['click-through-off', undefined, 'open', 'check-updates', 'quit']);
  });

  it('runs the check from the menu', () => {
    const menus: MenuItemConstructorOptions[][] = [];
    const checked = vi.fn();
    installTray(
      {
        createTray: () =>
          ({
            setToolTip: () => undefined,
            setContextMenu: () => undefined,
            on: () => undefined,
            destroy: () => undefined,
          }) as never,
        buildMenu: (template) => {
          menus.push(template);
          return null as never;
        },
        image: {} as never,
        onOpen: vi.fn(),
        onQuit: vi.fn(),
        onQuitNow: vi.fn(),
        onClickThroughOff: vi.fn(),
        onCheckForUpdates: checked,
      },
      { background: false, status: null },
    );
    const item = menus[0]!.find((one) => one.label === 'Check for Updates…')!;
    (item.click as () => void)();
    expect(checked).toHaveBeenCalledOnce();
  });
});

describe('trayIconFile', () => {
  it('uses resources/tray when installed and build/ in development', () => {
    expect(
      trayIconFile({ isPackaged: true, resourcesPath: 'R', baseDir: 'D', platform: 'win32' }),
    ).toBe(path.join('R', 'tray', 'icon.ico'));
    expect(
      trayIconFile({ isPackaged: true, resourcesPath: 'R', baseDir: 'D', platform: 'darwin' }),
    ).toBe(path.join('R', 'tray', 'icon.png'));
    expect(
      trayIconFile({ isPackaged: false, resourcesPath: 'R', baseDir: 'D', platform: 'win32' }),
    ).toBe(path.join('D', '..', 'build', 'icon.ico'));
  });
});

describe('installTray', () => {
  it('runs each item, opens on a click, and rebuilds the menu only when it changes', () => {
    const ran: string[] = [];
    const menus: MenuItemConstructorOptions[][] = [];
    const tips: string[] = [];
    let click: (() => void) | null = null;
    const tray = installTray(
      {
        createTray: () =>
          ({
            setToolTip: (tip: string) => tips.push(tip),
            setContextMenu: () => undefined,
            on: (event: string, listener: () => void) => {
              if (event === 'click') click = listener;
            },
            destroy: () => undefined,
          }) as never,
        buildMenu: (template) => {
          menus.push(template);
          return null as never;
        },
        image: {} as never,
        onOpen: () => ran.push('open'),
        onQuit: () => ran.push('quit'),
        onQuitNow: () => ran.push('quit-now'),
        onClickThroughOff: () => ran.push('click-through-off'),
      },
      { background: false, status: null },
    );
    click!();
    (menus[0]![1]!.click as () => void)();
    tray.update({ background: false, status: null });
    expect(menus).toHaveLength(1);
    tray.update({ background: true, status: 'Uploading 1 recording to Drive: 10%' });
    expect(menus).toHaveLength(2);
    expect(menus[1]![0]).toEqual({ label: 'Uploading 1 recording to Drive: 10%', enabled: false });
    (menus[1]![3]!.click as () => void)();
    expect(ran).toEqual(['open', 'quit', 'quit-now']);
    expect(tips.at(-1)).toBe('Paramount AI: Uploading 1 recording to Drive: 10%');
    // ADR-0055 (amended 26 Nov 2026): a call adds "Turn click-through off" on top; its end takes it away.
    tray.setCall(true);
    expect(menus).toHaveLength(3);
    expect(menus[2]![0]!.label).toBe('Turn click-through off');
    (menus[2]![0]!.click as () => void)();
    expect(ran.at(-1)).toBe('click-through-off');
    tray.setCall(true);
    expect(menus).toHaveLength(3);
    tray.setCall(false);
    expect(menus).toHaveLength(4);
    expect(menus[3]!.map((item) => item.label)).not.toContain('Turn click-through off');
  });
});

describe('menuBarImage (ADR-0111)', () => {
  it('holds the logo at 18 px and at 36 px (Retina), from the best scaling', () => {
    const sizes: number[] = [];
    const source = {
      resize: vi.fn((options: { width?: number; height?: number }) => {
        sizes.push(options.width ?? 0);
        return { toPNG: () => Buffer.from(`png-${options.width}`) } as never;
      }),
    };
    const added: { scaleFactor: number; buffer?: Buffer }[] = [];
    const image = { addRepresentation: vi.fn((rep: (typeof added)[number]) => added.push(rep)) };
    expect(menuBarImage(source, () => image)).toBe(image);
    expect(sizes).toEqual([MENU_BAR_ICON_POINTS, MENU_BAR_ICON_POINTS * 2]);
    expect(added.map((rep) => rep.scaleFactor)).toEqual([1, 2]);
    expect(added.map((rep) => rep.buffer?.toString())).toEqual(['png-18', 'png-36']);
    expect(source.resize).toHaveBeenCalledWith({ width: 36, height: 36, quality: 'best' });
  });
});
