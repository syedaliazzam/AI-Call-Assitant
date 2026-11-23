/**
 * File: apps/web/src/core/storage/overlayPrefs.ts
 * Purpose: The overlay's preferences on this device: whether calls start in the overlay (default
 *          on), the panel's background opacity (default 70%), whether the panel grows more
 *          see-through when the pointer is elsewhere (default off), and (v1.1.0) which panels are open
 *          and which microphone is chosen. Kept in localStorage: per-device conveniences, not session
 *          data. ADR-0085: the transcript panel is open by default (applied once to existing devices too)
 *          and then follows the user's own choice; the answer panel is not remembered (it opens by itself on
 *          the first answer of each call); and the split between the side-by-side panels. ADR-0113: the panels'
 *          own width, as a share of the bars' width (the answer panel's corner grip sets it).
 * Used by: src/features/live/LiveAnswers.tsx, src/features/live/CompactLive.tsx,
 *          src/features/settings/OverlaySetting.tsx
 * Depends on: nothing (localStorage)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0029, ADR-0033,
 *               ADR-0039 (v1.0.3: the panel opacity setting and its migration)
 *
 * v1.0.3 (ADR-0039): the panel was solid in v1.0.2 because "fade" was on by default and painted the
 * panel at 100% whenever the pointer was over it (and the overlay started as "hovered"), and an old
 * stored value from the window-opacity days (default 1) could pin it at 100% too. The opacity now
 * lives under a new key, migrated once from the old one, and fading never makes the panel MORE solid.
 */

/** The localStorage key for "Start calls in the overlay". */
export const START_IN_OVERLAY_KEY = 'kite.startInOverlay';

/**
 * The old key: the window's opacity (ADR-0029, default 1 under ADR-0031), later reused for the
 * panel. Read once by the migration, then removed.
 */
export const OVERLAY_OPACITY_KEY = 'kite.overlayOpacity';

/** The key for the panel's background opacity (v1.0.3). */
export const OVERLAY_PANEL_ALPHA_KEY = 'kite.overlayPanelAlpha';

/** The old fade key (on by default, solid under the pointer): ignored since v1.0.3. */
export const OVERLAY_FADE_KEY = 'kite.overlayFade';

/** The key for "More see-through when the pointer is elsewhere" (v1.0.3, default off). */
export const OVERLAY_FADE_AWAY_KEY = 'kite.overlayFadeAway';

/** v1.1.0: the key for which of the overlay's panels are open. */
export const OVERLAY_PANELS_KEY = 'kite.overlayPanels';

/**
 * ADR-0085: the version of the panels' default applied on this device. Below PANELS_DEFAULT_VERSION the
 * transcript is opened once (whatever was stored), then the stored choice is followed again.
 */
export const OVERLAY_PANELS_DEFAULT_KEY = 'kite.overlayPanelsDefault';

/** ADR-0085: the current panels' default (2: transcript open). */
export const PANELS_DEFAULT_VERSION = 2;

/** ADR-0085: the key for the transcript's share of the width when the panels sit side by side. */
export const OVERLAY_SPLIT_KEY = 'kite.overlaySplit';

/**
 * ADR-0085: the transcript's share of the panels' width side by side: 40 % by default (the answer gets the
 * rest); a drag of the divider stays between these limits (each panel's minimum width is kept in CSS too).
 */
export const OVERLAY_SPLIT = { min: 0.2, max: 0.7, default: 0.4 } as const;

/** ADR-0113: the key for the panels' own width, as a share of the bars' width. */
export const OVERLAY_PANELS_WIDTH_KEY = 'kite.overlayPanelsWidth';

/**
 * ADR-0113: the panels' width (the answer panel, or the transcript and the answer as one block) as a share
 * of the bars' width: as wide as the bars by default (1), never wider (ADR-0113 keeps the answer within the
 * bar, so the window never has to grow for it), and never under the smallest share a drag may store (the
 * answer panel's button strip is also kept whole in CSS, whatever the share).
 */
export const OVERLAY_PANELS_WIDTH = { min: 0.2, max: 1, default: 1 } as const;

/** v1.1.0: the key for the microphone chosen in the overlay's device list. */
export const MIC_DEVICE_KEY = 'kite.micDevice';

/** How much of the chosen opacity the panel keeps when fading away from the pointer. */
export const FADE_AWAY_FACTOR = 0.6;

/** The opacity range the slider offers for the overlay panel's background (ADR-0033). */
// ADR-0033: the slider now dims only the panel's background (--k-overlay-alpha), never the text,
// and the window stays opaque. So a lower setting no longer fades the text, and a readable default
// of 0.7 is safe over any background (0.7 over pure white gives the body text about 6.3:1;
// tests/unit/ui/theme.test.ts). The minimum stays 0.4 — at that setting over a bright background the
// nominal text contrast is low (~2.4:1) and the text shadow carries legibility; the developer chose
// not to raise it.
export const OVERLAY_OPACITY = { min: 0.4, max: 1, default: 0.82 };

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
 * Called from: startsCallsInOverlay() in features/live/openOverlay.tsx (LivePage's Connect,
 *              ADR-0053), OverlaySetting.tsx
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

