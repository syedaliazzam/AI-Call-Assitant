/**
 * Harness test for the launch flow (spec S8, S9, S10, S12), no sign-in, runs in CI. In a real browser:
 * Choose platform (both choices, the difference, a phone), the session file and the paramountai:// link,
 * the hand-off page, and, with a fake desktop bridge, the start card: asking for the file, refusing the
 * wrong one, importing, offering to delete the file (ticked by default), Continue and Back; and the
 * window's ⋮ menu. All text is invented. Set KITE_SCREENSHOT_DIR to save screenshots.
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
    if (req.url === '/images/logo-mark.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(readFileSync(path.join(WEB_DIR, 'public', 'images', 'logo-mark.png')));
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
 * @param bridge True to act as the desktop app, with a fake window.kiteDesktop.
 * @param width  The window's width.
 */
async function open(bridge = false, width = 1440): Promise<void> {
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
  if (bridge) {
    await page.addInitScript(() => {
      // A fresh profile shows the acceptable-use notice first; shell.spec covers it.
      localStorage.setItem('kite.hint.acceptableUse', 'seen');
      const state = {
        opened: [] as string[],
        deleted: 0,
        // What the fake dialog answers, set by each test.
        pick: null as unknown,
      };
      window.desktop = state;
      (window as unknown as Record<string, unknown>).kiteDesktop = {
        version: '1.2.0',
        os: 'windows',
        openPagesWindow: async (where: string) => {
          state.opened.push(where);
        },
        windowControl: async () => undefined,
        pickHandoffFile: async () => state.pick,
        deleteHandoffFile: async () => {
          state.deleted += 1;
          return true;
        },
        getShareProtection: async () => ({ on: false, scope: 'all', supported: true }),
        setShareProtection: async (on: boolean) => ({ on, scope: 'all', supported: true }),
      };
    });
  }
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

/**
 * Makes a session's hand-off file in this browser, as Choose platform does.
 *
 * @returns The session's id and the file's text.
 */
async function makeFile(): Promise<{ id: string; text: string }> {
  const id = await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.evaluate(() => window.kiteHandoffHarness.showDashboard());
  await page.getByRole('button', { name: 'Start session' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Desktop app' }).click();
  const file = await download;
  const stream = readFileSync(await file.path());
  return { id, text: stream.toString('utf8') };
}

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
  await open(false, 390);
  await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.evaluate(() => window.kiteHandoffHarness.showDashboard());
  await page.getByRole('button', { name: 'Start session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose platform' });
  await expect(dialog.getByRole('button', { name: 'Needs a computer' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Desktop app' })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Open in browser' })).toBeEnabled();
  await shot('choose-platform-phone');
});

test('choosing the desktop app saves one session’s file, under the agreed name', async () => {
  await open();
  const { id, text } = await makeFile();
  const file = JSON.parse(text) as {
    format: string;
    sessions: { id: string }[];
    documents: { text: string }[];
    utterances: unknown[];
  };
  expect(file.format).toBe('kite-export');
  expect(file.sessions.map((session) => session.id)).toEqual([id]);
  expect(file.documents.map((document) => document.text).sort()).toEqual([
    'Invented CV.',
    'Invented pricing.',
  ]);
  expect(file.utterances).toEqual([]);
  await expect
    .poll(() => page.evaluate(() => window.kiteHandoffHarness.pushed()))
    .toBe(`/sessions/${id}/desktop`);
});

test('the file’s name is paramount-ai-session-<short id>.json', async () => {
  await open();
  const id = await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.evaluate(() => window.kiteHandoffHarness.showDashboard());
  await page.getByRole('button', { name: 'Start session' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Desktop app' }).click();
  expect((await download).suggestedFilename()).toBe(`paramount-ai-session-${id.slice(0, 8)}.json`);
});

test('the hand-off page: the link once, its button, the file again, the download and the way back', async () => {
  await open();
  const id = await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.evaluate((session) => window.kiteHandoffHarness.showHandoff(session), id);
  await expect(page.getByText('Open Paramount AI')).toBeVisible();
  await expect(page.getByText('No prompt? Use the button below.')).toBeVisible();
  await expect.poll(followed).toEqual([`paramountai://session/${id}`]);
  await expect(page.getByRole('link', { name: 'Open in desktop app' })).toHaveAttribute(
    'href',
    `paramountai://session/${id}`,
  );
  const region = page.getByRole('region', { name: 'Get the desktop app' });
  await expect(region).toContainText('Don’t have the desktop app yet?');
  await expect(region.getByRole('link', { name: 'Download for Windows' })).toHaveAttribute(
    'href',
    /kite-releases\/releases\/latest$/,
  );
  await region.getByText('Need it for macOS?').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Coming soon');
  await expect(page.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  await shot('handoff');
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save it again' }).click();
  expect((await again).suggestedFilename()).toBe(`paramount-ai-session-${id.slice(0, 8)}.json`);
});

test('the start card asks for the file, refuses a wrong one, imports, and offers to delete it', async () => {
  // Make the file in one browser profile…
  await open();
  const { id, text } = await makeFile();
  await context.close();

  // …and take it to the desktop app's, which has its own, empty storage.
  await open(true);
  expect(await page.evaluate(() => window.kiteHandoffHarness.count())).toBe(0);
  await page.evaluate((session) => window.kiteHandoffHarness.showHome(session), id);
  await expect(page.getByRole('heading', { name: 'Bring this session here' })).toBeVisible();
  await expect(page.getByText(`paramount-ai-session-${id.slice(0, 8)}.json`)).toBeVisible();
  await shot('start-needs-file');

  // Cancelling the dialog changes nothing.
  await page.getByRole('button', { name: 'Choose the file' }).click();
  await expect(page.getByRole('heading', { name: 'Bring this session here' })).toBeVisible();

  // A file that is not for this session is refused.
  await page.evaluate(() => {
    window.desktop.pick = {
      name: 'other.json',
      text: 'not json',
    };
  });
  await page.getByRole('button', { name: 'Choose the file' }).click();
  await expect(page.getByRole('alert')).toContainText('not a Paramount AI export');

  // The right file imports: the summary shows what the call will use.
  await page.evaluate(
    ({ name, content }) => {
      window.desktop.pick = {
        name,
        text: content,
      };
    },
    { name: `paramount-ai-session-${id.slice(0, 8)}.json`, content: text },
  );
  await page.getByRole('button', { name: 'Choose the file' }).click();
  await expect(page.getByRole('heading', { name: 'Start your session' })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Session summary' });
  await expect(summary).toContainText('Lantern Freight (invented)');
  await expect(summary).toContainText('Data Analyst');
  await expect(summary).toContainText('Interview');
  await expect(summary.getByRole('term').filter({ hasText: 'Documents' })).toBeVisible();
  await expect(summary).toContainText('Spanish');
  await expect(summary).toContainText('Claude Haiku 5.5');
  await expect(summary).toContainText('Opening line + bullets');
  await expect(summary.getByLabel('Attached')).toBeVisible();
  await shot('start-card');
  await page.setViewportSize({ width: 400, height: 560 });
  await shot('start-card-400');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'the card fits the 400 px window',
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate((session) => window.kiteHandoffHarness.stored(session), id)).toEqual({
    company: 'Lantern Freight (invented)',
    documents: expect.arrayContaining(['Invented CV.', 'Invented pricing.']),
  });

  // Deleting the file is ticked by default, and happens when the card is left.
  const remove = page.getByRole('checkbox', { name: /Delete the hand-off file/ });
  await expect(remove).toBeChecked();
  const deleted = () => page.evaluate(() => window.desktop.deleted);
  expect(await deleted()).toBe(0);
  await page.getByRole('button', { name: 'Continue' }).click();
  expect(await deleted()).toBe(1);
  const opened = await page.evaluate(() => window.desktop.opened);
  expect(opened).toEqual([`/live/${id}`]);
  await context.close();

  // Unticked, the file stays.
  await open(true);
  await page.evaluate((session) => window.kiteHandoffHarness.showHome(session), id);
  await page.evaluate(
    ({ name, content }) => {
      window.desktop.pick = {
        name,
        text: content,
      };
    },
    { name: 'file.json', content: text },
  );
  await page.getByRole('button', { name: 'Choose the file' }).click();
  await page.getByRole('checkbox', { name: /Delete the hand-off file/ }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  expect(await deleted()).toBe(0);
  await expect(page.getByRole('heading', { name: 'Lantern Freight (invented)' })).toBeVisible();
});

test('a session already in the desktop app goes straight to the summary, with no file to delete', async () => {
  await open(true);
  const id = await page.evaluate(() => window.kiteHandoffHarness.seed());
  await page.evaluate((session) => window.kiteHandoffHarness.showHome(session), id);
  await expect(page.getByRole('heading', { name: 'Start your session' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('list', { name: 'Sessions' })).toBeVisible();
  // Start on a card shows the summary first.
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start your session' })).toBeVisible();
});

test('without the file, the session can be created in the desktop app instead', async () => {
  await open(true);
  await page.evaluate(() =>
    window.kiteHandoffHarness.showHome('86495cda-fbd1-4cea-8387-cd29f5c1381b'),
  );
  await page.getByRole('button', { name: 'Create it here instead' }).click();
  const opened = await page.evaluate(() => window.desktop.opened);
  expect(opened).toEqual(['/sessions/new']);
});

test('the window header and its ⋮ menu', async () => {
  await open(true);
  await page.evaluate(() => window.kiteHandoffHarness.showHome());
  const header = page.getByRole('banner');
  await expect(header).toContainText('Paramount AI');
  await expect(header.getByRole('button', { name: 'Compact' })).toBeVisible();
  await expect(header.getByRole('img', { name: 'Drag here to move' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Close' })).toHaveCSS(
    'background-color',
    'rgb(220, 38, 38)',
  );
  await header.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Home panel menu' });
  await expect(menu).toContainText('sam.lee@example.com');
  for (const row of ['Dashboard', 'Get help', 'Log out']) {
    await expect(menu.getByRole('button', { name: row })).toBeEnabled();
  }
  await expect(menu.getByRole('button', { name: 'Log out' })).not.toHaveCSS(
    'color',
    await menu
      .getByRole('button', { name: 'Dashboard' })
      .evaluate((row) => getComputedStyle(row).color),
  );
  await expect(menu.getByRole('button', { name: /Voice profile/ })).toBeDisabled();
  await expect(menu.getByText('Meeting detect')).toBeVisible();
  await expect(menu.getByRole('switch', { name: 'Meeting detect' })).toHaveCount(0);
  await expect(menu.getByRole('switch', { name: 'Private' })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Zoom' })).toBeVisible();
  await expect(menu.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio')).toHaveCount(3);
  await shot('window-menu');
  await page.setViewportSize({ width: 400, height: 560 });
  await shot('window-menu-400');
  await page.setViewportSize({ width: 1440, height: 900 });
  await menu.getByRole('button', { name: 'Get help' }).click();
  const opened = await page.evaluate(() => window.desktop.opened);
  expect(opened).toEqual(['/help']);
});
