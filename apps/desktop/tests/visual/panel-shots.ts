/**
 * File: apps/desktop/tests/visual/panel-shots.ts
 * Purpose: v1.3.2 visual check of the live panels: runs a simulated call in a desktop shell against an
 *          overlay rig, opens both panels with a few invented lines and one answer, and saves a picture
 *          of the overlay's page (page.screenshot: the page only, never the real screen), in the dark and
 *          light call themes. Run it against this checkout and against an older one (another worktree and
 *          rig port) to get before and after pictures.
 *          Usage: `pnpm --filter web exec tsx ../desktop/tests/visual/panel-shots.ts <out dir> [app dir] [rig url]`
 * Used by: the developer before a release
 * Depends on: @playwright/test (_electron)
 * Architecture: ADR-0061
 *
 * Temporary profile; update checks off. All text is invented.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type Page } from '@playwright/test';

/** The rig's call page as the test drives it (tests/visual/rig-live.tsx). */
interface RigWindow {
  /** The rig's controls. */
  rig: {
    /**
     * Feeds a line as the speech engine would.
     *
     * @param speaker Who speaks.
     * @param text    The words.
     */
    say: (speaker: 'you' | 'them', text: string) => void;
  };
}

/** Where the pictures go. */
const OUT = path.resolve(process.argv[2] ?? 'test-results/panel-shots');

/** The shell to run (default: this checkout's apps/desktop). */
const APP_DIR = path.resolve(
  process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
);

/** The rig. */
const RIG = process.argv[4] || 'http://localhost:3123';

/**
 * Waits.
 *
 * @param ms Milliseconds.
 * @returns When done.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the call, saves the pictures, and closes the shell. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), 'kite-panel-shots-'));
  // Set when this runs from an editor built on Electron: it would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const app = await electron.launch({
    args: [APP_DIR, `--kite-url=${RIG}`, `--user-data-dir=${profile}`],
    cwd: APP_DIR,
    env: { ...(env as Record<string, string>), KITE_NO_UPDATE_CHECK: '1' },
  });
  try {
    const panel = await app.firstWindow();
    await panel.waitForLoadState();
    await panel.evaluate(() => window.kiteDesktop!.openPagesWindow!('/'));
    let overlay: Page | undefined;
    let call: Page | undefined;
    for (let i = 0; i < 60 && (!overlay || !call); i += 1) {
      overlay ??= app.windows().find((page) => page.url().includes('/compact/'));
      call ??= app.windows().find((page) => new URL(page.url()).pathname === '/' && page !== panel);
      if (!overlay || !call) await wait(500);
    }
    if (!overlay || !call) throw new Error('The overlay or the call did not open');
    await overlay.waitForSelector('[aria-label="Overlay controls"]');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('/compact/'))!
        .setBounds({ x: 80, y: 40, width: 1080, height: 540 });
    });
    await overlay.getByRole('switch', { name: 'Transcript' }).click();
    // One line at a time from here (no named helper inside evaluate: tsx would wrap it in __name,
    // which the page does not have).
    for (const [speaker, words] of [
      ['them', 'HI THANKS FOR JOINING TODAY'],
      ['them', 'WE HAVE ABOUT THIRTY MINUTES'],
      ['you', 'great happy to be here'],
      ['them', 'HOW DO YOU KEEP LATENCY LOW'],
    ] as const) {
      await call.evaluate(([who, text]) => (window as unknown as RigWindow).rig.say(who, text), [
        speaker,
        words,
      ] as const);
      await wait(300);
    }
    await overlay.getByRole('button', { name: 'Answer', exact: true }).click();
    await overlay
      .getByLabel('Latest answer')
      .getByText('Regional deployment', { exact: false })
      .waitFor({ timeout: 15_000 });
    await wait(1_500);
    for (const theme of ['dark', 'light'] as const) {
      await overlay.evaluate((choice) => {
        localStorage.setItem('kite.callTheme', choice);
        window.dispatchEvent(new StorageEvent('storage', { key: 'kite.callTheme' }));
      }, theme);
      await wait(800);
      await overlay.screenshot({ path: path.join(OUT, `live-panels-${theme}.png`) });
    }
  } finally {
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
}

void main().then(
  () => console.info(`panel-shots: saved in ${OUT}`),
  (error: unknown) => {
    console.error('panel-shots: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