/** Which of the overlay's panels are open (v1.1.0). */
export interface OverlayPanels {
  /** The transcript panel. */
  transcript: boolean;
  /** The answer panel. */
  answer: boolean;
}

/**
 * The panels a call starts with (ADR-0085): the transcript as the user last left it, open on a device's
 * first call, and opened once on a device that stored a choice before this default existed; the answer
 * panel closed (an answer opens it). Before ADR-0085 both panels were remembered and both started closed.
 *
 * @returns The panels.
 * Called from: CompactLive.tsx; tests
 */
export function getOverlayPanels(): OverlayPanels {
  const applied = Number(read(OVERLAY_PANELS_DEFAULT_KEY) ?? 0);
  if (!(applied >= PANELS_DEFAULT_VERSION)) {
    // Once per device: the new default wins over what was stored, then the user's own choice is kept.
    write(OVERLAY_PANELS_KEY, 'transcript');
    write(OVERLAY_PANELS_DEFAULT_KEY, String(PANELS_DEFAULT_VERSION));
  }
  const stored = read(OVERLAY_PANELS_KEY);
  // Nothing stored (storage blocked): the default, open.
  return { transcript: stored === null ? true : stored.includes('transcript'), answer: false };
}

/**
 * Remembers whether the transcript panel is open: the user's own choice (its switch, the level button,
 * Ctrl+Alt+T, its collapse button). The answer panel is not remembered (ADR-0085): an answer opening it is
 * not a choice.
 *
 * @param panels The panels (only the transcript is stored).
 * Called from: CompactLive.tsx; tests
 */
export function setOverlayPanels(panels: OverlayPanels): void {
  write(OVERLAY_PANELS_KEY, panels.transcript ? 'transcript' : 'none');
}

/**
 * The transcript's share of the width when the panels sit side by side (ADR-0085).
 *
 * @returns A ratio inside OVERLAY_SPLIT (the default when unset or unreadable).
 * Called from: CompactView.tsx; tests
 */
export function getOverlaySplit(): number {
  const raw = read(OVERLAY_SPLIT_KEY);
  const value = Number(raw);
  return raw !== null && Number.isFinite(value) ? clampSplit(value) : OVERLAY_SPLIT.default;
}

/**
 * Remembers the split (a drag of the divider, its arrow keys, or a double-click back to the default).
 *
 * @param ratio The transcript's share (kept inside OVERLAY_SPLIT).
 * Called from: CompactView.tsx; tests
 */
export function setOverlaySplit(ratio: number): void {
  write(OVERLAY_SPLIT_KEY, String(Math.round(clampSplit(ratio) * 1000) / 1000));
}

/**
 * Keeps a split inside its limits.
 *
 * @param ratio The transcript's share.
 * @returns The ratio, clamped to OVERLAY_SPLIT.min–max.
 * Called from: getOverlaySplit(), setOverlaySplit(); overlay/PanelSplit.tsx
 */
export function clampSplit(ratio: number): number {
  return Math.min(OVERLAY_SPLIT.max, Math.max(OVERLAY_SPLIT.min, ratio));
}

/**
 * ADR-0113: the panels' width as a share of the bars' width (the answer panel's corner grip sets it).
 *
 * @returns A share inside OVERLAY_PANELS_WIDTH (the default, as wide as the bars, when unset or unreadable).
 * Called from: CompactView.tsx; tests
 */
export function getOverlayPanelsWidth(): number {
  const raw = read(OVERLAY_PANELS_WIDTH_KEY);
  const value = Number(raw);
  return raw !== null && Number.isFinite(value)
    ? clampPanelsWidth(value)
    : OVERLAY_PANELS_WIDTH.default;
}

/**
 * ADR-0113: remembers the panels' width on this device (once a drag of the answer panel's corner ends).
 *
 * @param share The width as a share of the bars' width (kept inside OVERLAY_PANELS_WIDTH).
 * Called from: CompactView.tsx; tests
 */
export function setOverlayPanelsWidth(share: number): void {
  write(OVERLAY_PANELS_WIDTH_KEY, String(Math.round(clampPanelsWidth(share) * 1000) / 1000));
}

/**
 * ADR-0113: keeps a panels' width share inside its limits.
 *
 * @param share The width as a share of the bars' width.
 * @returns The share, clamped to OVERLAY_PANELS_WIDTH.min–max.
 * Called from: getOverlayPanelsWidth(), setOverlayPanelsWidth(); overlay/panelWidth.ts
 */
