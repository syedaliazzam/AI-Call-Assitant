/**
 * Upgrade test (v1.2.0, spec §2): the real 1.1.0 program, then the real 1.2.0 program, on one temporary
 * profile and one fixed address, as the same person's computer would have them. 1.1.0 stores invented
 * sessions and settings, a sign-in cookie, and turns protection on. After 1.2.0 opens the same profile,
 * all of it must still be there, and the program must say Paramount AI. Where an installed app keeps its
 * data with no profile passed is covered by config.test.ts: running that here would open the real folder.
 *
 * It never runs an installer: on a computer with the app installed, an installer would replace the real
 * app, its registry entries and what paramountai:// opens. The 1.1.0 program comes from its real
 * installer, extracted to a temporary folder. All text is invented.
 *
 * For a later release, KITE_OLD_VERSION and KITE_NEW_VERSION name the two versions (1.3.0: the real
 * 1.2.0 program, then 1.3.0).
 *
 * Manual run: it needs both programs. Usage: KITE_OLD_SHELL_EXE=<the extracted Kite.exe>
 * KITE_INSTALLED_EXE=<release/win-unpacked/Paramount AI.exe> pnpm --filter @kite/desktop exec playwright
 * test -c playwright.manual.config.ts upgrade.spec.ts
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/** The 1.1.0 program. */
const OLD_EXE = process.env.KITE_OLD_SHELL_EXE;

/** The 1.2.0 program. */
const NEW_EXE = process.env.KITE_INSTALLED_EXE;

/** The old program's version (1.1.0 by default; 1.2.0 for the 1.3.0 release, ADR-0052). */
const OLD_VERSION = process.env.KITE_OLD_VERSION ?? '1.1.0';

/** The new program's version (1.2.0 by default; 1.3.0 for the 1.3.0 release). */
const NEW_VERSION = process.env.KITE_NEW_VERSION ?? '1.2.0';

/** One fixed address: browser storage belongs to an address, so both programs must use the same. */
const PORT = 3177;

/** The address. */
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** What the page in the test window can reach. */
interface ShellWindow {
  /** The bridge. */
  kiteDesktop: {
    /**
     * Reads the protection state.
     *
     * @returns The state.
     */
    getShareProtection: () => Promise<{
      /** True when protection is on. */
      on: boolean;
    }>;
    /**
     * Turns protection on or off.
     *
     * @param on True for on.
     * @returns The new state.
     */
    setShareProtection: (on: boolean) => Promise<unknown>;
  };
}

/**
 * Starts a program on a profile.
 *
 * @param exe     The program.
 * @param profile The profile folder.
 * @returns The running app.
 */
function launch(exe: string, profile: string): Promise<ElectronApplication> {
  // ELECTRON_RUN_AS_NODE would make it plain Node.js (the editor sets it for its children).
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  return electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${profile}`],
    env: {
      ...parentEnv,
      KITE_URL: `${ORIGIN}/`,
      KITE_TEST_NO_EXTERNAL_OPEN: '1',
      KITE_NO_UPDATE_CHECK: '1',
    },
  });
}

let server: Server;
let profile = '';

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'kite-upgrade-'));
  // A page with nothing of its own: this test is about what the shell keeps, not what it shows.
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><h1>Upgrade test page</h1>');
  });
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  server?.close();
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test(`${OLD_VERSION} to ${NEW_VERSION} keeps sessions, settings, sign-in and the protection setting`, async () => {
  test.skip(!OLD_EXE || !NEW_EXE, 'KITE_OLD_SHELL_EXE and KITE_INSTALLED_EXE name the programs');

  // ---- 1.1.0 stores what a person would have ----
  const before = await launch(OLD_EXE!, profile);
  expect(await before.evaluate(({ app }) => app.getVersion())).toBe(OLD_VERSION);
  const first = await before.firstWindow();
  await first.waitForLoadState('domcontentloaded');
  await first.evaluate(async () => {
    localStorage.setItem('kite.theme', 'dark');
    localStorage.setItem('kite.hint.acceptableUse', 'seen');
    document.cookie = 'better-auth.session_token=invented; max-age=86400; path=/';
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('kite', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('sessions', { keyPath: 'id' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const write = open.result.transaction('sessions', 'readwrite');
        write.objectStore('sessions').put({ id: 'one', company: 'Lantern Freight (invented)' });
        write.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
  });
  await first.evaluate(() =>
    (window as unknown as ShellWindow).kiteDesktop.setShareProtection(true),
  );
  await before.close();
  const settingsFile = path.join(profile, 'kite-shell.json');
  expect(existsSync(settingsFile), 'the old program saved its settings').toBe(true);
  const savedBefore = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;

  // ---- 1.2.0 opens the same profile ----
  const after = await launch(NEW_EXE!, profile);
  try {
    expect(await after.evaluate(({ app }) => app.getVersion())).toBe(NEW_VERSION);
    // The new name is on the program and its window. (app.getName() stays "kite": it comes from the
    // package name, which keeps the install folder, and nothing shows it.)
    expect(path.basename(NEW_EXE!)).toBe('Paramount AI.exe');
    const page = await after.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect
      .poll(() =>
        after.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle()),
      )
      .toBe('Paramount AI');

    // The protection setting, as the shell reports it.
    const protection = await page.evaluate(() =>
      (window as unknown as ShellWindow).kiteDesktop.getShareProtection(),
    );
    expect(protection.on, 'protection stays on').toBe(true);

    // Settings, sessions, the sign-in cookie: everything the person had.
    const kept = await page.evaluate(async () => {
      const company = await new Promise<string | undefined>((resolve, reject) => {
        const open = indexedDB.open('kite');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction('sessions').objectStore('sessions').get('one');
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            open.result.close();
            resolve((read.result as { company?: string } | undefined)?.company);
          };
        };
      });
      return {
        company,
        theme: localStorage.getItem('kite.theme'),
        notice: localStorage.getItem('kite.hint.acceptableUse'),
        cookie: document.cookie,
      };
    });
    expect(kept).toEqual({
      company: 'Lantern Freight (invented)',
      theme: 'dark',
      notice: 'seen',
      cookie: expect.stringContaining('better-auth.session_token=invented'),
    });
    await after.close();
    const savedAfter = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
    for (const [key, value] of Object.entries(savedBefore)) {
      expect(savedAfter[key], `the setting ${key} survives`).toEqual(value);
    }
  } finally {
    await after.close().catch(() => undefined);
  }
});
