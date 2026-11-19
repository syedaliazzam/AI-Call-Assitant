/**
 * Tests for apps/desktop/src/macMenu.ts (desktop 1.8.0, ADR-0111): the Mac application menu keeps About,
 * Hide, Hide Others, Show All, Quit, the Edit menu (copy and paste in text boxes), the page zoom and full
 * screen, and the Window menu's Zoom and Bring All to Front; it has no reload, force reload, developer
 * tools, close window or minimise, whose shortcuts would reach the frameless overlay on a Mac.
 */
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { macMenuTemplate } from '../../src/macMenu';

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
        'resetZoom',
        'zoomIn',
        'zoomOut',
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
});