export function clampPanelsWidth(share: number): number {
  return Math.min(OVERLAY_PANELS_WIDTH.max, Math.max(OVERLAY_PANELS_WIDTH.min, share));
}

/**
 * The microphone chosen in the overlay's device list.
 *
 * @returns Its device id, or '' for the system's default.
 * Called from: LivePage.tsx; tests
 */
export function getMicDevice(): string {
  return read(MIC_DEVICE_KEY) ?? '';
}

/**
 * Remembers the chosen microphone.
 *
 * @param deviceId Its device id, or '' for the system's default.
 * Called from: LivePage.tsx; tests
 */
export function setMicDevice(deviceId: string): void {
  write(MIC_DEVICE_KEY, deviceId);
}

/**
 * Removes a stored value.
 *
 * @param key The key.
 * @returns Nothing.
 * Called from: migrateOverlayOpacity()
 */
function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

/**
 * Keeps a number inside the slider's range.
 *
 * @param value The number.
 * @returns The value, clamped to OVERLAY_OPACITY.min–max.
 * Called from: migrateOverlayOpacity(), getOverlayOpacity()
 */
function clampOpacity(value: number): number {
  return Math.min(OVERLAY_OPACITY.max, Math.max(OVERLAY_OPACITY.min, value));
}

/**
 * Moves an old stored opacity (the old key) to the panel-background key, once (v1.0.3). The old
 * key held the WINDOW's opacity, whose default was 1 (ADR-0031): 1, or anything near it, was never
 * a choice for a solid panel, so it becomes the 70% default; a value the user chose below that is
 * kept (clamped to the slider's range). Anything unreadable becomes the default. The old key is
 * removed either way, so this runs once.
 *
 * @returns Nothing.
 * Called from: getOverlayOpacity(); tests
 */
export function migrateOverlayOpacity(): void {
  const old = read(OVERLAY_OPACITY_KEY);
  if (old === null) return;
  if (read(OVERLAY_PANEL_ALPHA_KEY) === null) {
    const value = Number(old);
    const migrated =
      Number.isFinite(value) && value > 0 && value < 0.95
        ? clampOpacity(value)
        : OVERLAY_OPACITY.default;
    write(OVERLAY_PANEL_ALPHA_KEY, String(migrated));
  }
  remove(OVERLAY_OPACITY_KEY);
}

/**
 * The panel's background opacity (migrating an old stored value first).
 *
 * @returns A value in the slider's range (the 70% default when unset or invalid).
 * Called from: CompactLive.tsx
 */
export function getOverlayOpacity(): number {
  migrateOverlayOpacity();
  const raw = read(OVERLAY_PANEL_ALPHA_KEY);
  const value = Number(raw);
  return raw !== null && value >= OVERLAY_OPACITY.min && value <= OVERLAY_OPACITY.max
    ? value
    : OVERLAY_OPACITY.default;
}

/**
 * Stores the panel's background opacity.
 *
 * @param value The opacity (kept inside the slider's range).
 * @returns Nothing.
 * Called from: CompactLive.tsx
 */
export function setOverlayOpacityPref(value: number): void {
  write(OVERLAY_PANEL_ALPHA_KEY, String(clampOpacity(value)));
}

/**
 * Whether the panel grows more see-through when the pointer is elsewhere (v1.0.3: off by default;
 * the old "fade" setting, on by default and solid under the pointer, is ignored).
 *
 * @returns True only when the user turned it on.
 * Called from: CompactLive.tsx
 */
export function getOverlayFade(): boolean {
  return read(OVERLAY_FADE_AWAY_KEY) === 'on';
}

/**
 * Sets whether the panel grows more see-through when the pointer is elsewhere.
 *
 * @param on True to fade away from the pointer.
 * @returns Nothing.
 * Called from: CompactLive.tsx
 */
export function setOverlayFadePref(on: boolean): void {
  write(OVERLAY_FADE_AWAY_KEY, on ? 'on' : 'off');
}

/**
 * The panel's background opacity to paint now. Under the pointer it is always the chosen value, so
 * moving the slider shows at once; with fading on, away from the pointer it is more see-through.
 * It is never more solid than the chosen value (v1.0.2 painted 100% under the pointer).
 *
 * @param opacity The chosen opacity.
 * @param fade    Whether fading away from the pointer is on.
 * @param hovered Whether the pointer is over the overlay.
 * @returns The opacity to paint.
 * Called from: CompactLive.tsx; tests
 */
export function paintedOpacity(opacity: number, fade: boolean, hovered: boolean): number {
  if (!fade || hovered) return opacity;
  return Math.max(0.2, Math.round(opacity * FADE_AWAY_FACTOR * 100) / 100);
}
