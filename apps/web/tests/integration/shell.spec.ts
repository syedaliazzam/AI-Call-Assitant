/**
 * Harness test for the app shell (spec S1, S2), no sign-in, runs in CI. With the real AppShell it covers:
 * the header's words and split button (which address each choice opens), the sidebar's order, sizes and
 * "Soon" items, collapsing (remembered), the phone drawer, the user menu for a user and an admin, the
 * theme sub-list painting the document, the desktop card (open link, download link, Hide card remembered,
 * absent in the desktop app), and no hard-coded old name. Set KITE_SCREENSHOT_DIR to save screenshots.
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

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-shell-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'shell.tsx')],
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
  writeFileSync(path.join(bundleDir, 'shell.css'), css.css);
  server = createServer((req, res) => {
    if (req.url === '/harness/shell.js' || req.url === '/harness/shell.css') {
      const isCss = req.url.endsWith('.css');
      res.writeHead(200, { 'Content-Type': isCss ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, isCss ? 'shell.css' : 'shell.js')));
      return;
    }
    if (req.url === '/brand/logo-lockup.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(readFileSync(path.join(WEB_DIR, 'public', 'brand', 'logo-lockup.png')));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html data-theme="' +
        (process.env.KITE_VISUAL_THEME ?? 'light') +
        '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shell harness</title>' +
        '<link rel="stylesheet" href="/harness/shell.css"></head>' +
        '<body class="bg-ui-bg font-sans text-[15px] text-ui-text"><div id="root"></div>' +
        '<script type="module" src="/harness/shell.js"></script></body></html>',
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

/**
 * Opens the shell in a fresh browser profile.
 *
 * @param query  The address's query.
 * @param width  The window's width.
 * @param height The window's height.
 */
async function open(query = '', width = 1440, height = 900): Promise<void> {
  context = await browser!.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1.5,
    hasTouch: width < 500,
    ...(process.env.KITE_VISUAL_THEME === 'dark' ? { colorScheme: 'dark' as const } : {}),
  });
  page = await context.newPage();
  // The dashboard is Light until chosen (v1.3.0), so the dark pictures choose Dark.
  if (process.env.KITE_VISUAL_THEME) {
    await page.addInitScript(
      (theme) => localStorage.setItem('kite.theme', theme),
      process.env.KITE_VISUAL_THEME,
    );
  }
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => 'shellReady' in window);
  await page.evaluate(() => document.fonts.ready);
}

test.afterEach(async () => {
  await context.close();
});

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

test('header: wordmark, the page’s words, and the split button’s addresses', async () => {
  await open();
  const header = page.getByRole('banner');
  // The final logo carries the name itself (one image, alt "Paramount AI").
  await expect(header.getByRole('img', { name: 'Paramount AI' })).toHaveCount(1);
  await expect(header).toContainText('Call Sessions');
  await expect(header).toContainText('Your upcoming calls and everything you’ve done before.');
  expect((await header.boundingBox())!.height).toBe(76);
  await expect(header.getByRole('img')).toHaveCount(1);
  await expect(page.locator('header img')).toHaveAttribute('src', '/brand/logo-lockup.png');

  await page.evaluate(() => {
    (window as unknown as { pushed: string[] }).pushed = [];
    window.addEventListener('kite-harness-push', (event) => {
      (window as unknown as { pushed: string[] }).pushed.push((event as CustomEvent).detail);
    });
  });
  const main = header.getByRole('button', { name: 'Create session' });
  expect((await main.boundingBox())!.height).toBe(40);
  await expect(main).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  await main.click();
  await header.getByRole('button', { name: 'Choose a session type' }).click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Interview call',
    'Regular call',
    'Mock interview',
  ]);
  await shot('header-menu');
  await page.getByRole('menuitem', { name: 'Mock interview' }).click();
  await header.getByRole('button', { name: 'Choose a session type' }).click();
  await page.getByRole('menuitem', { name: 'Regular call' }).click();
  expect(await page.evaluate(() => (window as unknown as { pushed: string[] }).pushed)).toEqual([
    '/sessions/new?type=interview',
    '/sessions/new?type=mock',
    '/sessions/new?type=regular',
  ]);
});

test('sidebar: order, sizes, the active item and "Soon" items that do nothing', async () => {
  await open();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText([
    'Create session',
    'Call Sessions',
    'Resumes',
    'Documents',
    'Ask AI',
    'Mock Interview',
    'Question bank',
    'Open desktop app',
    'Don’t have it? Download for Windows',
    'Help',
  ]);
  await expect(nav.getByText('Prepare')).toBeVisible();
  const active = nav.getByRole('link', { name: 'Call Sessions' });
  await expect(active).toHaveAttribute('aria-current', 'page');
  // The light theme's colour; KITE_VISUAL_THEME=dark only takes pictures of this page.
  if (process.env.KITE_VISUAL_THEME !== 'dark') {
    await expect(active).toHaveCSS('background-color', 'rgb(244, 244, 245)');
  }
  expect((await active.boundingBox())!.height).toBe(40);
  await expect(active).toHaveCSS('font-size', '15px');
  await expect(nav.getByRole('link', { name: 'Ask AI' })).toHaveAttribute('href', '/ask-kite');
  await expect(page.getByRole('complementary').first()).toHaveCSS('width', '252px');

  const resumeMaker = nav.getByRole('button', { name: /Resume Maker/ });
  await expect(resumeMaker).toBeDisabled();
  await expect(nav.getByRole('button', { name: /Headshots/ })).toBeDisabled();
  await resumeMaker.hover({ force: true });
  await expect(page.getByRole('tooltip')).toHaveText('Coming soon');
  await shot('sidebar');
});

