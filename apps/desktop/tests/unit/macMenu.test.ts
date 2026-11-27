/**
 * Tests for apps/desktop/src/macMenu.ts (desktop 1.8.0, ADR-0111, ADR-0120): the Mac application menu keeps
 * About, Hide, Hide Others, Show All, Quit, the Edit menu (copy and paste in text boxes), full screen, and the
 * Window menu's Zoom and Bring All to Front; it has no reload, force reload, developer tools, close window or
 * minimise, whose shortcuts would reach the frameless overlay on a Mac, and (ADR-0120) no page zoom, whose
 * ⌘0 / ⌘+ / ⌘− were Chromium's own zoom and made the overlay's panels stack; a page Chromium zoomed is put
 * back to 100 % when it loads (resetPageZoomOnLoad). Mac 1.8.1: "Check for Updates…" sits under About, has no
 * shortcut, and runs the check.
 */
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { macMenuTemplate, resetPageZoomOnLoad } from '../../src/macMenu';

/**
 * Every role in a menu template, submenus included.
 *
 * @param items The template.
 * @returns The roles.
 */
function roles(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : []),
  ]);
}

/**
 * Every accelerator in a menu template, submenus included.
 *
 * @param items The template.
 * @returns The accelerators set on items.
 */
function accelerators(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.accelerator ? [String(item.accelerator)] : []),
    ...(Array.isArray(item.submenu) ? accelerators(item.submenu) : []),
  ]);
}

describe('Check for Updates… (Mac 1.8.1)', () => {
  it('sits under About with no shortcut, and runs the check', () => {
    const check = vi.fn();
    const items = macMenuTemplate('Paramount AI', check)[0]!
      .submenu as MenuItemConstructorOptions[];
    expect(items[0]!.role).toBe('about');
    expect(items[1]!.label).toBe('Check for Updates…');
    expect(items[1]!.accelerator).toBeUndefined();
    (items[1]!.click as () => void)();
    expect(check).toHaveBeenCalledOnce();
    // Without a check (tests, a build that does not update itself) there is no item.
    const plain = macMenuTemplate('Paramount AI')[0]!.submenu as MenuItemConstructorOptions[];
    expect(plain.map((item) => item.label)).not.toContain('Check for Updates…');
  });
});

describe('macMenuTemplate', () => {
  const template = macMenuTemplate('Paramount AI');

  it('names the first menu after the app and keeps what a Mac app needs', () => {
    expect(template[0]?.label).toBe('Paramount AI');
    expect(roles(template)).toEqual(
      expect.arrayContaining([
        'about',
        'hide',
        'hideOthers',
        'unhide',
        'quit',
        'editMenu',
        'togglefullscreen',
        'zoom',
        'front',
      ]),
    );
  });

  it('has nothing whose shortcut could reload a call, close or minimise the overlay, or open developer tools', () => {
    const all = roles(template).map((role) => role.toLowerCase());
    for (const role of [
      'reload',
      'forcereload',
      'toggledevtools',
      'close',
      'minimize',
      'filemenu',
      'viewmenu',
      'windowmenu',
    ]) {
      expect(all).not.toContain(role);
    }
  });

  it('ADR-0120: has no page zoom (⌘0 / ⌘+ / ⌘−), by role or by shortcut', () => {
    const all = roles(template).map((role) => role.toLowerCase());
    for (const role of ['resetzoom', 'zoomin', 'zoomout']) {
      expect(all).not.toContain(role);
    }
    for (const accelerator of accelerators(template)) {
      expect(accelerator).not.toMatch(/^(CommandOrControl|Command|Cmd)\+(0|Plus|=|-|Minus)$/i);
    }
  });
});

describe('resetPageZoomOnLoad (ADR-0120)', () => {
  /**
   * A fake web contents: records its load handler and its zoom.
   *
   * @param level The zoom level it starts at (0 is 100 %).
   * @returns The fake and a way to fire its load.
   */
  function fakeContents(level: number) {
    let onLoad: (() => void) | null = null;
    const contents = {
      level,
      on: (event: string, handler: () => void) => {
        if (event === 'did-finish-load') onLoad = handler;
        return contents;
      },
      getZoomLevel: () => contents.level,
      setZoomLevel: vi.fn((next: number) => {
        contents.level = next;
      }),
    };
    return { contents, load: () => onLoad?.() };
  }

  it('puts a page zoomed by Chromium back to 100 % when it loads', () => {
    const { contents, load } = fakeContents(1.5);
    resetPageZoomOnLoad(contents as never);
    expect(contents.setZoomLevel).not.toHaveBeenCalled();
    load();
    expect(contents.setZoomLevel).toHaveBeenCalledWith(0);
    expect(contents.level).toBe(0);
  });

  it('leaves a page at 100 % alone', () => {
    const { contents, load } = fakeContents(0);
    resetPageZoomOnLoad(contents as never);
    load();
    expect(contents.setZoomLevel).not.toHaveBeenCalled();
  });
});
