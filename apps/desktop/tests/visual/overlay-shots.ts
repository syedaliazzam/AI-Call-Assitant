/**
 * File: apps/desktop/tests/visual/overlay-shots.ts
 * Purpose: v1.0.3 visual checks of the REAL overlay window: opens a real browser window with
 *          visible content behind it, starts the desktop shell (dev build) against the overlay rig
 *          (apps/web/tests/visual/overlay-rig.ts, http://localhost:3123), drives the overlay, and
 *          saves real screen captures (capture.ps1) of each state, so a person can look at them:
 *          see-through at 70% and 40%, the slider, expand and back, the script bar.
 *          Usage: start the rig, then `pnpm --filter desktop build` and
 *                 `pnpm --filter web exec tsx ../desktop/tests/visual/overlay-shots.ts <out dir>`
 * Used by: the developer before a release (not part of the automated suites: it needs a screen)
 * Depends on: @playwright/test (_electron), Microsoft Edge, PowerShell (capture.ps1)
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type Page } from '@playwright/test';

/** apps/desktop. */
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the captures go. */
const OUT = path.resolve(process.argv[2] ?? path.join(APP_DIR, 'test-results', 'overlay-shots'));

/** The page behind the overlay: a real site with plenty of text and images. */
const BACKDROP = 'https://en.wikipedia.org/wiki/Kite';

/**
 * Waits.
 *
 * @param ms Milliseconds.
 * @returns When done.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts the checks. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    // Its own profile: an installed Kite that is running keeps its single-instance lock.
    args: [
      APP_DIR,
      '--kite-url=http://localhost:3123',
      `--user-data-dir=${path.join(OUT, 'profile')}`,
    ],
    cwd: APP_DIR,
  });
  let overlay: Page | undefined;
  for (let i = 0; i < 60 && !overlay; i += 1) {
    overlay = app.windows().find((page) => page.url().includes('/compact/'));
    if (!overlay) await wait(500);
  }
  if (!overlay) throw new Error('The overlay did not open');
  const page = overlay;
  await page.waitForSelector('[aria-label="Overlay controls"]');
  // The real window behind the overlay: a browser window on a real page, covering the screen,
  // pinned above ordinary windows but below the overlay (which floats higher). So whatever else
  // is on the screen (the developer's own windows) never ends up in the captures.
  await app.evaluate(async ({ BrowserWindow, screen }, url) => {
    const area = screen.getPrimaryDisplay().workArea;
    const backdrop = new BrowserWindow({ ...area, title: 'Backdrop', show: true });
    backdrop.setAlwaysOnTop(true, 'normal');
    await backdrop.loadURL(url);
    const overlayWindow = BrowserWindow.getAllWindows().find((w) =>
      w.getTitle().includes('overlay'),
    );
    overlayWindow?.moveTop();
  }, BACKDROP);
  await wait(3_000);

  /**
   * Captures the overlay's rectangle (plus a margin, to show what is around it) from the screen.
   *
   * @param name The file name (without .png).
   */
  const shot = async (name: string) => {
    // The pointer away from the buttons, so no tooltip covers the capture.
    await page.mouse.move(40, 400);
    await wait(700);
    const { bounds, scale } = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('overlay'));
      return { bounds: win!.getBounds(), scale: screen.getPrimaryDisplay().scaleFactor };
    });
    const margin = 40;
    const rect = {
      x: Math.max(0, Math.round((bounds.x - margin) * scale)),
      y: Math.max(0, Math.round((bounds.y - margin) * scale)),
      w: Math.round((bounds.width + margin * 2) * scale),
      h: Math.round((bounds.height + margin * 2) * scale),
    };
    const file = path.join(OUT, `${name}.png`);
    execFileSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(APP_DIR, 'tests', 'visual', 'capture.ps1'),
      '-X',
      String(rect.x),
      '-Y',
      String(rect.y),
      '-W',
      String(rect.w),
      '-H',
      String(rect.h),
      '-Out',
      file,
    ]);
    console.info(
      `${name}: ${file} (window ${bounds.width}x${bounds.height} DIP at ${bounds.x},${bounds.y})`,
    );
  };

  /**
   * Sets the opacity slider (menu → slider), then closes the menu.
   *
   * @param value 0.4–1.
   */
  const setOpacity = async (value: number) => {
    await page.getByRole('button', { name: 'Overlay menu' }).click();
    await page.getByLabel('Overlay opacity').fill(String(value));
    await page.getByRole('button', { name: 'Overlay menu' }).click();
  };

  const steps = (process.env.SHOTS ?? 'default,40,100,expand,back,escape,min,mic,script').split(
    ',',
  );
  if (steps.includes('default')) await shot('01-default-70');
  if (steps.includes('40')) {
    await setOpacity(0.4);
    await shot('02-opacity-40');
  }
  if (steps.includes('100')) {
    await setOpacity(1);
    await shot('03-opacity-100');
    await setOpacity(0.7);
  }
  if (steps.includes('expand')) {
    await page.getByRole('button', { name: 'Expand the answer' }).click();
    await shot('04-expanded');
  }
  if (steps.includes('back')) {
    await page.getByRole('button', { name: 'Back to compact' }).first().click();
    await shot('05-back-to-compact');
  }
  if (steps.includes('escape')) {
    await page.getByRole('button', { name: 'Expand the answer' }).click();
    await page.keyboard.press('Escape');
    await shot('06-escape-returns');
  }
  if (steps.includes('min')) {
    // The narrowest the window allows: the key hints must still show.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('overlay'));
      const bounds = win!.getBounds();
      win!.setBounds({ ...bounds, width: 560 });
    });
    await shot('08-min-width-560');
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('overlay'));
      win!.setBounds({ ...win!.getBounds(), width: 640 });
    });
  }
  if (steps.includes('mic')) {
    await page.getByRole('button', { name: 'Speak a question' }).first().click();
    await shot('09-overlay-mic-listening');
    await page.getByRole('button', { name: 'Stop listening' }).first().click();
  }
  if (steps.includes('script')) {
    await page.getByRole('button', { name: 'Overlay menu' }).click();
    await page.getByRole('button', { name: 'Script bar' }).click();
    await wait(1_000);
    await shot('07-script-bar');
  }
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
