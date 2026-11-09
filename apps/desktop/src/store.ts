/**
 * File: apps/desktop/src/store.ts
 * Purpose: The shell's own small settings file (Day 5): the compact window's last position and
 *          size, the screen-share protection setting, (v1.0.2) the overlay preset, and (v1.1.0) the
 *          home panel's place, the overlay's place on each display and its panel heights. A JSON
 *          file in Electron's userData folder; holds no call content.
 * Used by: src/windows.ts, src/protection.ts, src/main.ts
 * Depends on: node:fs, @kite/shared (OVERLAY_PRESETS)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3; day-05-overlay-screenshots-notes.md
 *               Stage 3; ADR-0035
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OVERLAY_PRESETS, type OverlayPreset } from '@kite/shared';

/** A window position and size, in screen DIPs. */
export interface Bounds {
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  /** Width. */
  width: number;
  /** Height. */
  height: number;
}

/** What the file holds. */
export interface ShellSettings {
  /** The compact window's last position and size. */
  compactBounds?: Bounds;
  /** Screen-share protection of the compact window (absent: off). */
  shareProtection?: boolean;
  /**
   * v1.0.2 (ADR-0035): the overlay preset the user last chose; where the overlay opens when no
   * saved position fits a screen (absent: 'top-center').
   */
  overlayPreset?: OverlayPreset;
  /** v1.1.0 (ADR-0041): the home panel's last position and size. */
  homeBounds?: Bounds;
  /**
   * v1.1.0 (ADR-0041): where the stacked overlay was last put on each display, by display id. Only the
   * place and width: its height follows the panels that are open.
   */
  overlayPlaces?: Record<string, OverlayPlace>;
  /** v1.1.0 (ADR-0041): how tall the user made the overlay with each set of panels open. */
  overlayHeights?: Partial<Record<OverlayLayoutKey, number>>;
  /** v1.2.0 (spec S15): how wide the user made the overlay with both panels open. */
  overlayBothWidth?: number;
  /** v1.2.0: true once a place saved by 1.1.0 has been widened for the new bar 1. */
  overlayBarsWidened?: boolean;
  /**
   * v1.3.0 (ADR-0055): the width a saved place was last widened to for bar 1 (900 since the Transcript
   * pill). Absent: 780 when overlayBarsWidened is set, otherwise never widened.
   */
  overlayBarsWidth?: number;
}

/** The stacked overlay's place on one display (v1.1.0). */
export interface OverlayPlace {
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  /** Width. */
  width: number;
}

/** Which of the overlay's panels are open (v1.1.0): the height is remembered for each. */
export type OverlayLayoutKey = 'bars' | 'transcript' | 'answer' | 'both';

/** Every OverlayLayoutKey. */
export const OVERLAY_LAYOUT_KEYS: readonly OverlayLayoutKey[] = [
  'bars',
  'transcript',
  'answer',
  'both',
];

/** Reads and updates the settings file. */
export interface ShellStore {
  /**
   * The settings ({} when the file is missing or unreadable).
   *
   * @returns The settings.
   */
  read(): ShellSettings;
  /**
   * Merges and saves settings.
   *
   * @param changes The settings to change.
   */
  write(changes: ShellSettings): void;
}

/**
 * Whether a value is usable bounds (four finite numbers, positive size).
 *
 * @param value A parsed value.
 * @returns True for bounds.
 * Called from: createStore(); tests
 */
export function isBounds(value: unknown): value is Bounds {
  const b = value as Partial<Bounds> | null;
  return (
    !!b &&
    [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    b.width! > 0 &&
    b.height! > 0
  );
}

/**
 * Whether a value is a usable overlay place (three finite numbers, positive width).
 *
 * @param value A parsed value.
 * @returns True for a place.
 * Called from: createStore(); tests
 */
export function isOverlayPlace(value: unknown): value is OverlayPlace {
  const p = value as Partial<OverlayPlace> | null;
  return (
    !!p &&
    [p.x, p.y, p.width].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    p.width! > 0
  );
}

/**
 * Creates the store over a file.
 *
 * @param file The JSON file (in userData).
 * @returns The store. A broken file is treated as empty; a failed write is ignored (the
 *          settings are a convenience).
 * Called from: start() in main.ts; tests
 */
export function createStore(file: string): ShellStore {
  const read = (): ShellSettings => {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const settings: ShellSettings = {};
      if (isBounds(raw.compactBounds)) settings.compactBounds = raw.compactBounds;
      if (typeof raw.shareProtection === 'boolean') settings.shareProtection = raw.shareProtection;
      if ((OVERLAY_PRESETS as readonly unknown[]).includes(raw.overlayPreset)) {
        settings.overlayPreset = raw.overlayPreset as OverlayPreset;
      }
      if (isBounds(raw.homeBounds)) settings.homeBounds = raw.homeBounds;
      if (raw.overlayPlaces && typeof raw.overlayPlaces === 'object') {
        const places = Object.entries(raw.overlayPlaces).filter(([, place]) =>
          isOverlayPlace(place),
        );
        settings.overlayPlaces = Object.fromEntries(places) as Record<string, OverlayPlace>;
      }
      if (typeof raw.overlayBothWidth === 'number' && Number.isFinite(raw.overlayBothWidth)) {
        settings.overlayBothWidth = raw.overlayBothWidth;
      }
      if (raw.overlayBarsWidened === true) settings.overlayBarsWidened = true;
      if (typeof raw.overlayBarsWidth === 'number' && Number.isFinite(raw.overlayBarsWidth)) {
        settings.overlayBarsWidth = raw.overlayBarsWidth;
      }
      if (raw.overlayHeights && typeof raw.overlayHeights === 'object') {
        const heights = raw.overlayHeights as Record<string, unknown>;
        settings.overlayHeights = Object.fromEntries(
          OVERLAY_LAYOUT_KEYS.flatMap((key) => {
            const height = heights[key];
            return typeof height === 'number' && Number.isFinite(height) && height > 0
              ? [[key, height]]
              : [];
          }),
        );
      }
      return settings;
    } catch {
      return {};
    }
  };
  return {
    read,
    write(changes) {
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ ...read(), ...changes }, null, 1));
      } catch {
        // Not saved; the window opens at its default place next time.
      }
    },
  };
}
