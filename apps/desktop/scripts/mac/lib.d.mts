/**
 * File: apps/desktop/scripts/mac/lib.d.mts
 * Purpose: TypeScript types for scripts/mac/lib.mjs (plain JavaScript, so the Mac scripts run with Node
 *          alone), so the unit tests are type-checked against it.
 * Used by: tests/unit/macScripts.test.ts
 * Depends on: scripts/mac/lib.mjs
 * Architecture: docs/decisions/ADR-0109-macos-internal-release.md
 */

/** One file listed in latest-mac.yml. */
export interface UpdateFile {
  /** The file's name in the release (the zip, the dmg). */
  url: string;
  /** Its SHA-512, base64. */
  sha512: string;
  /** Its size in bytes. */
  size: number;
}

/** What the scripts read from latest-mac.yml. */
export interface UpdateInfo {
  /** The app's version, for example '1.8.0'. */
  version: string;
  /** The main file (the zip the updater downloads). */
  path: string;
  /** The main file's SHA-512, base64. */
  sha512: string;
  /** Every listed file. */
  files: UpdateFile[];
}

/**
 * Reads latest-mac.yml as electron-builder writes it.
 *
 * @param text The file's text.
 * @returns The version, main file, its SHA-512 and every listed file.
 * Called from: publish-mac.mjs; tests
 */
export function readUpdateInfo(text: string): UpdateInfo;

/**
 * A file's SHA-512 in base64.
 *
 * @param filePath The file.
 * @returns The hash.
 * Called from: publish-mac.mjs; tests
 */
export function sha512Base64(filePath: string): Promise<string>;

/**
 * The bridge signing rule for a later Developer ID switch.
 *
 * @param certificateSha1 Our certificate's SHA-1.
 * @param teamId          The Apple Team ID.
 * @returns The requirements file's text.
 * Called from: cert-tools.mjs rule; tests
 */
export function bridgeSigningRule(certificateSha1: string, teamId: string): string;

/**
 * Reads one HTTP byte range.
 *
 * @param header The Range header, if any.
 * @param size   The file's size.
 * @returns The inclusive range, null for the whole file, or 'invalid'.
 * Called from: serve-test-feed.mjs; tests
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid';
