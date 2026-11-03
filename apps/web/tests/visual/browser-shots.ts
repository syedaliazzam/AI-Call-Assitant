/**
 * File: apps/web/tests/visual/browser-shots.ts
 * Purpose: v1.0.4 checks of the browser's full call view: the simulated call of rig-live.tsx in the
 *          browser layout (/?layout=browser), in real Microsoft Edge: the top bar, a solid control
 *          strip, no page scroll, and the picture-in-picture round trip: Back to compact opens the
 *          overlay in its own window, and its ⛶ closes it again. Captures the page only (never the
 *          screen) and prints PASS or FAIL for each check.
 *          Usage: start the rig (overlay-rig.ts), then
 *                 `pnpm --filter web exec tsx tests/visual/browser-shots.ts <out dir>`
 * Used by: the developer before a release (not part of the automated suites: it opens a window)
 * Depends on: @playwright/test, Microsoft Edge
 * Architecture: docs/decisions/ADR-0040-full-call-window-and-one-entry-per-question.md
 *
 * All text is invented.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

/** Where the capture goes. */
const OUT = path.resolve(process.argv[2] ?? 'test-results/browser-shots');

/** The rig page's controls (window.rig in rig-live.tsx). */
interface RigPage {
  /** The controls. */
  rig: {
    /**
     * Feeds a line as the speech engine would.
     *
     * @param speaker 'them' or 'you'.
     * @param text    The words.
     * @param final   False for words still being heard.
     */
    say: (speaker: string, text: string, final?: boolean) => void;
  };
}

/** How many checks failed. */
let failures = 0;

/**
 * Records one check.
 *
 * @param name   What was checked.
 * @param ok     Whether it held.
 * @param detail What was seen, when it did not.
 */
function check(name: string, ok: boolean, detail = ''): void {
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures += 1;
}

/** Starts the checks. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto('http://localhost:3123/?layout=browser');
  await page.waitForSelector('[aria-label="Call controls"]');
  await page.evaluate(() => {
    (window as unknown as RigPage).rig.say(
      'them',
      'SO HOW WOULD YOU DESIGN A VOICE AGENT FOR A HOSPITAL',
    );
  });
  await page
    .getByRole('button', { name: /^Answer/ })
    .first()
    .click();
  await page.waitForTimeout(2_500);

  const strip = await page.getByRole('button', { name: 'Stop' }).evaluate((button) => {
    const color = getComputedStyle(button.parentElement!).backgroundColor;
    return color.match(/[\d.]+/g)!.map(Number);
  });
  check('item 6: the control strip over the preview is solid', strip.length === 3, String(strip));
  check(
    'item 6: nothing in the browser call view is glass',
    (await page.locator('.k-glass').count()) === 0,
  );
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollHeight,
    window.innerHeight,
  ]);
  check('item 2: the page itself does not scroll', scroll[0]! <= scroll[1]! + 1, String(scroll));
  check(
    'item 2: the top bar and the end button are there',
    (await page.getByRole('toolbar', { name: 'Call controls' }).count()) === 1 &&
      (await page.getByRole('button', { name: 'End', exact: true }).count()) === 1,
  );
  check(
    'item 2: the message box and big buttons are in view',
    await page
      .getByRole('button', { name: /^Screenshot .*Ctrl/ })
      .evaluate((button) => button.getBoundingClientRect().bottom <= window.innerHeight),
  );
  await page.screenshot({ path: path.join(OUT, '11-browser-call-view.png') });

  // The round trip through picture-in-picture.
  const opening = context.waitForEvent('page', { timeout: 6_000 }).catch(() => null);
  await page.getByRole('button', { name: 'Back to compact' }).click();
  const pip = await opening;
  check('item 1: Back to compact opens the picture-in-picture overlay', pip !== null);
  if (pip) {
    await pip.waitForSelector('[aria-label="Overlay controls"]');
    await pip.waitForTimeout(800);
    check(
      'item 6: picture-in-picture stays solid',
      (await pip.locator('.k-overlay').count()) === 1 &&
        (await pip.locator('.k-glass').count()) === 0,
    );
    const closed = pip.waitForEvent('close', { timeout: 6_000 }).then(
      () => true,
      () => false,
    );
    await pip.getByRole('button', { name: 'Open call window' }).click();
    check('item 1: ⛶ closes picture-in-picture, leaving the full view in the tab', await closed);
  }
  await browser.close();
  console.info(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
