/**
 * File: apps/web/tests/integration/launcher.spec.ts
 * Purpose: Harness test of the desktop launcher (ADR-0055) in Chromium, acting as desktop 1.3.0 with a
 *          fake window.kiteDesktop, for an invented account with account sync: the sessions card (all
 *          sessions, the browser's first and highlighted, Call ended · View notes, Open dashboard), the
 *          Start card (two tiles, Team, Buy credits only shows a toast, Back) and the Connect card
 *          (tips and their links, no meter or status text, the speech model dialog, Connect asks the main
 *          window for the call and follows its answer). With KITE_SCREENSHOT_DIR it saves the cards at
 *          560 × 720, the window size, for the visual pairs (tests/visual/v12-pairs.ts).
 * Used by: `pnpm --filter web test:launcher`
 * Depends on: @playwright/test, esbuild, @tailwindcss/postcss, tests/integration/harness/launcher.tsx
 * Architecture: ADR-0051, ADR-0055
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

/** The window the launcher asks desktop 1.3.0 for. */
const WINDOW = { width: 560, height: 720 };

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
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-launcher-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'launcher.tsx')],
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
    // Next.js inlines these when it builds the app; the harness bundle states them the same way.
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_STT_SOURCE': '"remote"',
    },
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
  writeFileSync(path.join(bundleDir, 'launcher.css'), css.css);
  server = createServer((req, res) => {
    if (req.url?.startsWith('/harness/')) {
      const isCss = req.url.endsWith('.css');
      res.writeHead(200, { 'Content-Type': isCss ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, isCss ? 'launcher.css' : 'launcher.js')));
      return;
    }
    if (req.url === '/images/logo-mark.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(readFileSync(path.join(WEB_DIR, 'public', 'images', 'logo-mark.png')));
      return;
    }
    if (req.url?.startsWith('/api/')) {
      // No account server here: sync and the one-time upload see a refusal and stay quiet.
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html data-theme="' +
        (process.env.KITE_VISUAL_THEME ?? 'light') +
        '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Launcher harness</title>' +
        '<link rel="stylesheet" href="/harness/launcher.css"></head>' +
        '<body class="bg-ui-bg font-sans text-[15px] text-ui-text"><div id="root"></div>' +
        '<script type="module" src="/harness/launcher.js"></script></body></html>',
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
 * Opens the harness in a fresh profile, as desktop 1.3.0.
 */
async function open(): Promise<void> {
  context = await browser!.newContext({ viewport: WINDOW, deviceScaleFactor: 1.5 });
  page = await context.newPage();
  if (process.env.KITE_VISUAL_THEME) {
    await page.addInitScript(
      (theme) => localStorage.setItem('kite.theme', theme),
      process.env.KITE_VISUAL_THEME,
    );
  }
  await page.addInitScript(() => {
    // A fresh profile shows the acceptable-use notice first; shell.spec covers it.
    localStorage.setItem('kite.hint.acceptableUse', 'seen');
    const state = {
      opened: [] as string[],
      callWindows: [] as string[],
      sizes: [] as { width: number; height: number }[],
      controls: [] as string[],
    };
    window.launcherDesktop = state;
    window.windowOpened = [];
    window.open = ((url: string) => {
      window.windowOpened.push(String(url));
      return null;
    }) as typeof window.open;
    (window as unknown as Record<string, unknown>).kiteDesktop = {
      version: '1.3.0',
      os: 'windows',
      openPagesWindow: async (where: string) => {
        state.opened.push(where);
      },
      openCallWindow: async (sessionId: string) => {
        state.callWindows.push(sessionId);
      },
      sizePanel: async (size: { width: number; height: number }) => {
        state.sizes.push(size);
      },
      windowControl: async (action: string) => {
        state.controls.push(action);
      },
      getShareProtection: async () => ({ on: false, scope: 'all', supported: true }),
      setShareProtection: async (on: boolean) => ({ on, scope: 'all', supported: true }),
    };
  });
  await page.goto(origin);
  await page.waitForFunction(() => 'kiteLauncherHarness' in window);
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
  // The logo and fonts settle first.
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * Seeds three invented sessions and shows the launcher.
 *
 * @param fromBrowser Which seeded session (0–2) the browser's link opened, if any.
 * @returns The ids, oldest first.
 */
async function seedAndShow(fromBrowser?: number): Promise<string[]> {
  const ids: string[] = [];
  for (const [company, role] of [
    ['Lantern Freight (invented)', 'Data Analyst'],
    ['Harbor Lane (invented)', 'Product Manager'],
    ['Copperfield Labs (invented)', 'Backend Engineer'],
  ] as const) {
    ids.push(
      await page.evaluate(({ c, r }) => window.kiteLauncherHarness.seed(c, r), {
        c: company,
        r: role,
      }),
    );
  }
  const highlight = fromBrowser === undefined ? undefined : ids[fromBrowser];
  await page.evaluate((id) => window.kiteLauncherHarness.show(id), highlight);
  return ids;
}

test('the sessions card: every session, the browser’s first, and Open dashboard', async () => {
  await open();
  await seedAndShow(0);
  const card = page.getByRole('region', { name: 'Your sessions' });
  await expect(card).toBeVisible();
  const rows = card.getByRole('list', { name: 'Sessions' }).getByRole('button');
  await expect(rows).toHaveCount(3);
  // The browser's session first, highlighted; then newest first.
  await expect(rows.nth(0)).toContainText('From your browser');
  await expect(rows.nth(0)).toContainText('Lantern Freight (invented)');
  await expect(rows.nth(1)).toContainText('Copperfield Labs (invented)');
  await expect(rows.nth(2)).toContainText('Harbor Lane (invented)');
  await expect(rows.nth(1)).toContainText('Ready to start');
  // The frame: logo, compact, move, menu, close; no Buy credits on this card; no dashboard parts.
  const header = page.getByRole('banner');
  await expect(header).toContainText('Paramount AI');
  await expect(header.getByRole('button', { name: 'Buy credits' })).toHaveCount(0);
  for (const name of ['Compact', 'Menu', 'Close']) {
    await expect(header.getByRole('button', { name })).toBeVisible();
  }
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search sessions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Create session/ })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  // The window asks for its size.
  expect(await page.evaluate(() => window.launcherDesktop.sizes)).toContainEqual(WINDOW);
  await shot('launcher-sessions-560');

  await page.getByRole('button', { name: /Open dashboard/ }).click();
  expect(await page.evaluate(() => window.windowOpened)).toEqual([`${origin}/`]);
});

test('after a call: Call ended · View notes on top, opening the notes in the browser', async () => {
  await open();
  const ids = await seedAndShow();
  await page.evaluate((id) => window.kiteLauncherHarness.endNow(id), ids[1]!);
  const ended = page.getByRole('status').filter({ hasText: 'Call ended' });
  await expect(ended).toContainText('Harbor Lane (invented)');
  await ended.getByRole('button', { name: /View notes/ }).click();
  expect(await page.evaluate(() => window.windowOpened)).toEqual([`${origin}/sessions/${ids[1]}`]);
});

test('the Start card: two tiles, Team, Buy credits only shows a toast, Back', async () => {
  await open();
  await seedAndShow();
  await page.getByRole('list', { name: 'Sessions' }).getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Start your session' })).toBeVisible();
  await expect(page.getByText('Signed in as sam.lee@example.com')).toBeVisible();
  const free = page.getByRole('region', { name: 'Free session' });
  await expect(free).toContainText('Unlimited · Free');
  await expect(free).toContainText('Paramount Intelligence team account.');
  await expect(free).toContainText('Team');
  const paid = page.getByRole('region', { name: 'Paid session' });
  await expect(paid).toContainText('No limit · Included');
  await expect(paid).toContainText('Your team account already includes everything.');
  await shot('launcher-start-560');

  // Both Buy credits buttons: a toast, nothing opened, nothing navigated.
  await page.getByRole('banner').getByRole('button', { name: 'Buy credits' }).click();
  await expect(page.getByRole('status')).toHaveText('Not needed, your team account is unlimited.');
  await paid.getByRole('button', { name: 'Buy Credits' }).click();
  await expect(page.getByRole('status')).toHaveText('Not needed, your team account is unlimited.');
  expect(await page.evaluate(() => window.windowOpened)).toEqual([]);
  expect(await page.evaluate(() => window.launcherDesktop.opened)).toEqual([]);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('region', { name: 'Your sessions' })).toBeVisible();
});

