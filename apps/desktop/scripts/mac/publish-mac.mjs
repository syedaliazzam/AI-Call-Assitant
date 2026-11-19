/**
 * File: apps/desktop/scripts/mac/publish-mac.mjs
 * Purpose: Publishes a Mac build to the Mac app's own update channel (ADR-0109 §3): the fixed release tag
 *          `mac-latest` in Zainpak123/kite-releases, marked as a pre-release so it is never GitHub's
 *          "latest" release (the Windows updater and the download links read that one).
 *          Steps:
 *            1. checks the folder: latest-mac.yml, the zip it names (SHA-512 must match), its .blockmap and
 *               the .dmg of the same version;
 *            2. creates `mac-latest` if it does not exist yet;
 *            3. uploads the zip, the blockmap and the dmg (replacing files of the same name);
 *            4. uploads latest-mac.yml LAST, so the updater never sees a version whose zip is not there;
 *            5. removes the previous version's files from `mac-latest`.
 *          Usage: node apps/desktop/scripts/mac/publish-mac.mjs <folder> [--dry-run]
 *          Only after the real-Mac test passes (docs/testing/mac-release-test.md).
 * Used by: the developer, at a Mac release; not part of the automated suites
 * Depends on: the GitHub CLI (gh; signed in as the releases repository's owner; on the developer's laptop
 *             at C:\Program Files\GitHub CLI\gh.exe, or set GH=<path>), node:child_process, node:fs,
 *             scripts/mac/lib.mjs
 * Architecture: docs/decisions/ADR-0109-macos-internal-release.md §3
 *
 * Prints file names, sizes, the version and outcomes only.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readUpdateInfo, sha512Base64 } from './lib.mjs';

/** The releases-only repository the installed apps update from (ADR-0028). */
const REPO = 'Zainpak123/kite-releases';
/** The Mac channel's fixed tag (electron-builder.yml mac.publish, install-mac.sh). */
const TAG = 'mac-latest';

/**
 * The GitHub CLI to run: GH if set, else the Windows install path when it exists, else `gh` on PATH.
 *
 * @returns {string} The program.
 */
function ghProgram() {
  if (process.env.GH) return process.env.GH;
  const windows = 'C:\\Program Files\\GitHub CLI\\gh.exe';
  return existsSync(windows) ? windows : 'gh';
}

/**
 * Runs gh and returns what it printed.
 *
 * @param {string[]} args The arguments.
 * @returns {string} Its output.
 */
function gh(args) {
  return execFileSync(ghProgram(), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Checks the build folder and returns the files to publish, in upload order.
 *
 * @param {string} folder The folder with the build.
 * @returns {Promise<{ version: string, uploads: string[], yml: string }>} The version, the files to upload
 *          before the update file, and the update file.
 * @throws Error describing the first problem found.
 */
async function checkFolder(folder) {
  const yml = path.join(folder, 'latest-mac.yml');
  if (!existsSync(yml)) throw new Error('no latest-mac.yml in that folder');
  const info = readUpdateInfo(readFileSync(yml, 'utf8'));
  const zip = path.join(folder, info.path);
  if (!info.path.endsWith('.zip') || !existsSync(zip)) {
    throw new Error(`latest-mac.yml names ${info.path}, which is not a zip in that folder`);
  }
  if ((await sha512Base64(zip)) !== info.sha512) {
    throw new Error(`${info.path} does not match the SHA-512 in latest-mac.yml`);
  }
  const blockmap = `${zip}.blockmap`;
  if (!existsSync(blockmap)) throw new Error(`no ${path.basename(blockmap)}`);
  const dmg = path.join(folder, `Paramount-AI-${info.version}-universal.dmg`);
  if (!existsSync(dmg)) throw new Error(`no ${path.basename(dmg)}`);
  return { version: info.version, uploads: [zip, blockmap, dmg], yml };
}

/**
 * Checks, then publishes (or, with --dry-run, says what it would do).
 *
 * @param {string[]} args The command line after the script's name.
 * @returns {Promise<number>} The exit code.
 */
async function main(args) {
  const folder = args.find((arg) => !arg.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  if (!folder) {
    console.error('usage: node publish-mac.mjs <folder with the Mac build> [--dry-run]');
    return 2;
  }
  const { version, uploads, yml } = await checkFolder(path.resolve(folder));
  console.log(`Paramount AI ${version} for Mac: checks passed`);
  for (const file of [...uploads, yml]) {
    console.log(`  ${path.basename(file)} (${statSync(file).size} bytes)`);
  }
  const keep = new Set([...uploads, yml].map((file) => path.basename(file)));
  if (dryRun) {
    console.log(
      `dry run: would upload these to ${REPO} ${TAG} (update file last) and remove older files`,
    );
    return 0;
  }
  let exists = true;
  try {
    gh(['release', 'view', TAG, '-R', REPO, '--json', 'tagName']);
  } catch {
    exists = false;
  }
  if (!exists) {
    // A pre-release is never GitHub's "latest" release, which the Windows updater and download links use.
    gh([
      'release',
      'create',
      TAG,
      '-R',
      REPO,
      '--prerelease',
      '--title',
      'Paramount AI for Mac',
      '--notes',
      'The current Mac version. Install: see Paramount AI → Download for Mac.',
    ]);
    console.log(`created ${TAG} (pre-release)`);
  }
  gh(['release', 'upload', TAG, ...uploads, '-R', REPO, '--clobber']);
  console.log('uploaded the zip, blockmap and dmg');
  gh(['release', 'upload', TAG, yml, '-R', REPO, '--clobber']);
  console.log('uploaded latest-mac.yml (the update is now live for Macs)');
  const listed = JSON.parse(gh(['release', 'view', TAG, '-R', REPO, '--json', 'assets'])).assets;
  for (const asset of listed) {
    if (keep.has(asset.name)) continue;
    gh(['release', 'delete-asset', TAG, asset.name, '-R', REPO, '--yes']);
    console.log(`removed ${asset.name}`);
  }
  gh([
    'release',
    'edit',
    TAG,
    '-R',
    REPO,
    '--notes',
    `Paramount AI ${version} for Mac (the current Mac version).`,
  ]);
  console.log('done');
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`publish-mac: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
