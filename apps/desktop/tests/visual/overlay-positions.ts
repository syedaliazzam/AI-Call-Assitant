/**
 * File: apps/desktop/tests/visual/overlay-positions.ts
 * Purpose: 1.6.3 check (ADR-0075) of the overlay at its six positions in a real desktop shell: runs a
 *          simulated call against the overlay rig, opens an answer (and then the transcript too), puts
 *          the overlay at each position (the code path Ctrl+Alt+Arrows and the ⋮ grid share, goTo()) and
 *          nudges it on the bottom row (the code path Ctrl+Alt+Shift+Arrows shares, move()). For each it
 *          checks that the panels sit next to the bars with the same 6 px gap as on the top row, that the
 *          window is fitted to them (no empty band between the bars and a panel, on either row), and that
 *          bar 1's ⋮ and Exit are whole; it saves a picture of the overlay's page (page.screenshot: the
 *          page only, never the real screen). Prints PASS or FAIL per check.
 *          Usage: start the rig, `pnpm --filter @kite/desktop build`, then
 *                 `pnpm --filter web exec tsx ../desktop/tests/visual/overlay-positions.ts <out dir>`
 * Used by: the developer before a release (it needs a screen: the shell's windows appear on it)
 * Depends on: @playwright/test (_electron), the overlay rig (apps/web/tests/visual/overlay-rig.ts)
 * Architecture: ADR-0056 (positions), ADR-0075 (1.6.3 overlay fixes)
 *
 * Temporary profile; update checks off; no real keyboard input. All text is invented.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/** The rig's call page as the script drives it (apps/web/tests/visual/rig-live.tsx). */
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

/** The six positions, as the shell names them (ADR-0056). */
const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

/** Where the pictures go. */
const OUT = path.resolve(process.argv[2] ?? 'test-results/overlay-positions');

/** This checkout's apps/desktop. */
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The rig. */
const RIG = process.argv[3] || 'http://localhost:3123';

/** How many checks failed. */
let failures = 0;

/**
 * Waits.
 *
 * @param ms Milliseconds.
 * @returns When done.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Records one check.
 *
 * @param name   What was checked.
 * @param ok     Whether it held.
 * @param detail What was seen.
 */
function check(name: string, ok: boolean, detail: string): void {
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures += 1;
}

/** What the overlay's page shows, measured in it. */
interface Measured {
  /** 'top' or 'bottom' (the page's data-row). */
  row: string;
  /** The gap between the bars and the nearest panel, px. */
  gap: number;
  /** Empty page between the window's far edge and the farthest piece, px. */
  slack: number;
  /** True when ⋮ and Exit are whole inside bar 1 and the window. */
  barWhole: boolean;
}

/**
 * Measures the overlay's page (no named functions inside: tsx would wrap them in __name).
 *
 * @param overlay The overlay's page.
 * @returns What it shows.
 */
async function measure(overlay: Page): Promise<Measured> {
  return overlay.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.k-overlay-root')!;
    const up = root.dataset.row === 'bottom';
    const bars = [...document.querySelectorAll('[data-bars]')].map((e) =>
      e.getBoundingClientRect(),
    );
    const panels = [...document.querySelectorAll('[data-panel]')].map((e) =>
      e.getBoundingClientRect(),
    );
    const pieces = [...bars, ...panels];
    const height = window.innerHeight;
    const gap = up
      ? Math.min(...bars.map((b) => b.top)) - Math.max(...panels.map((b) => b.bottom))
      : Math.min(...panels.map((b) => b.top)) - Math.max(...bars.map((b) => b.bottom));
    const slack = up
      ? Math.min(...pieces.map((b) => b.top))
      : height - Math.max(...pieces.map((b) => b.bottom));
    const bar = document.querySelector('[aria-label="Overlay controls"]')!.getBoundingClientRect();
    const exit = document.querySelector('[aria-label="Exit: end call"]')!.getBoundingClientRect();
    const menu = document.querySelector('[aria-label="Overlay menu"]')!.getBoundingClientRect();
    const barWhole =
      exit.right <= Math.min(bar.right, window.innerWidth) &&
      menu.right <= exit.left &&
      menu.width >= 30;
    return { row: up ? 'bottom' : 'top', gap: Math.round(gap), slack: Math.round(slack), barWhole };
  });
}

