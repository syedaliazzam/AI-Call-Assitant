/**
 * Harness test for the launch flow (spec S8, S9, S10, S12), no sign-in, runs in CI. In a real browser:
 * Choose platform (both choices, the difference, a phone), and the hand-off page with its paramountai://
 * link carrying a one-time code (ADR-0052). Every account has account sync (ADR-0092), so no session
 * file is saved or asked for any more. All text is invented. Set KITE_SCREENSHOT_DIR to save screenshots.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { brandFonts } from '../lib/fonts';
import { settleAnimations } from '../lib/motion';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** An invented one-time code in the shape the server makes (43 URL-safe characters). */
const CODE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';

/** Where to save screenshots, or '' for none. */
const SHOT_DIR = process.env.KITE_SCREENSHOT_DIR ?? '';

/** The part of postcss used here (not a direct dependency, so its types are not imported). */
type PostcssRunner = (plugins: unknown[]) => {
  /** Runs the plugins over a stylesheet. */
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};

let bundleDir = '';
let server: Server | null = null;
let browser: Browser | null = null;
let origin = '';
let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-handoff-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'handoff.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    alias: {
      'next/link': path.join(WEB_DIR, 'tests', 'integration', 'harness', 'next-link-stub.tsx'),
      'next/navigation': path.join(
        WEB_DIR,
        'tests',
        'integration',
        'harness',
        'next-navigation-stub.ts',
      ),
    },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  const fromTailwind = createRequire(
    createRequire(import.meta.url).resolve('@tailwindcss/postcss'),
  );
  const postcss = fromTailwind('postcss') as PostcssRunner;
  const from = path.join(WEB_DIR, 'app', 'globals.css');
  const css = await postcss([tailwind({ base: WEB_DIR })]).process(readFileSync(from, 'utf8'), {
    from,
  });
  writeFileSync(path.join(bundleDir, 'handoff.css'), css.css);
  server = createServer((req, res) => {
    if (req.url === '/harness/handoff.js' || req.url === '/harness/handoff.css') {
      const isCss = req.url.endsWith('.css');
      res.writeHead(200, { 'Content-Type': isCss ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, isCss ? 'handoff.css' : 'handoff.js')));
      return;
    }
    if (req.url === '/images/green-logo-lockup.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(readFileSync(path.join(WEB_DIR, 'public', 'images', 'green-logo-lockup.png')));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html data-theme="' +
        (process.env.KITE_VISUAL_THEME ?? 'light') +
        '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hand-off harness</title>' +
        '<link rel="stylesheet" href="/harness/handoff.css">' +
        brandFonts() +
        '</head>' +
        '<body class="bg-ui-bg font-sans text-[16px] leading-6 text-ui-text"><div id="root"></div>' +
        '<script type="module" src="/harness/handoff.js"></script></body></html>',
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

test.afterEach(async () => {
  await context.close();
});

/**
 * Opens the harness in a fresh browser profile.
 *
 * @param width  The window's width.
 */
async function open(width = 1440): Promise<void> {
  context = await browser!.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1.5,
    acceptDownloads: true,
    hasTouch: width < 500,
  });
  page = await context.newPage();
  if (process.env.KITE_VISUAL_THEME) {
    await page.addInitScript(
      (theme) => localStorage.setItem('kite.theme', theme),
      process.env.KITE_VISUAL_THEME,
    );
  }
  // Records every paramountai:// link followed, instead of leaving the page.
  await page.addInitScript(() => {
    const links: string[] = [];
    window.followed = links;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      if (this.href.startsWith('paramountai:')) links.push(this.href);
      else realClick.call(this);
    };
  });
  await page.goto(origin);
  await page.waitForFunction(() => 'kiteHandoffHarness' in window);
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Saves a screenshot when asked to.
 *
 * @param name The file's name.
 */
