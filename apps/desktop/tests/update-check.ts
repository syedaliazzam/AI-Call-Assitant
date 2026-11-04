/**
 * File: apps/desktop/tests/update-check.ts
 * Purpose: Checks that an older installed Kite really finds, downloads and verifies a new release, on a
 *          kept copy of the old app and a temporary profile. It stops once the app reports the download:
 *          nothing is installed and the person's installed Kite and real profile are not touched.
 *          Usage: node --experimental-strip-types apps/desktop/tests/update-check.ts <kept Kite.exe> [<folder>]
 *          With a folder, the release in it is served locally and only the kept copy's
 *          resources/app-update.yml is pointed at it; without one, the copy's own feed is used (the real
 *          releases repository). Either way the download goes to %LOCALAPPDATA%\kite-updater-check,
 *          removed at the end, and the copy's setting is put back. To take the path an installed copy
 *          really takes, first put the older release's installer there as installer.exe: the update
 *          then fetches only the blocks that changed.
 * Used by: the developer at a release (v1.1.0 item 32); not part of the automated suites
 * Depends on: Node.js only
 * Architecture: docs/decisions/ADR-0028 (updates)
 *
 * Prints versions and outcomes only.
 */
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const [, , exe, folder] = process.argv;
if (!exe) throw new Error('Name the kept Kite.exe');

/** The kept copy's update feed setting. */
const feedFile = path.join(path.dirname(exe), 'resources', 'app-update.yml');

/** The feed setting as it was installed, so the copy can be put back. */
const feedBackup = `${feedFile}.original`;
if (!existsSync(feedBackup)) copyFileSync(feedFile, feedBackup);

/** How long the check may take, in ms: the download is about 126 MB. */
const TIME_LIMIT_MS = 8 * 60_000;

let server: ReturnType<typeof createServer> | null = null;
if (folder) {
  server = createServer((req, res) => {
    const name = path.basename(decodeURIComponent((req.url ?? '/').split('?')[0]!));
    const file = path.join(folder, name);
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  writeFileSync(
    feedFile,
    `provider: generic\nurl: http://127.0.0.1:${port}/\nupdaterCacheDirName: kite-updater-check\n`,
  );
  console.info(`feed: this computer, serving ${path.basename(folder)}`);
} else {
  // The real feed, with a cache folder of its own. The default folder is the installed Kite's: a
  // newer installer found there would hide the download, and this check must leave nothing in it.
  writeFileSync(
    feedFile,
    readFileSync(feedBackup, 'utf8').replace(
      /^updaterCacheDirName:.*$/m,
      'updaterCacheDirName: kite-updater-check',
    ),
  );
  console.info('feed: the real releases repository');
}

const profile = mkdtempSync(path.join(tmpdir(), 'kite-update-check-'));
const { ELECTRON_RUN_AS_NODE: _runAsNode, KITE_NO_UPDATE_CHECK: _noCheck, ...env } = process.env;
const app = spawn(exe, [`--user-data-dir=${profile}`], {
  // A page that needs no sign-in: this checks the shell only.
  env: {
    ...env,
    KITE_URL: 'https://kite-call-assistant.vercel.app/',
    ELECTRON_ENABLE_LOGGING: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

/**
 * Ends the run.
 *
 * @param outcome What happened.
 * @param failed  True when the check failed.
 */
function finish(outcome: string, failed: boolean): void {
  console.info(outcome);
  // A hard stop on purpose: a normal quit would install the update.
  spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', () => {
    server?.close();
    copyFileSync(feedBackup, feedFile);
    // The download this check made, so it cannot be used by anything else.
    rmSync(path.join(homedir(), 'AppData', 'Local', 'kite-updater-check'), {
      recursive: true,
      force: true,
    });
    process.exit(failed ? 1 : 0);
  });
}

const timer = setTimeout(() => finish('FAILED: nothing downloaded in time', true), TIME_LIMIT_MS);
for (const stream of [app.stdout, app.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (text: string) => {
    const downloaded = /\[kite\] update (\S+) downloaded \(running (\S+)\)/.exec(text);
    if (downloaded) {
      clearTimeout(timer);
      finish(
        `PASS: ${downloaded[2]} found and downloaded ${downloaded[1]}, and verified it`,
        false,
      );
      return;
    }
    const failed = /\[kite\] update check failed: (\S+)/.exec(text);
    if (failed) {
      clearTimeout(timer);
      finish(`FAILED: the update check said ${failed[1]}`, true);
    }
  });
}
