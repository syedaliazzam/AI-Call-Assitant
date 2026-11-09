/**
 * Tests for apps/web/src/core/storage/appearancePrefs.ts (v1.1.0, ADR-0041): the two themes (dashboard
 * light and call dark by default, v1.3.0), UI scale and overlay text size: defaults, limits, what a
 * broken stored value gives, blocked storage, the boot script, and telling listeners in this window and
 * other windows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_THEME_KEY,
  clampStep,
  FONT_SCALE_KEY,
  FONT_SCALE_RANGE,
  getFontScale,
  getTheme,
  getZoom,
  resolveTheme,
  setFontScale,
  setTheme,
  setZoom,
  subscribeAppearance,
  THEME_KEY,
  ZOOM_KEY,
  ZOOM_RANGE,
} from '@/core/storage/appearancePrefs';
import {
  applyResolvedTheme,
  THEME_BOOT_SCRIPT,
  THEME_KEY as BOOT_THEME_KEY,
} from '@/core/storage/appearancePrefs';

/**
 * An in-memory localStorage.
 *
 * @returns The storage.
 */
function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('is Light for the dashboard and Dark for the call until chosen, and ignores a broken value', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    expect(getTheme('dashboard')).toBe('light');
    expect(getTheme('call')).toBe('dark');
    storage.setItem(THEME_KEY, 'purple');
    storage.setItem(CALL_THEME_KEY, 'purple');
    expect(getTheme('dashboard')).toBe('light');
    expect(getTheme('call')).toBe('dark');
    setTheme('dark', 'dashboard');
    expect(getTheme('dashboard')).toBe('dark');
    setTheme('system', 'dashboard');
    expect(getTheme('dashboard')).toBe('system');
  });

  it('keeps the two choices apart, and an older single choice stays the dashboard one', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    // Before v1.3.0 the one theme lived under THEME_KEY.
    storage.setItem(THEME_KEY, 'dark');
    expect(getTheme('dashboard')).toBe('dark');
    expect(getTheme('call')).toBe('dark');
    setTheme('light', 'call');
    expect(getTheme('call')).toBe('light');
    expect(getTheme('dashboard')).toBe('dark');
  });

  it('resolves System from what the computer prefers', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('UI scale and overlay text size', () => {
  it('default to 1', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(getZoom()).toBe(1);
    expect(getFontScale()).toBe(1);
  });

  it('stay within their limits, however they got there', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    setZoom(9);
    expect(getZoom()).toBe(ZOOM_RANGE.max);
    setFontScale(0.1);
    expect(getFontScale()).toBe(FONT_SCALE_RANGE.min);
    storage.setItem(ZOOM_KEY, '0.1');
    expect(getZoom()).toBe(ZOOM_RANGE.min);
    storage.setItem(FONT_SCALE_KEY, 'not a number');
    expect(getFontScale()).toBe(FONT_SCALE_RANGE.default);
  });

  it('never drift over repeated steps', () => {
    let zoom = 1;
    for (let i = 0; i < 3; i += 1) zoom = clampStep(zoom + ZOOM_RANGE.step, ZOOM_RANGE);
    expect(zoom).toBe(1.3);
  });
});

describe('storage and listeners', () => {
  it('gives the defaults when storage is blocked, and a change does not throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getTheme('dashboard')).toBe('light');
    expect(getTheme('call')).toBe('dark');
    expect(getZoom()).toBe(1);
    expect(() => setTheme('dark', 'dashboard')).not.toThrow();
  });

  it('tells listeners of a change here and in another window, until they stop', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const events = new EventTarget();
    vi.stubGlobal('window', events);
    const listener = vi.fn();
    const stop = subscribeAppearance(listener);
    setZoom(1.1);
    expect(listener).toHaveBeenCalledTimes(1);

    /**
     * Fires another window's storage event.
     *
     * @param key The key that changed.
     * @returns Whether the event went through.
     */
    const fromElsewhere = (key: string) =>
      events.dispatchEvent(Object.assign(new Event('storage'), { key }));
    fromElsewhere(THEME_KEY);
    expect(listener).toHaveBeenCalledTimes(2);
    fromElsewhere(CALL_THEME_KEY);
    expect(listener).toHaveBeenCalledTimes(3);
    fromElsewhere('kite.other');
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    setZoom(1);
    fromElsewhere(THEME_KEY);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('the theme on the whole document (v1.2.0)', () => {
  it('paints dark through the data-theme attribute, and light by removing it', () => {
    const root = { dataset: {} as DOMStringMap };
    applyResolvedTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyResolvedTheme('light', root);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('the script that runs before the first paint reads the same key and survives blocked storage', () => {
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(BOOT_THEME_KEY));
    expect(THEME_BOOT_SCRIPT.startsWith('try{')).toBe(true);
    expect(THEME_BOOT_SCRIPT.endsWith('catch(e){}')).toBe(true);
  });

  it('the script paints dark only for Dark, or System on a dark computer (nothing stored: light)', () => {
    /**
     * Runs the boot script against a stored value and the computer's preference.
     *
     * @param stored      The stored dashboard theme, or null.
     * @param prefersDark Whether the computer prefers dark.
     * @returns The data-theme it set.
     */
    const run = (stored: string | null, prefersDark: boolean) => {
      const root = { dataset: {} as DOMStringMap };
      new Function('localStorage', 'matchMedia', 'document', THEME_BOOT_SCRIPT)(
        { getItem: () => stored },
        () => ({ matches: prefersDark }),
        { documentElement: root },
      );
      return root.dataset.theme;
    };
    expect(run(null, true)).toBeUndefined();
    expect(run('light', true)).toBeUndefined();
    expect(run('dark', false)).toBe('dark');
    expect(run('system', true)).toBe('dark');
    expect(run('system', false)).toBeUndefined();
  });
});