async function shot(name: string): Promise<void> {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * The paramountai:// links followed so far.
 *
 * @returns The links.
 */
const followed = () => page.evaluate(() => window.followed);

test('Choose platform: the words, the difference, and the browser choice', async () => {
  await open();
  await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.evaluate(() => window.kiteHandoffHarness.showDashboard());
  await page.getByRole('button', { name: 'Start session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose platform' });
  await expect(dialog).toContainText('Where do you want to run this call?');
  // v1.3.1: measured once the modal has finished scaling in from 98 % (ADR-0058).
  await settleAnimations(page);
  expect((await dialog.boundingBox())!.width).toBeCloseTo(440, 0);
  await shot('choose-platform');
  await dialog.getByRole('button', { name: 'What’s the difference?' }).click();
  await expect(dialog).toContainText('Hidden from screen share, global hotkeys');
  await expect(dialog).toContainText('No install, needs a shared tab.');
  await shot('choose-platform-difference');
  await dialog.getByRole('button', { name: 'Open in browser' }).click();
  await expect
    .poll(() => page.evaluate(() => window.kiteHandoffHarness.pushed()))
    .toMatch(/^\/live\//);
});

test('on a phone the desktop app says it needs a computer', async () => {
  await open(390);
  await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.evaluate(() => window.kiteHandoffHarness.showDashboard());
  await page.getByRole('button', { name: 'Start session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose platform' });
  await expect(dialog.getByRole('button', { name: 'Needs a computer' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Desktop app' })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Open in browser' })).toBeEnabled();
  await shot('choose-platform-phone');
});

test('choosing the desktop app goes to the hand-off page and saves no file (ADR-0092)', async () => {
  await open();
  const id = await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.evaluate(() => window.kiteHandoffHarness.showDashboard());
  await page.getByRole('button', { name: 'Start session' }).click();
  let downloads = 0;
  page.on('download', () => {
    downloads += 1;
  });
  await page.getByRole('button', { name: 'Desktop app' }).click();
  await expect
    .poll(() => page.evaluate(() => window.kiteHandoffHarness.pushed()))
    .toBe(`/sessions/${id}/desktop`);
  expect(downloads).toBe(0);
});

test('the hand-off page: the link with a one-time code, its button, the download and the way back', async () => {
  await open();
  const id = await page.evaluate(() => window.kiteHandoffHarness.seed());
  // ADR-0052: the page asks the server for a one-time code for each press (faked here).
  let asked = 0;
  await page.route('**/api/desktop/link-code', async (route) => {
    asked += 1;
    await route.fulfill({ json: { code: CODE, expiresAt: Date.now() + 60_000 } });
  });
  await page.evaluate((session) => window.kiteHandoffHarness.showHandoff(session), id);
  await expect(page.getByText('Open Paramount AI')).toBeVisible();
  await expect(page.getByText('No prompt? Use the button below.')).toBeVisible();
  await expect.poll(followed).toEqual([`paramountai://session/${id}/${CODE}`]);
  // No session file any more (ADR-0092): nothing to save again.
  await expect(page.getByRole('button', { name: 'Save it again' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open in desktop app' }).click();
  await expect.poll(followed).toHaveLength(2);
  expect(asked).toBe(2);
  const region = page.getByRole('region', { name: 'Get the desktop app' });
  await expect(region).toContainText('Don’t have the desktop app yet?');
  // The direct download, in the same tab (no empty tab), and what to do after it.
  const download = region.getByRole('link', { name: 'Download for Windows' });
  await expect(download).toHaveAttribute('href', '/download/windows');
  await expect(download).not.toHaveAttribute('target', /./);
  await expect(region).toContainText(
    'Run the installer once. After that, open Paramount AI from the Start menu or the Desktop icon. You can delete the downloaded file.',
  );
  await region.getByText('Need it for macOS?').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Coming soon');
  await expect(page.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await shot('handoff');
});

test('the hand-off page says so when no code could be made', async () => {
  await open();
  const id = await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.route('**/api/desktop/link-code', (route) => route.fulfill({ status: 500, json: {} }));
  await page.evaluate((session) => window.kiteHandoffHarness.showHandoff(session), id);
  await expect(page.getByRole('alert')).toContainText('The desktop link could not be made.');
  expect(await followed()).toEqual([]);
});