test('collapsing goes to icons, is remembered, and names each icon', async () => {
  await open();
  const toggle = page.getByRole('button', { name: 'Collapse the sidebar' });
  await toggle.click();
  const aside = page.locator('aside');
  await expect(aside).toHaveCSS('width', '64px');
  await expect(page.locator('header').getByRole('img', { name: 'Paramount AI' })).toBeHidden();
  const documents = page.getByRole('link', { name: 'Documents' });
  await documents.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Documents');
  await expect(page.getByRole('region', { name: 'Desktop app' })).toHaveCount(0);
  await shot('sidebar-collapsed');
  await page.reload();
  await page.waitForFunction(() => 'shellReady' in window);
  await expect(page.locator('aside')).toHaveCSS('width', '64px');
  // The avatar opens the menu while only icons show.
  await page.getByRole('button', { name: 'Account menu for Sam Lee' }).click();
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Expand the sidebar' }).click();
  await expect(page.locator('aside')).toHaveCSS('width', '252px');
});

test('on a phone the sidebar is a drawer, and the header still fits', async () => {
  await open('', 390, 844);
  await expect(page.locator('aside')).toBeHidden();
  const noSideways = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noSideways).toBe(true);
  await expect(page.getByRole('button', { name: 'Create session' })).toBeInViewport();
  await shot('phone-header');
  await page.getByRole('button', { name: 'Open the menu' }).click();
  const aside = page.locator('aside');
  await expect(aside).toBeVisible();
  await expect(aside.getByRole('link', { name: 'Documents' })).toBeInViewport();
  await page.waitForTimeout(250);
  await shot('phone-drawer');
  await page.keyboard.press('Escape');
  await expect(aside).toBeHidden();
  await page.getByRole('button', { name: 'Open the menu' }).click();
  await aside.getByRole('link', { name: 'Resumes' }).click();
  await expect(aside).toBeHidden();
});

test('user menu: the rows for a user, the theme sub-list, and the extra rows for an admin', async () => {
  await open();
  const footer = page.locator('aside').getByText('sam.lee@example.com');
  await expect(footer).toBeVisible();
  // Two avatars exist (expanded and icons only), and one shows at a time.
  await expect(page.locator('aside').getByText('SL', { exact: true }).last()).toBeVisible();
  const menu = page.getByRole('button', { name: 'Account menu', exact: true });
  await menu.click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Profile',
    /^Theme/,
    'Settings',
    /^Tutorials/,
    /^Feedback/,
    'Open desktop app',
    'Log out',
  ]);
  await expect(page.getByRole('menuitem', { name: /Tutorials/ })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /Feedback/ })).toBeDisabled();
  await shot('user-menu');

  await page.getByRole('menuitem', { name: /Theme/ }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot('shell-dark');
  await menu.click();
  await expect(page.getByRole('menuitem', { name: /Theme/ })).toContainText('Dark');
  await page.getByRole('menuitem', { name: /Theme/ }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await context.close();

  await open('?role=admin');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Admin' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Dev Tools' })).toBeVisible();
});

test('desktop card: open, download, hide (remembered), and never inside the desktop app', async () => {
  await open();
  const card = page.getByRole('region', { name: 'Desktop app' });
  await expect(card).toContainText('Paramount AI for Windows');
  await expect(card).toContainText('Hidden from screen share, global hotkeys');
  await expect(card.getByRole('link', { name: 'Open desktop app' })).toHaveAttribute(
    'href',
    'paramountai://open',
  );
  await expect(
    card.getByRole('link', { name: 'Don’t have it? Download for Windows' }),
  ).toHaveAttribute('href', /kite-releases\/releases\/latest$/);
  await card.getByRole('button', { name: 'Desktop app card options' }).click();
  await page.getByRole('menuitem', { name: 'Hide card' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => 'shellReady' in window);
  await expect(page.getByRole('region', { name: 'Desktop app' })).toHaveCount(0);
  await context.close();

  await open();
  await page.addInitScript(() => {
    (window as unknown as { kiteDesktop: unknown }).kiteDesktop = {
      version: '1.2.0',
      os: 'windows',
    };
  });
  await page.reload();
  await page.waitForFunction(() => 'shellReady' in window);
  await expect(page.getByRole('region', { name: 'Desktop app' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Open desktop app' })).toHaveCount(0);
});
