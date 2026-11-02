/**
 * File: apps/web/src/core/storage/overlayPrefs.ts
 * Purpose: The overlay's preferences on this device: whether calls start in the overlay (default
 *          on), its opacity, and whether it fades when the pointer is elsewhere. Kept in
 *          localStorage: per-device conveniences, not session data.
 * Used by: src/features/live/LiveAnswers.tsx, src/features/live/CompactLive.tsx,
 *          src/features/settings/OverlaySetting.tsx
 * Depends on: nothing (localStorage)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0029
 */

/** The localStorage key for "Start calls in the overlay". */
export const START_IN_OVERLAY_KEY = 'kite.startInOverlay';

/** The localStorage key for the overlay's opacity. */
export const OVERLAY_OPACITY_KEY = 'kite.overlayOpacity';

/** The localStorage key for fading when not hovered. */
export const OVERLAY_FADE_KEY = 'kite.overlayFade';

/** The opacity range the slider offers (the shell keeps the window in a readable range too). */
// Default 1: the panel is see-through already (theme §6), and dimming the window as well would take
// its text below 4.5:1 over a bright background (tests/unit/ui/theme.test.ts).
export const OVERLAY_OPACITY = { min: 0.4, max: 1, default: 1 };

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
 * Stores a value.
 *
 * @param key   The key.
 * @param value The value.
 * @returns Nothing.
 * Called from: the setters below
 */
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
}

/**
 * Whether Connect opens the overlay and minimises the main window.
 *
 * @returns True unless the user turned it off.
 * Called from: LiveAnswers.tsx, OverlaySetting.tsx
 */
export function getStartInOverlay(): boolean {
  return read(START_IN_OVERLAY_KEY) !== 'off';
}

/**
 * Sets "Start calls in the overlay".
 *
 * @param on True to start calls in the overlay.
 * @returns Nothing.
 * Called from: OverlaySetting.tsx
 */
export function setStartInOverlay(on: boolean): void {
  write(START_IN_OVERLAY_KEY, on ? 'on' : 'off');
}

/**
 * The overlay's opacity.
 *
 * @returns A value in the slider's range (the default when unset or invalid).
 * Called from: CompactLive.tsx
 */
export function getOverlayOpacity(): number {
  const value = Number(read(OVERLAY_OPACITY_KEY));
  return read(OVERLAY_OPACITY_KEY) !== null &&
    value >= OVERLAY_OPACITY.min &&
    value <= OVERLAY_OPACITY.max
    ? value
    : OVERLAY_OPACITY.default;
}

/**
 * Stores the overlay's opacity.
 *
 * @param value The opacity.
 * @returns Nothing.
 * Called from: CompactLive.tsx
 */
export function setOverlayOpacityPref(value: number): void {
  write(OVERLAY_OPACITY_KEY, String(value));
}

/**
 * Whether the overlay fades when the pointer is elsewhere.
 *
 * @returns True unless the user turned it off.
 * Called from: CompactLive.tsx
 */
export function getOverlayFade(): boolean {
  return read(OVERLAY_FADE_KEY) !== 'off';
}

/**
 * Sets whether the overlay fades when the pointer is elsewhere.
 *
 * @param on True to fade.
 * @returns Nothing.
 * Called from: CompactLive.tsx
 */
export function setOverlayFadePref(on: boolean): void {
  write(OVERLAY_FADE_KEY, on ? 'on' : 'off');
}
