/**
 * File: apps/web/src/core/storage/appearancePrefs.ts
 * Purpose: How the desktop panels look on this device (v1.1.0, ADR-0041): the themes (light, dark or
 *          following the system), the UI scale and the overlay's answer and transcript text size.
 *          Two themes (v1.3.0): one for the dashboard (the web pages and the home panel; light unless
 *          chosen) and one for the call (the compact view, the call window and the browser's call view;
 *          dark unless chosen), so a light dashboard keeps a dark overlay.
 *          Kept in localStorage, which every Kite window on this device shares, so a change in the
 *          home panel's menu shows in the overlay's and the other way round.
 * Used by: src/features/appearance/useAppearance.ts
 * Depends on: localStorage (a blocked one means the defaults)
 * Architecture: docs/design/kite-ui-theme.md; ADR-0041
 */

/** The theme the user chose. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** A theme that is actually painted. */
export type ResolvedTheme = 'light' | 'dark';

/** Which theme setting: the dashboard's (web pages, home panel) or the call's (compact view, call windows). */
export type ThemeSurface = 'dashboard' | 'call';

/** The localStorage key for the dashboard's theme (the one theme before v1.3.0, so old choices stay). */
export const THEME_KEY = 'kite.theme';

/** The localStorage key for the call's theme (v1.3.0). */
export const CALL_THEME_KEY = 'kite.callTheme';

/** Where each theme is kept. */
const THEME_KEYS: Readonly<Record<ThemeSurface, string>> = {
  dashboard: THEME_KEY,
  call: CALL_THEME_KEY,
};

/** Each theme until the user chooses one: a light dashboard and a dark call view. */
export const THEME_DEFAULTS: Readonly<Record<ThemeSurface, ThemeChoice>> = {
  dashboard: 'light',
  call: 'dark',
};

/** The localStorage key for the UI scale. */
export const ZOOM_KEY = 'kite.uiZoom';

/** The localStorage key for the overlay's text size. */
export const FONT_SCALE_KEY = 'kite.overlayFontScale';

/** The UI scale's range and step (Zoom + / − / reset). */
export const ZOOM_RANGE = { min: 0.8, max: 1.3, step: 0.1, default: 1 };

/** The overlay's text size range and step (Font size + / − / reset). */
export const FONT_SCALE_RANGE = { min: 0.8, max: 1.5, step: 0.1, default: 1 };

/** Told when a setting changes in this window (the 'storage' event covers other windows). */
const listeners = new Set<() => void>();

/**
 * Reads a stored value.
 *
 * @param key The key.
 * @returns The value, or null when it is not set or storage is blocked.
 * Called from: the getters below
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage blocked (private window, policy): the defaults apply.
    return null;
  }
}

/**
 * Stores a value and tells this window's listeners.
 *
 * @param key   The key.
 * @param value The value.
 * Called from: the setters below
 */
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
  for (const listener of listeners) listener();
}

/**
 * Keeps a number within a range, rounded to one decimal so repeated steps never drift.
 *
 * @param value A number.
 * @param range The range.
 * @returns The number, within the range.
 * Called from: getZoom(), getFontScale(), the setters; tests
 */
export function clampStep(value: number, range: { min: number; max: number }): number {
  return Math.round(Math.min(range.max, Math.max(range.min, value)) * 10) / 10;
}

/**
 * Reads a stored number within a range.
 *
 * @param key      The key.
 * @param range    The range.
 * @param fallback Used when nothing usable is stored.
 * @returns The number.
 * Called from: getZoom(), getFontScale()
 */
function readNumber(key: string, range: { min: number; max: number }, fallback: number): number {
  const stored = Number(read(key));
  return read(key) !== null && Number.isFinite(stored) ? clampStep(stored, range) : fallback;
}

/**
 * The theme the user chose for one surface.
 *
 * @param surface The dashboard or the call.
 * @returns The choice; THEME_DEFAULTS[surface] when none (or a broken one) is stored.
 * Called from: useAppearance(), ThemeSync, UserMenu; tests
 */
export function getTheme(surface: ThemeSurface): ThemeChoice {
  const stored = read(THEME_KEYS[surface]);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : THEME_DEFAULTS[surface];
}

/**
 * Changes the theme of one surface.
 *
 * @param theme   The choice.
 * @param surface The dashboard or the call.
 * Called from: HomeMenu, UserMenu (dashboard); LiveMenu, LiveAnswers (call); tests
 */
export function setTheme(theme: ThemeChoice, surface: ThemeSurface): void {
  write(THEME_KEYS[surface], theme);
}

/**
 * The theme to paint.
 *
 * @param choice      The user's choice.
 * @param prefersDark True when the system prefers dark.
 * @returns 'light' or 'dark'.
 * Called from: useAppearance(); tests
 */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}

/**
 * Runs before the first paint, in the page's <head>, so a dark theme never flashes white while the app
 * loads (v1.2.0). It reads the same key as getTheme('dashboard') and repeats resolveTheme(), because no
 * module has loaded yet at that point: dark only when Dark is chosen, or System on a computer that
 * prefers dark. Nothing stored means light (v1.3.0).
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark'}catch(e){}`;

/**
 * Paints the whole document in a theme, through <html data-theme> (src/ui/tokens/theme.css).
 *
 * @param theme The theme to paint.
 * @param root  The document's root element.
 * Called from: src/features/appearance/ThemeSync.tsx; tests
 */
export function applyResolvedTheme(
  theme: ResolvedTheme,
  root: Pick<HTMLElement, 'dataset'> = document.documentElement,
): void {
  if (theme === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
}

/**
 * The UI scale.
 *
 * @returns The scale (default 1).
 * Called from: useAppearance(); tests
 */
export function getZoom(): number {
  return readNumber(ZOOM_KEY, ZOOM_RANGE, ZOOM_RANGE.default);
}

/**
 * Changes the UI scale.
 *
 * @param zoom The scale; kept within ZOOM_RANGE.
 * Called from: useAppearance(); tests
 */
export function setZoom(zoom: number): void {
  write(ZOOM_KEY, String(clampStep(zoom, ZOOM_RANGE)));
}

/**
 * The overlay's text size.
 *
 * @returns The scale (default 1).
 * Called from: useAppearance(); tests
 */
export function getFontScale(): number {
  return readNumber(FONT_SCALE_KEY, FONT_SCALE_RANGE, FONT_SCALE_RANGE.default);
}

/**
 * Changes the overlay's text size.
 *
 * @param scale The scale; kept within FONT_SCALE_RANGE.
 * Called from: useAppearance(); tests
 */
export function setFontScale(scale: number): void {
  write(FONT_SCALE_KEY, String(clampStep(scale, FONT_SCALE_RANGE)));
}

/**
 * Listens for changes, in this window and in other Kite windows on this device.
 *
 * @param listener Called after a change.
 * @returns A function that stops listening.
 * Called from: useAppearance(); tests
 */
export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      [THEME_KEY, CALL_THEME_KEY, ZOOM_KEY, FONT_SCALE_KEY].includes(event.key)
    )
      listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
