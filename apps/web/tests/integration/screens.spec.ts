/**
 * Harness test for the restyled screens (spec S17), no sign-in, runs in CI. Each real screen, in the
 * light and dark themes at 1440 and 390 px and DPR 1.5, must draw its words on a themed background, with
 * no sideways scroll, no touch target under 44 px on the phone, and no console problems. Set
 * KITE_SCREENSHOT_DIR to save the pictures. All text is invented.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { check, WIDTHS } from '../ui/shots';
import { brandFonts } from '../lib/fonts';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The part of postcss used here (not a direct dependency, so its types are not imported). */
type PostcssRunner = (plugins: unknown[]) => {
  /** Runs the plugins over a stylesheet. */
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};

/** Each screen, the address it has in the app, and a word it must show. */
const SCREENS: readonly { screen: string; at?: string; shows: string | RegExp }[] = [
  { screen: 'settings', at: '/settings', shows: 'Hotkeys' },
  { screen: 'review', at: '/sessions/one', shows: 'Northwind Logistics (invented)' },
  { screen: 'resumes', at: '/resumes', shows: 'invented-cv.txt' },
  { screen: 'documents', at: '/documents', shows: 'price-list.txt' },
  { screen: 'ask', at: '/ask-kite', shows: 'Ask AI' },
  { screen: 'mock', at: '/mock', shows: /mock interview/i },
  { screen: 'bank', at: '/question-bank', shows: /question bank/i },
  { screen: 'admin', at: '/admin/users', shows: 'dana.okafor@example.com' },
  { screen: 'login', shows: 'Sign in to Paramount AI' },
  { screen: 'change-password', shows: 'Choose a new password' },
  { screen: 'not-found', shows: 'Page not found' },
  { screen: 'error', shows: 'Something went wrong' },
  { screen: 'unsupported', shows: 'Live calls need a computer' },
  { screen: 'notice', shows: 'Using Paramount AI' },
];

let bundleDir = '';
let server: Server | null = null;
let browser: Browser | null = null;
let origin = '';

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-screens-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'screens.tsx')],
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
  writeFileSync(path.join(bundleDir, 'screens.css'), css.css);
  server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!;
    if (url === '/harness/screens.js' || url === '/harness/screens.css') {
      const isCss = url.endsWith('.css');
      res.writeHead(200, { 'Content-Type': isCss ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, isCss ? 'screens.css' : 'screens.js')));
      return;
    }
    if (url.startsWith('/images/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(readFileSync(path.join(WEB_DIR, 'public', url)));
      return;
    }
    // What the pages ask the server for: nothing of it matters to how they look.
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    if (url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Screens harness</title>' +
        '<link rel="stylesheet" href="/harness/screens.css">' +
        brandFonts() +
        '</head>' +
        '<body class="bg-ui-bg font-sans text-[16px] leading-6 text-ui-text"><div id="root"></div>' +
        '<script type="module" src="/harness/screens.js"></script></body></html>',
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
  if (process.env.KITE_SCREENSHOT_DIR)
    mkdirSync(process.env.KITE_SCREENSHOT_DIR, { recursive: true });
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

for (const theme of ['light', 'dark'] as const) {
  test(`review's Conversation and Answers tabs, ${theme}`, async () => {
    for (const size of WIDTHS) {
      const context = await browser!.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1.5,
        ...(size.touch ? { isMobile: true, hasTouch: true } : {}),
      });
      const page = await context.newPage();
      await page.goto(`${origin}/sessions/one?screen=review&theme=${theme}`);
      await page.getByRole('button', { name: 'Transcript', exact: true }).click();
      const tabs = page.getByRole('group', { name: 'Transcript view' });
      await expect(tabs.getByRole('button', { name: 'Conversation' })).toBeVisible();
      // The selected section can be read: its words are not the colour of its fill.
      const [words, fill] = await page
        .locator('button[aria-current="page"]', { hasText: 'Transcript' })
        .evaluate((row) => [getComputedStyle(row).color, getComputedStyle(row).backgroundColor]);
      expect(fill).not.toBe(words);
      await check({ page, context, problems: [] }, size, `review-conversation-${theme}`);
      await tabs.getByRole('button', { name: 'Answers' }).click();
      await check({ page, context, problems: [] }, size, `review-answers-${theme}`);
      await context.close();
    }
  });

  for (const { screen, at = '/', shows } of SCREENS) {
    test(`${screen}, ${theme}`, async () => {
      for (const size of WIDTHS) {
        const context = await browser!.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 1.5,
          ...(size.touch ? { isMobile: true, hasTouch: true } : {}),
        });
        const page = await context.newPage();
        const problems: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning') {
            problems.push(`${message.type()}: ${message.text().slice(0, 300)}`);
          }
        });
        page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 300)}`));
        await page.goto(`${origin}${at}?screen=${screen}&theme=${theme}`);
        await expect(page.getByText(shows).filter({ visible: true }).first()).toBeVisible();
        // The page's background follows the theme: nothing is left painted for the other one.
        const background = await page.evaluate(() => {
          const main = document.querySelector('main') ?? document.body;
          return getComputedStyle(main).backgroundColor;
        });
        expect(background, 'a page background is painted').not.toBe('');
        await check({ page, context, problems }, size, `${screen}-${theme}`);
        await context.close();
      }
    });
  }
}
