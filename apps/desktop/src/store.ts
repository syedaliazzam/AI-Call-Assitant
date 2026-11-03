/**
 * File: apps/desktop/src/store.ts
 * Purpose: The shell's own small settings file (Day 5): the compact window's last position and
 *          size, the screen-share protection setting and (v1.0.2) the overlay preset. A JSON file
 *          in Electron's userData folder; holds no call content.
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
}

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
