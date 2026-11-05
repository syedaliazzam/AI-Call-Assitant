/**
 * File: apps/desktop/src/config.ts
 * Purpose: Which address the desktop shell opens (KITE_URL), the origins it trusts (only the
 *          web app's own addresses, or only the address given for testing), and the app name.
 * Used by: src/main.ts (loadConfig), tests/unit/config.test.ts
 * Depends on: nothing (pure functions; no Electron import, so it is unit-testable)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (desktop shell), §8.3
 *
 * Where KITE_URL comes from, first match wins:
 * 1. the KITE_URL environment variable (override for testing or a staging deployment);
 * 2. the --kite-url=<url> command-line flag (`pnpm --filter desktop dev` passes localhost:3000);
 * 3. PRODUCTION_URL.
 */

import path from 'node:path';

/** Name shown in the window title and error dialogs. */
export const APP_NAME = 'Paramount AI';

/**
 * The app's data folder name, under the system's application-data folder. It is the name the app had
 * until 1.1.0, and it stays: every session, setting and sign-in of an installed app lives there.
 */
export const DATA_FOLDER_NAME = 'Kite';

/** The deployed web app; opened when nothing overrides it (ADR-0046). */
export const PRODUCTION_URL = 'https://call.paramountintelligence.co';

/**
 * Every address of the deployed web app (ADR-0046). The first is the default. The second is the one
 * 1.2.0 and older load; it stays allowed as a fallback, and nothing switches to it by itself.
 */
export const PRODUCTION_ORIGINS: readonly string[] = [
  PRODUCTION_URL,
  'https://kite-call-assistant.vercel.app',
];

/** Command-line flag that sets the URL, used by the `dev` script. */
const URL_FLAG = '--kite-url=';

/** Host names allowed over plain http (local development only). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The settings main.ts needs. */
export interface DesktopConfig {
  /** Full address to load, for example 'https://call.paramountintelligence.co/'. */
  kiteUrl: string;
  /**
   * The only origins the window may show and the only ones that may get permissions: the web
   * app's own addresses (PRODUCTION_ORIGINS), or only the address given for testing. Sign-in
   * happens on the same origin as the page, so nothing else is needed. Any future payment or SSO
   * origin must be added on purpose; until then every other origin is blocked.
   */
  allowedOrigins: readonly string[];
}

/** What pinnedDataFolder() needs to know. */
export interface DataFolderContext {
  /** True in an installed app (app.isPackaged). */
  isPackaged: boolean;
  /** True when --user-data-dir was passed: every test run does, with a temporary folder. */
  hasUserDataDirSwitch: boolean;
  /** The system's application-data folder (app.getPath('appData')). */
  appData: string;
}

/**
 * Where an installed app must keep its data. Electron names the folder after productName, so the
 * rename (spec §2) would otherwise move an upgraded user to an empty folder. A development run keeps
 * its own folder, and --user-data-dir always wins: pinning over it would send a test run to the
 * person's real profile.
 *
 * @param context See DataFolderContext.
 * @returns The folder to set, or null to leave Electron's choice alone.
 * Called from: start() in src/main.ts; tests
 */
export function pinnedDataFolder(context: DataFolderContext): string | null {
  if (!context.isPackaged || context.hasUserDataDirSwitch) return null;
  return path.join(context.appData, DATA_FOLDER_NAME);
}

/**
 * Checks a candidate URL and returns it parsed.
 * Only https is accepted, except plain http to this computer (localhost) for development,
 * so the shell never loads Kite over an unencrypted connection on a network.
 *
 * @param raw The URL text.
 * @returns The parsed URL.
 * @throws Error('Invalid KITE_URL: …') when it is not a URL or uses an unsafe scheme.
 * Called from: resolveConfig()
 */
export function parseKiteUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid KITE_URL: "${raw}" is not a URL`);
  }
  const isLocalHttp = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(
      `Invalid KITE_URL: "${raw}" must use https (http is allowed for localhost only)`,
    );
  }
  return url;
}

/**
 * Works out the configuration from the environment and command line.
 *
 * @param env  Environment variables (process.env in the app; tests pass their own).
 * @param argv Command-line arguments (process.argv in the app).
 * @returns The URL to open and the allowed origins.
 * @throws Error('Invalid KITE_URL: …') when the chosen URL is not acceptable.
 * Called from: loadConfig(); tests
 */
export function resolveConfig(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): DesktopConfig {
  const fromFlag = argv.find((arg) => arg.startsWith(URL_FLAG))?.slice(URL_FLAG.length);
  const raw = env.KITE_URL || fromFlag || PRODUCTION_URL;
  const url = parseKiteUrl(raw);
  // An address given for testing allows only itself, so a test run never widens what is trusted.
  const allowedOrigins = PRODUCTION_ORIGINS.includes(url.origin)
    ? PRODUCTION_ORIGINS
    : [url.origin];
  return { kiteUrl: url.href, allowedOrigins };
}

/**
 * Reads the configuration for this run of the app.
 *
 * @returns The URL to open and the allowed origins.
 * @throws Error('Invalid KITE_URL: …') (main.ts shows it in a dialog and quits).
 * Called from: start() in src/main.ts
 */
export function loadConfig(): DesktopConfig {
  return resolveConfig(process.env, process.argv);
}