test('the Connect card: tips, no meter or status, the model dialog, and the call start', async () => {
  await open();
  const ids = await seedAndShow();
  const newest = ids[2]!;
  await page.getByRole('list', { name: 'Sessions' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Start free' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Call Session' })).toBeVisible();
  await expect(
    page.getByText('Your session is ready. Connect to start transcribing.'),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Audio source' })).toContainText('System audio');
  // Only the audio source here: no microphone picker, level meter or status text.
  await expect(
    page.getByText(/Microphone|You ready|Speech model ready|Test microphone/),
  ).toHaveCount(0);
  const tips = page.getByRole('list', { name: 'Tips' }).getByRole('listitem');
  await expect(tips).toHaveCount(3);
  await expect(tips.nth(0)).toContainText('On Zoom, update it and turn on advanced capture');
  await expect(tips.nth(1)).toContainText('test privacy before a real call');
  await expect(tips.nth(2)).toContainText('Share a mock video on YouTube');
  await expect(tips.nth(2).getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/results?search_query=mock+interview',
  );
  await tips.nth(0).getByRole('button', { name: 'How' }).click();
  await tips.nth(1).getByRole('button', { name: 'Watch' }).click();
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  expect(await page.evaluate(() => window.windowOpened)).toEqual([
    `${origin}/help#zoom`,
    `${origin}/help#private`,
    `${origin}/`,
  ]);
  await expect(page.getByText('Need it for')).toBeVisible();
  await shot('launcher-connect-560');

  // No speech model yet: the dialog, and Cancel.
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Speech model needed' });
  await expect(dialog).toContainText('One-time download, about 204 MB');
  await expect(dialog.getByRole('button', { name: 'Download and connect' })).toBeVisible();
  await shot('launcher-model-560');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.launcherDesktop.callWindows)).toEqual([]);

  // With the model: Connect asks for the call window and leaves the note for its live page.
  await page.evaluate(() => window.kiteLauncherHarness.fakeModelCached());
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connecting…' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.launcherDesktop.callWindows))
    .toEqual([newest]);
  const note = await page.evaluate(() => localStorage.getItem('kite-call-start'));
  expect(JSON.parse(note!).sessionId).toBe(newest);

  // The live page says it failed: the card says why, and Connect tries again.
  await page.evaluate((id) => {
    const channel = new BroadcastChannel('kite-call-start');
    channel.postMessage({
      type: 'status',
      sessionId: id,
      state: 'failed',
      message: 'Allow the microphone.',
    });
    channel.close();
  }, newest);
  await expect(page.getByRole('alert')).toHaveText('Allow the microphone.');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  // It runs: the card goes back to the sessions (the shell hides the window during the call).
  await page.evaluate((id) => {
    const channel = new BroadcastChannel('kite-call-start');
    channel.postMessage({ type: 'status', sessionId: id, state: 'connected' });
    channel.close();
  }, newest);
  await expect(page.getByRole('region', { name: 'Your sessions' })).toBeVisible();
});
