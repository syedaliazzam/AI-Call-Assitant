/**
 * File: apps/desktop/scripts/dist-win.mjs
 * Purpose: Builds the Windows installer under the Windows version number (Windows 1.7.5, ADR-0127). The Mac and
 *          Windows apps are built from the same code but numbered apart: Mac went to 1.8.0 with its first release
 *          (ADR-0109) while Windows stayed on 1.7.x, and each update channel only compares with its own versions.
 *          "version" in apps/desktop/package.json is the Mac's (build.sh reads it); "windowsVersion" is the
 *          Windows one, written into the installed app's package.json here (electron-builder
 *          -c.extraMetadata.version, as build.sh does for --version), so the app, its installer name and its
 *          latest.yml all say 1.7.5.
 * Used by: the "dist:win" script in apps/desktop/package.json (and so .github/workflows/install-check.yml)
 * Depends on: Node's child_process, fs, path, url; electron-builder (a dev dependency)
 * Architecture: docs/decisions/ADR-0127-desktop-1.8.1-1.7.5-keys-updates-screens.md §6
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The desktop app's folder (this script lives in its scripts/ folder). */
const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** apps/desktop/package.json. */
const manifest = JSON.parse(readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));

/** The Windows version; a plain X.Y.Z only (a pre-release version would go on another update channel). */
const version = manifest.windowsVersion;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('dist-win: "windowsVersion" in apps/desktop/package.json must look like 1.7.5');
  process.exit(1);
}
console.log(`dist-win: building the Windows installer as version ${version}`);

// shell: true so Windows finds pnpm's .cmd shim; every argument is fixed or checked above.
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'electron-builder',
    '--win',
    '--publish',
    'never',
    `-c.extraMetadata.version=${version}`,
  ],
  { cwd: DESKTOP, stdio: 'inherit', shell: true },
);
process.exit(result.status ?? 1);
