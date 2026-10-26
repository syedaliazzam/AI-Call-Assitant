/**
 * File: apps/desktop/src/preload.ts
 * Purpose: Runs inside the Kite window before the page and exposes exactly one object to it:
 *          window.kiteDesktop = { version, os } (frozen). Nothing else is exposed.
 * Used by: src/security.ts secureWebPreferences() (loaded as the window's preload, dist/preload.js)
 * Depends on: electron (contextBridge); @kite/shared (KiteDesktopApi type only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3, §7.3 (preload.ts)
 *
 * This preload is sandboxed: it can use contextBridge and a limited `process`
 * (argv, platform), but not Node modules or app.getVersion().
 */
import type { DesktopOs, KiteDesktopApi } from '@kite/shared';
import { contextBridge } from 'electron';

/** Prefix of the argument main.ts passes with the app version. */
const VERSION_ARG = '--kite-version=';

/**
 * Finds the shell version in the renderer's command-line arguments.
 *
 * @param argv The renderer process arguments (process.argv).
 * @returns The version, for example '0.1.0', or '0.0.0' if missing.
 * Called from: the bottom of this file; tests
 */
export function readVersion(argv: readonly string[]): string {
  return argv.find((arg) => arg.startsWith(VERSION_ARG))?.slice(VERSION_ARG.length) || '0.0.0';
}

/**
 * Converts Node's platform name to the bridge's OS name.
 *
 * @param platform process.platform, for example 'darwin' or 'win32'.
 * @returns 'mac', 'windows' or 'linux' (anything else is treated as linux).
 * Called from: the bottom of this file; tests
 */
export function toDesktopOs(platform: string): DesktopOs {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

/** The bridge object. Frozen, so the page cannot change or extend it. */
const kiteDesktop: KiteDesktopApi = Object.freeze({
  version: readVersion(process.argv),
  os: toDesktopOs(process.platform),
});

contextBridge.exposeInMainWorld('kiteDesktop', kiteDesktop);