/**
 * The overlay window's bounds and its display's work area.
 *
 * @param app The shell.
 * @returns Both, in DIPs.
 */
async function windowPlace(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/compact/'),
    )!;
    const bounds = win.getBounds();
    return { bounds, area: screen.getDisplayMatching(bounds).workArea };
  });
}

/**
 * Puts the overlay at each position, then nudges it on the bottom row, checking each.
 *
 * @param app     The shell.
 * @param overlay The overlay's page.
 * @param name    What the panels are, for the messages and pictures.
 * @returns When done (failures are counted, not thrown).
 */
async function checkPositions(app: ElectronApplication, overlay: Page, name: string) {
  for (const position of POSITIONS) {
    await overlay.evaluate((p) => window.kiteDesktop!.setOverlayPosition!(p), position);
    await wait(900);
    const seen = await measure(overlay);
    const { bounds, area } = await windowPlace(app);
    const label = `${name} @ ${position}`;
    check(`${label}: row`, seen.row === position.split('-')[0], seen.row);
    check(`${label}: 6 px between bars and panel`, seen.gap === 6, `${seen.gap} px`);
    check(`${label}: window fitted (no empty band)`, seen.slack <= 10, `${seen.slack} px spare`);
    check(`${label}: ⋮ and Exit whole`, seen.barWhole, String(seen.barWhole));
    // The bottom row keeps the window on the work area's bottom edge.
    if (position.startsWith('bottom')) {
      const bottom = bounds.y + bounds.height;
      check(
        `${label}: on the bottom edge`,
        Math.abs(area.y + area.height - bottom) <= 24,
        `bottom ${bottom}, work area ends ${area.y + area.height}`,
      );
    }
    await overlay.screenshot({ path: path.join(OUT, `${name}-${position}.png`) });
  }
  // Nudges on the bottom row: the window moves, keeps its position, and the panels stay on the bars.
  await overlay.evaluate(() => window.kiteDesktop!.setOverlayPosition!('bottom-center'));
  await wait(900);
  const before = (await windowPlace(app)).bounds;
  for (const [dx, dy] of [
    [0, -20],
    [0, -20],
    [20, 0],
    [-20, 0],
    [0, 20],
  ] as const) {
    await overlay.evaluate(([x, y]) => window.kiteDesktop!.moveOverlay!(x, y), [dx, dy] as const);
    await wait(400);
  }
  await wait(600);
  const after = (await windowPlace(app)).bounds;
  const seen = await measure(overlay);
  check(
    `${name}: nudges move the window`,
    after.y === before.y - 20 && after.x === before.x,
    `moved ${after.x - before.x}, ${after.y - before.y}`,
  );
  check(
    `${name}: still mirrored after nudges`,
    seen.row === 'bottom' && seen.gap === 6,
    `${seen.row}, ${seen.gap} px`,
  );
  check(`${name}: still fitted after nudges`, seen.slack <= 10, `${seen.slack} px spare`);
  await overlay.screenshot({ path: path.join(OUT, `${name}-bottom-nudged.png`) });
}

/** Runs the call, checks the positions, and closes the shell. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), 'kite-overlay-positions-'));
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
    for (const [speaker, words] of [
      ['them', 'HI THANKS FOR JOINING TODAY'],
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
    await wait(1_000);
    await checkPositions(app, overlay, 'answer');
    // Both panels (the shell widens the window for them).
    await overlay.getByRole('switch', { name: 'Transcript' }).click();
    await wait(1_000);
    await checkPositions(app, overlay, 'both');
  } finally {
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
}

void main().then(
  () => {
    console.info(`overlay-positions: ${failures} failed; pictures in ${OUT}`);
    if (failures > 0) process.exitCode = 1;
  },
  (error: unknown) => {
    console.error('overlay-positions: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
