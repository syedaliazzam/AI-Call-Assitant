/**
 * Harness test for the dark call screens (UI theme stage U3), no sign-in, runs in CI. With the
 * real components on invented data and a mocked /api/answer (no Claude call, no microphone, no
 * speech model) it covers:
 * - the live view: transcript left and answers right in a wide view, stacked (answers first)
 *   in a narrower one; You in the accent, Them in light grey, words still being heard grey italic;
 * - no layout shift while an answer streams: between the headline arriving and the bullets
 *   arriving, the action row, the answer panel's size and its footer (Cancel) do not move;
 * - the "Claude unavailable" message in the answer panel;
 * - the phone check: an iPhone sees "Live calls need a computer"; Chrome on Windows does not;
 * - the overlay: three bars, the answer's parts, one scroll area, at its default and smallest sizes;
 * - ADR-0082: bar 1 without Answer, Screenshot or Chat (and no chat bar), with a Click-through switch
 *   where clicks can pass; bar 2 as the one status bar, whose line shows the current message with its
 *   button ("Can't hear the other side", "Listening…", the headphones hint, "Still in a call?", listening
 *   paused, the Answer key held elsewhere, Private off) instead of separate warning bars; the answer
 *   panel's arrows without key-caps, and its Clear sending "clear answers".
 * Set KITE_SCREENSHOT_DIR to also save screenshots (1440, 900 and 390 px; 360 px for the
 * compact view and picture-in-picture, which render the same component), each checked for
 * sideways scroll, 44 px touch targets on touch screens and console errors (tests/ui/shots.ts).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { CLAUDE_UNAVAILABLE_MESSAGES, type AnswerRequest } from '@kite/shared';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { SHOT_DIR, check, type Width, type WatchedPage } from '../ui/shots';
import { brandFonts } from '../lib/fonts';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The mocked answer: a headline, then (after a pause) two bullets, then (after another) done. */
const HEADLINE = 'Forty seats cost 2,080 dollars a month.';
const BULLETS = [
  '52 dollars per seat on Professional, billed yearly',
  'Onboarding is 1,500 dollars once',
];

/** Pause before the bullets, and before the end, so the test can look at each step. */
const STEP_MS = 1_200;

/** Chrome on Windows, and Safari on an iPhone. */
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

/**
 * Reads a request body.
 *
 * @param req The request.
 * @returns The body text.
 */
async function bodyOf(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

/** The part of postcss used here (not a direct dependency, so its types are not imported). */
type PostcssRunner = (plugins: unknown[]) => {
  /** Runs the plugins over a stylesheet. */
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};

/**
 * Compiles the app's real stylesheet (app/globals.css, Tailwind) into live.css.
 *
 * @param outDir Where to write it.
 */
async function buildCss(outDir: string): Promise<void> {
  const fromTailwind = createRequire(
    createRequire(import.meta.url).resolve('@tailwindcss/postcss'),
  );
  const postcss = fromTailwind('postcss') as PostcssRunner;
  const from = path.join(WEB_DIR, 'app', 'globals.css');
  const result = await postcss([tailwind({ base: WEB_DIR })]).process(readFileSync(from, 'utf8'), {
    from,
  });
  writeFileSync(path.join(outDir, 'live.css'), result.css);
}

/**
 * Serves the page, the bundle, the stylesheet and the mocked /api/answer.
 *
 * @param bundleDir Folder with live.js and live.css.
 * @returns The server and its origin.
 */
async function serve(bundleDir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'POST' && req.url === '/api/answer') {
        const request = JSON.parse(await bodyOf(req)) as AnswerRequest;
        if (request.question === 'SIGNEDOUT') {
          // The server's reply when the sign-in has expired (app/api/answer/route.ts).
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'unauthorized', message: 'Sign in required' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const event = (name: string, data: unknown) =>
          res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        const done = () =>
          event('done', {
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 900,
            },
            ms: { auth: 1, toStreamOpen: 2, streamOpenToFirstText: 3, toFirstText: 4, total: 5 },
          });
        if (request.mode === 'warm') {
          done();
        } else if (request.question === 'UNAVAILABLE') {
          event('error', {
            code: 'claude_unavailable',
            message: CLAUDE_UNAVAILABLE_MESSAGES.usageLimit,
          });
        } else {
          event('delta', { text: HEADLINE });
          await new Promise((resolve) => setTimeout(resolve, STEP_MS));
          if (res.destroyed) return;
          event('delta', { text: `\n- ${BULLETS[0]}\n- ${BULLETS[1]}` });
          await new Promise((resolve) => setTimeout(resolve, STEP_MS));
          if (res.destroyed) return;
          done();
        }
        res.end();
        return;
      }
      if (req.url === '/harness/live.js' || req.url === '/harness/live.css') {
        const css = req.url.endsWith('.css');
        res.writeHead(200, { 'Content-Type': css ? 'text/css' : 'text/javascript' });
        res.end(readFileSync(path.join(bundleDir, css ? 'live.css' : 'live.js')));
        return;
      }
      // The brand files (the logo mark in the lockup), from the app's public folder.
      if (req.url && /^\/brand\/[\w.-]+$/.test(req.url)) {
        res.writeHead(200, {
          'Content-Type': req.url.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
        });
        res.end(readFileSync(path.join(WEB_DIR, 'public', req.url)));
        return;
      }
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body><h1>Dashboard stand-in</h1></body></html>');
        return;
      }
      // The brand font for screenshots only (tests/lib/fonts.ts).
      const fonts = brandFonts();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<!doctype html><html data-theme="' +
          (process.env.KITE_VISUAL_THEME ?? 'light') +
          '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
          `<title>Paramount AI live harness</title><link rel="stylesheet" href="/harness/live.css">${fonts}</head>` +
          '<body class="font-sans"><div id="root"></div><script type="module" src="/harness/live.js"></script></body></html>',
      );
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, origin: `http://127.0.0.1:${port}` };
}

let bundleDir = '';
let server: Server | null = null;
let browser: Browser | null = null;
let origin = '';

/**
 * Opens a harness view in a fresh context.
 *
 * @param view   The ?view= value.
 * @param size   Viewport and touch.
 * @param ua     The user agent (default Chrome on Windows).
 * @returns The page with its console problems.
 */
async function open(view: string, size: Width, ua = WINDOWS_UA): Promise<WatchedPage> {
  const context = await browser!.newContext({
    viewport: { width: size.width, height: size.height },
    userAgent: ua,
    ...(size.touch ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  // KITE_VISUAL_THEME: the pictures of either theme (spec §7). The call views read the call's stored
  // choice, the page around them the dashboard's (two settings since v1.3.0).
  if (process.env.KITE_VISUAL_THEME) {
    await page.addInitScript((theme) => {
      localStorage.setItem('kite.theme', theme);
      localStorage.setItem('kite.callTheme', theme);
    }, process.env.KITE_VISUAL_THEME);
  }
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text().slice(0, 400)}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 400)}`));
  await page.goto(`${origin}/?view=${view}`);
  return { page, context, problems };
}

/**
 * Checks and saves a screenshot when KITE_SCREENSHOT_DIR is set (tests/ui/shots.ts).
 *
 * @param watched The page.
 * @param size    Its width.
 * @param name    The screenshot's name.
 */
async function shot(watched: WatchedPage, size: Width, name: string): Promise<void> {
  if (SHOT_DIR) await check(watched, size, name);
}

/**
 * The bounding box of a locator, rounded.
 *
 * @param page     The page.
 * @param selector What to measure (a CSS selector or aria label query).
 * @returns x, y, width, height.
 */
async function box(page: Page, selector: string) {
  const b = (await page.locator(selector).first().boundingBox())!;
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
  };
}

// Each test opens its own context, so one failure must not hide the others (v1.1.0: serial mode
// hid 26 tests behind one stale selector).
test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-live-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'live.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    // No Next.js router here: links are plain anchors.
    alias: {
      'next/link': path.join(WEB_DIR, 'tests', 'integration', 'harness', 'next-link-stub.tsx'),
    },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  await buildCss(bundleDir);
  ({ server, origin } = await serve(bundleDir));
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

test('live view: dark, transcript beside answers when wide, no layout shift while streaming', async () => {
  const size: Width = { width: 1440, height: 900, touch: false };
  const watched = await open('live', size);
  const { page } = watched;
  // The call window follows the call's Theme setting, Dark until chosen (v1.3.0); the computer's dark
  // preference too, in case a picture run stored System.
  await page.emulateMedia({ colorScheme: 'dark' });
  const transcriptBox = await box(page, '[aria-label="Live transcript"]');
  const panel = '[aria-label="Answers"]';
  expect(transcriptBox.x).toBeLessThan((await box(page, panel)).x);

  // Speaker colours and the provisional line (theme §6).
  const colours = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[aria-label="Live transcript"] li')];
    const label = (name: string) =>
      // v1.3.2: above each turn are its name and time; the name carries the speaker's colour.
      getComputedStyle(
        items.find((li) => li.getAttribute('aria-label') === name)!.firstElementChild!
          .firstElementChild!,
      ).color;
    const provisional = document.querySelector('[aria-label="Live transcript"] li span.italic');
    if (!provisional) return { lines: items.map((li) => li.textContent) };
    return {
      you: label('You said'),
      them: label('Them said'),
      provisional: getComputedStyle(provisional).color,
      italic: getComputedStyle(provisional).fontStyle,
    };
  });
  expect(colours).toEqual({
    you: 'rgb(34, 197, 94)',
    them: 'rgb(212, 212, 216)',
    provisional: 'rgb(161, 161, 170)',
    italic: 'italic',
  });
  await shot(watched, size, 'live-empty');

  // Stream an answer: measure when only the headline is there, then when the bullets are.
  await page.getByRole('button', { name: 'Answer', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Answer line' })).toContainText(HEADLINE);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  // The card grows as words arrive (its footer follows them); everything around it stays still.
  const toolbar = '[aria-label="Call controls"]';
  const message = '[aria-label="Message"]';
  const before = {
    toolbar: await box(page, toolbar),
    panel: await box(page, panel),
    message: await box(page, message),
  };
  await expect(
    page.getByRole('list', { name: 'Answer details' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const after = {
    toolbar: await box(page, toolbar),
    panel: await box(page, panel),
    message: await box(page, message),
  };
  expect(after).toEqual(before);
  await shot(watched, size, 'live-streaming');
  await expect(page.getByLabel('Time to first word')).toBeVisible({ timeout: 10_000 });
  await shot(watched, size, 'live');
  await watched.context.close();
});

test('live view stacks answers above the transcript when narrower than 900 px', async () => {
  for (const size of [
    { width: 900, height: 900, touch: false },
    // A narrow window on a touch-screen Windows laptop: still a computer, so the live view.
    { width: 390, height: 844, touch: true },
  ] as const) {
    const watched = await open('live', size);
    const { page } = watched;
    const panel = await box(page, '[aria-label="Answers"]');
    const transcript = await box(page, '[aria-label="Live transcript"]');
    expect(panel.y).toBeLessThan(transcript.y);
    // Nothing runs past the window's edge. Clipped content does not make the page scroll sideways,
    // so the page check cannot see it.
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, [aria-label="Live transcript"], li')]
        .filter((element) => element.offsetParent !== null)
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
        .map((element) => element.textContent?.trim().slice(0, 40)),
    );
    expect(clipped, 'nothing is cut off at the right').toEqual([]);
    // A key-cap on the primary button can be read: its chip is not the button's text colour.
    const answer = page.getByRole('button', { name: 'Answer', exact: true }).first();
    const [text, chip] = await answer.evaluate((button) => [
      getComputedStyle(button).color,
      getComputedStyle(button.querySelector('kbd')!).backgroundColor,
    ]);
    expect(chip).not.toBe(text);
    expect(chip).not.toBe('rgb(255, 255, 255)');
    await shot(watched, size, 'live');
    await watched.context.close();
  }
});

test('the "Claude unavailable" message in the answer panel', async () => {
  const size: Width = { width: 1440, height: 900, touch: false };
  const watched = await open('live', size);
  const { page } = watched;
  await page.getByRole('button', { name: 'Chat' }).click();
  await page.getByLabel('Type a question').fill('UNAVAILABLE');
  await page.getByLabel('Type a question').press('Enter');
  const alert = page.getByRole('region', { name: 'Answer' }).getByRole('alert');
  await expect(alert).toContainText('Claude unavailable');
  await expect(alert).toContainText(CLAUDE_UNAVAILABLE_MESSAGES.usageLimit);
  // The app logs the failed answer on purpose (ids and the code only): expected here, and the
  // only console line allowed.
  const expected = watched.problems.filter((line) => line.includes('answer: failed'));
  expect(expected.length).toBe(1);
  expect(expected[0]).toContain('claude_unavailable');
  watched.problems.splice(
    0,
    watched.problems.length,
    ...watched.problems.filter((line) => !line.includes('answer: failed')),
  );
  await shot(watched, size, 'live-unavailable');
  await watched.context.close();
});

test('the Connect card: audio source, microphone, tips, and how to connect', async () => {
  for (const size of [
    { width: 1440, height: 900, touch: false },
    { width: 900, height: 900, touch: false },
  ] as const) {
    const watched = await open('connect', size);
    const { page } = watched;
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect call session' })).toBeVisible();
    await expect(
      page.getByText('Ready when you are. Connect to start the transcript.'),
    ).toBeVisible();
    await expect(page.getByText('This is a Regular session about')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Audio source' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Microphone' })).toHaveText('System default');
    // ADR-0053: the microphone can be tested here, and Connect is the only step (no Go live).
    await expect(page.getByRole('button', { name: 'Test microphone' })).toBeVisible();
    await expect(page.getByText('Check your microphone before the call.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go live' })).toHaveCount(0);
    await expect(page.getByText(/Sound check/)).toHaveCount(0);
    const tips = page.getByRole('list', { name: 'Tips' });
    await expect(tips).toContainText('Use headphones so your mic doesn’t pick up the other side.');
    await expect(tips).toContainText('Test Private with your phone before a real call.');
    await expect(tips).toContainText('No call to practise on? Play a mock interview on YouTube.');
    await tips.getByRole('button', { name: 'Why' }).click();
    await expect(tips).toContainText('show up as You');
    await expect(tips.getByRole('link', { name: 'How' })).toHaveAttribute('href', '/help');
    await expect(tips.getByRole('link', { name: 'Open' })).toHaveAttribute('href', /youtube\.com/);
    await expect(page.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
    await page.getByText('Need it for macOS?').hover();
    await expect(page.getByRole('tooltip')).toHaveText('Coming soon');
    await shot(watched, size, 'connect');
    // Each way of calling opens a short how-to for this platform.
    await page.getByRole('button', { name: 'Ways of calling' }).click();
    await expect(
      page.getByRole('list', { name: 'Ways of calling' }).getByRole('button'),
    ).toHaveText([/Zoom/, /Teams/, /Google Meet/, /Webex/, /Phone/]);
    await page.getByRole('button', { name: 'Google Meet' }).click();
    const howTo = page.getByRole('dialog', { name: 'Connect Google Meet' });
    await expect(howTo).toContainText('Also share tab audio');
    await howTo.getByRole('button', { name: 'Got it' }).click();
    // Exact: "Test microphone" also contains "phone".
    await page.getByRole('button', { name: 'Phone', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Connect Phone' })).toContainText('desktop app');
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Video tutorial: coming soon')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'No call to share? Open a mock interview video' }),
    ).toHaveAttribute('rel', 'noreferrer');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toBeVisible();
    await watched.context.close();
  }
});

test('phones: "Live calls need a computer"; computers: the live page', async () => {
  const phone: Width = { width: 390, height: 844, touch: true };
  const watched = await open('gate', phone, IPHONE_UA);
  await expect(
    watched.page.getByRole('heading', { name: 'Live calls need a computer' }),
  ).toBeVisible();
  await expect(watched.page.getByRole('link', { name: 'Review past sessions' })).toHaveAttribute(
    'href',
    '/',
  );
  await shot(watched, phone, 'live-phone');
  await watched.context.close();
  const computer = await open('gate', { width: 1440, height: 900, touch: false });
  await expect(computer.page.getByText('Live calls are supported here.')).toBeVisible();
  await computer.context.close();
});

test('overlay: three bars, the answer in full, one scroll area, at default and smallest size', async () => {
  for (const size of [
    { width: 720, height: 520, touch: false },
    { width: 460, height: 260, touch: false },
  ] satisfies Width[]) {
    const watched = await open('compact', size);
    const { page } = watched;
    await expect(page.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
    // ADR-0082: bar 2 is the one status bar.
    await expect(page.getByRole('group', { name: 'Status bar' })).toBeVisible();
    await expect(page.getByLabel('Latest words')).toContainText('the Professional plan');
    await expect(page.getByLabel('Question', { exact: true })).toContainText('Professional plan');
    await expect(page.getByRole('heading', { name: 'Answer line' })).toContainText(
      'Forty seats cost 2,080 dollars a month.',
    );
    // Nothing is hidden behind a click, and the note is set apart from what to say.
    await expect(page.getByText('52 dollars per seat on Professional')).toBeAttached();
    await expect(page.getByLabel('Tip')).toContainText('annual');
    await expect(page.getByLabel('Private note')).toContainText('finance');
    // Everything fits the bars: only the answer scrolls, never the window.
    const fits = await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight + 1,
    );
    expect(fits, 'the window itself does not scroll').toBe(true);
    await shot(watched, size, `overlay-${size.width}`);

    // The current live question sits on the status bar (v1.1.0: not on the answer).
    await expect(page.getByLabel('Current question from the other person')).toContainText(
      'What would the Professional plan cost',
    );
    // Collapse leaves only the controls.
    await page.getByRole('button', { name: 'Collapse the overlay' }).click();
    await expect(page.getByRole('region', { name: 'Latest answer' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open the overlay' }).click();
    await expect(page.getByRole('region', { name: 'Latest answer' })).toBeVisible();
    // The status bar's Clear hides the words on screen; the answer stays (v1.1.0).
    await page
      .getByRole('group', { name: 'Status bar' })
      .getByRole('button', { name: 'Clear transcript' })
      .click();
    await expect(page.getByLabel('Latest words')).not.toContainText('the Professional plan');
    await expect(page.getByRole('heading', { name: 'Answer line' })).toBeVisible();
    // The menu: Private and the full call window live here (v1.1.0).
    await page.getByRole('button', { name: 'Overlay menu' }).click();
    await expect(page.getByRole('group', { name: 'Overlay settings' })).toContainText('Private');
    await expect(page.getByRole('button', { name: 'Open call window' })).toBeVisible();
    await watched.context.close();
  }
  const size: Width = { width: 720, height: 520, touch: false };
  const unavailable = await open('compact-unavailable', size);
  await expect(unavailable.page.getByRole('alert')).toContainText('usage limit');
  await shot(unavailable, size, 'overlay-unavailable');
  await unavailable.context.close();
});

test('overlay: a coding answer, a figure to check and a private answer fit (ADR-0030)', async () => {
  for (const size of [
    { width: 720, height: 520, touch: false },
    { width: 460, height: 260, touch: false },
  ] satisfies Width[]) {
    const coding = await open('compact-coding', size);
    const { page } = coding;
    await expect(page.getByLabel('About this answer')).toContainText('General knowledge');
    await expect(page.getByLabel('Question type: choose another to answer again')).toHaveValue(
      'coding',
    );
    await expect(page.locator('pre')).toContainText('def reverse');
    await expect(page.getByLabel('How to say it')).toContainText('one pass');
    await expect(page.locator('[data-claim]')).toHaveText('37');
    await expect(page.getByLabel('Check before saying')).toContainText('37');
    // v1.0.4: no list of other answers under the card (the call window has them).
    await expect(page.getByRole('list', { name: 'Other answers' })).toHaveCount(0);
    // Long code scrolls inside its own block: never the window, and never sideways.
    const fits = await page.evaluate(
      () =>
        document.documentElement.scrollHeight <= window.innerHeight + 1 &&
        document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits, 'the window itself does not scroll').toBe(true);
    await shot(coding, size, `overlay-coding-${size.width}`);
    // ADR-0082: the overlay has no Chat button and no message box (Ctrl+Shift+Space asks by voice).
    await expect(page.getByRole('button', { name: 'Chat' })).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Who the answer is for' })).toHaveCount(0);
    await coding.context.close();

    const privately = await open('compact-private', size);
    await expect(privately.page.getByLabel('Private answer')).toContainText('397.8');
    await expect(privately.page.getByLabel('About this answer')).toContainText('Just for you');
    await shot(privately, size, `overlay-private-${size.width}`);
    await privately.context.close();
  }
});

test('auto-answer: answers each finished question by itself, once (v1.4: no 15 s limit)', async () => {
  test.setTimeout(60_000);
  const size: Width = { width: 1440, height: 900, touch: false };
  const watched = await open('auto', size);
  const { page } = watched;
  // Count the real answers sent (warm-ups excluded).
  let answers = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/answer') && !request.postData()?.includes('"mode":"warm"')) {
      answers += 1;
    }
  });
  const addThem = (text: string) =>
    page.evaluate(
      (line) => (window as unknown as { addThemLine: (t: string) => void }).addThemLine(line),
      text,
    );

  // The opening lines ended over a minute ago: too old to answer by itself (v1.4, AUTO_MAX_AGE_MS).
  await page.waitForTimeout(2_000);
  expect(answers, 'no auto-answer for the opening lines').toBe(0);
  // The grey "You" line of the fixture is stuck after 5 s (STALE_PARTIAL_MS), so it no longer counts as
  // the user speaking.
  await page.waitForTimeout(3_500);
  await addThem('WHAT DOES THE ANNUAL PLAN COST FOR FORTY SEATS');
  const panel = page.getByRole('region', { name: 'Answer' });
  await expect(panel.getByText('Auto', { exact: true })).toBeVisible({ timeout: 5_000 });
  expect(answers).toBe(1);

  // v1.4 (ADR-0062): a new question a few seconds later gets its own answer (the old 15 s limit is
  // gone: one answer per question instead), once.
  await page.waitForTimeout(5_000);
  await addThem('HOW LONG DOES THE ROLLOUT TAKE');
  await expect.poll(() => answers, { timeout: 4_000 }).toBe(2);
  await page.waitForTimeout(3_000);
  expect(answers, 'each question answered once').toBe(2);
  await shot(watched, size, 'live-auto-answer');
  await watched.context.close();
});

/** The two widths each error state is photographed at (Day 6 Stage 4e). */
const ERROR_SIZES: Width[] = [
  { width: 1440, height: 900, touch: false },
  { width: 390, height: 844, touch: true },
];

/**
 * Removes the expected console lines of a failed answer: the app's "answer: failed" (ids and
 * the code only) and the browser's own line for the mocked 401 response.
 *
 * @param watched The page's console problems.
 * @returns Nothing.
 */
function dropExpectedFailures(watched: WatchedPage): void {
  watched.problems.splice(
    0,
    watched.problems.length,
    ...watched.problems.filter(
      (line) =>
        !line.includes('answer: failed') &&
        !line.includes('status of 401') &&
        // This test goes offline on purpose, so requests made meanwhile fail.
        !line.includes('ERR_INTERNET_DISCONNECTED'),
    ),
  );
}

test('error states: no connection pauses answers; signed out offers sign-in in place', async () => {
  for (const size of ERROR_SIZES) {
    const watched = await open('live', size);
    const { page } = watched;
    // Let the session warm-up finish first: going offline mid-request logs an expected warning.
    await page.waitForLoadState('networkidle');
    await watched.context.setOffline(true);
    const banner = page.getByRole('alert').filter({ hasText: 'Answers are paused' });
    await expect(banner).toBeVisible();
    dropExpectedFailures(watched);
    await shot(watched, size, 'error-offline');
    await watched.context.setOffline(false);
    await expect(banner).toBeHidden();

    await page.getByRole('button', { name: 'Chat' }).click();
    await page.getByLabel('Type a question').fill('SIGNEDOUT');
    await page.getByLabel('Type a question').press('Enter');
    const box = page.getByRole('region', { name: 'Answer' }).getByRole('alert');
    await expect(box).toContainText('Signed out');
    await expect(box).toContainText('stay as they are');
    dropExpectedFailures(watched);
    await shot(watched, size, 'error-signed-out');
    await box.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page.getByRole('dialog', { name: 'Sign in again' })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await shot(watched, size, 'error-sign-in-again');
    dropExpectedFailures(watched);
    await watched.context.close();
  }
});

test('error states: the other side silent (1.5.1: 15 s while the user talks)', async () => {
  for (const size of ERROR_SIZES) {
    const watched = await open('live-errors', size);
    await expect(
      watched.page.getByRole('alert').filter({ hasText: "We can't hear the other side" }),
    ).toBeVisible();
    // Day 6 Stage 4: the stuck-engine watchdog's note (shown here alongside the silent notice).
    await expect(
      watched.page.getByRole('status').filter({ hasText: 'Transcription restarted' }),
    ).toBeVisible();
    await shot(watched, size, 'error-them-silent');
    await watched.context.close();
  }
});

test('the Connect card: with the microphone allowed, its meter runs instead of Test microphone', async () => {
  // ADR-0053: the level shows before the call; the other side's level shows once connected.
  const size = { width: 1440, height: 900, touch: false } as const;
  const watched = await open('connect-mic', size);
  const { page } = watched;
  await expect(page.getByRole('meter', { name: 'You audio level' })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Them audio level' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Test microphone' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect' })).toBeEnabled();
  await shot(watched, size, 'connect-mic');
  await watched.context.close();
});

test('error states: microphone denied and speech model download failed', async () => {
  for (const size of ERROR_SIZES) {
    const watched = await open('connect-errors', size);
    await expect(watched.page.getByRole('alert').filter({ hasText: 'microphone' })).toBeVisible();
    await expect(watched.page.getByRole('alert').filter({ hasText: 'disk space' })).toBeVisible();
    await shot(watched, size, 'error-connect');
    await watched.context.close();
  }
});

/** Busy backgrounds behind the overlay: thin stripes, so a bad blur or weak panel would show. */
const BACKDROPS = {
  light:
    'repeating-linear-gradient(45deg, rgb(255, 255, 255) 0 18px, rgb(235, 235, 240) 18px 36px, rgb(255, 214, 102) 36px 54px, rgb(255, 255, 255) 54px 72px)',
  dark: 'repeating-linear-gradient(45deg, rgb(10, 10, 12) 0 18px, rgb(60, 60, 70) 18px 36px, rgb(120, 30, 30) 36px 54px, rgb(10, 10, 12) 54px 72px)',
} as const;

/** The desktop overlay window's sizes (apps/desktop/src/windows.ts). */
const OVERLAY_SIZES = {
  default: { width: 720, height: 520, touch: false },
  min: { width: 460, height: 260, touch: false },
} as const;

/**
 * Opens the overlay as a desktop app would have it.
 *
 * @param size  The window.
 * @param extra More of the address: the panels, the shell.
 * @returns The page, with a way to read what it asked for.
 */
async function openOverlayView(size: Width, extra = '') {
  const watched = await open('gate', size);
  // KITE_VISUAL_THEME: the pictures of the light theme (spec §7).
  const theme = process.env.KITE_VISUAL_THEME === 'light' ? '&theme=light' : '';
  await watched.page.goto(`${origin}/?view=compact&glass=1&alpha=0.82${extra}${theme}`);
  await watched.page.getByRole('toolbar', { name: 'Overlay controls' }).waitFor();
  return {
    ...watched,
    log: () =>
      watched.page.evaluate(() => (window as unknown as { overlayLog: unknown[] }).overlayLog),
  };
}

/** A layout the view gave the shell, as the harness logs it. */
interface LoggedLayout {
  /** The layout. */
  layout: {
    /** How tall the view asked the window to be. */
    popupHeight: number;
  };
}

/**
 * Whether a log entry is a layout.
 *
 * @param entry The entry.
 * @returns True for a layout.
 */
function isLoggedLayout(entry: unknown): entry is LoggedLayout {
  return typeof entry === 'object' && !!entry && 'layout' in entry;
}

/** The window the bars are drawn for. */
const BARS_SIZE: Width = { width: 900, height: 520, touch: false };

/** A window wide enough for both panels side by side. */
const WIDE_SIZE: Width = { width: 1080, height: 560, touch: false };

test('ADR-0055: accounts without sync keep the classic bar 1 (ADR-0082: no chat bar there either)', async () => {
  const classic: Width = { width: 780, height: 520, touch: false };
  const watched = await openOverlayView(classic, '&panels=none&shell=1&look=classic');
  const { page } = watched;
  const bar = page.getByRole('toolbar', { name: 'Overlay controls' });
  await expect(bar.getByRole('switch', { name: 'Transcript' })).toHaveCount(0);
  // ADR-0082: no Answer, Screenshot or Chat buttons (their shortcuts still work), and the bar fits with
  // ⋮ and Exit whole.
  for (const name of ['Answer', 'Screenshot', 'Chat']) {
    await expect(bar.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect
    .poll(() => barFit(page))
    .toMatchObject({ barFits: true, leftFits: true, exitInside: true, menuInside: true });
  // No chat bar and no message box anywhere on the overlay.
  await expect(page.getByRole('group', { name: 'Chat' })).toHaveCount(0);
  await expect(page.getByLabel('Type a question')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Status bar' })).toBeVisible();
  await watched.context.close();
});

/**
 * The names of bar 1's controls, in order (the device icons' states left out).
 *
 * @param page The overlay's page.
 * @returns Each button's, picture's and timer's name.
 */
async function barWords(page: Page): Promise<(string | undefined)[]> {
  const words = await page
    .getByRole('toolbar', { name: 'Overlay controls' })
    .evaluate((element) =>
      [...element.querySelectorAll('button,[role="img"],[role="timer"]')].map(
        (item) => item.getAttribute('aria-label') ?? item.textContent?.trim(),
      ),
    );
  return words.filter((word) => !word?.includes('capturing') && !word?.includes('not connected'));
}

test('S13: bar 1 in order, 44 tall, nothing cut off; ADR-0082: no Answer, Screenshot or Chat', async () => {
  // 1.6.3 (ADR-0075): at the desktop overlay's default width.
  const watched = await openOverlayView(
    { width: 980, height: 480, touch: false },
    '&panels=none&shell=1',
  );
  const { page } = watched;
  const bar = page.getByRole('toolbar', { name: 'Overlay controls' });
  expect((await bar.boundingBox())!.height).toBeCloseTo(44, 0);
  expect(await barWords(page)).toEqual([
    'Choose audio source',
    'Choose microphone',
    // ADR-0055: the Transcript pill with its switch.
    'Transcript',
    // 1.6.3 (ADR-0075): Auto answer moved here from its floating pill.
    'Auto answer',
    'Drag here to move',
    'Shrink to an icon',
    'Call time',
    'Overlay menu',
    'Exit: end call',
  ]);
  // ADR-0082: the shortcuts still work, but bar 1 has no buttons for them.
  for (const name of ['Answer', 'Screenshot', 'Chat']) {
    await expect(bar.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await shot(watched, BARS_SIZE, 'call-bars');
  // ADR-0082: where clicks can pass (a desktop shell from 1.3.0), the Click-through switch follows Auto
  // answer.
  await page.goto(overlayUrl('&panels=none&ct=off'));
  await bar.waitFor();
  expect(await barWords(page)).toEqual([
    'Choose audio source',
    'Choose microphone',
    'Transcript',
    'Auto answer',
    'Click-through',
    'Drag here to move',
    'Shrink to an icon',
    'Call time',
    'Overlay menu',
    'Exit: end call',
  ]);
  // At the width a 1.1.0 window keeps, at its smallest, and in a narrow picture-in-picture window,
  // everything still fits: nothing on the left is cut off, and ⋮ and Exit are whole.
  const exit = bar.getByRole('button', { name: 'Exit: end call' });
  for (const width of [900, 780, 680, 560, 460]) {
    await page.setViewportSize({ width, height: 400 });
    await expect
      .poll(() => barFit(page), { message: `bar 1 fits ${width}` })
      .toMatchObject({ barFits: true, leftFits: true, exitInside: true, menuInside: true });
  }
  // Exit is red, and one press ends the call (9 Nov 2026: no "End call?" step).
  await page.setViewportSize({ width: 780, height: 400 });
  await expect(exit).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await exit.click();
  expect(await watched.log()).toContainEqual({ type: 'end' });
  await expect(bar.getByRole('button', { name: 'End call?' })).toHaveCount(0);
  await watched.context.close();
});

test('S13: bar 2 is the one status bar, under bar 1; the level button opens the transcript; Auto answer is on bar 1 (1.6.3)', async () => {
  const watched = await openOverlayView(BARS_SIZE, '&panels=none');
  const { page } = watched;
  const bar1 = (await page.getByRole('toolbar', { name: 'Overlay controls' }).boundingBox())!;
  // ADR-0082: one row (was the two-row "Live transcript bar"), left-aligned with bar 1 and no wider.
  const region = page.getByRole('group', { name: 'Status bar' });
  await expect(region).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Live transcript bar' })).toHaveCount(0);
  const bar2 = (await region.boundingBox())!;
  expect(Math.abs(bar2.x - bar1.x)).toBeLessThanOrEqual(2);
  expect(bar2.y).toBeGreaterThanOrEqual(bar1.y + bar1.height);
  expect(bar2.width).toBeLessThanOrEqual(bar1.width + 1);
  expect(bar2.height).toBeCloseTo(44, 0);
  // In order: the level button, the language, the line (the live words), Clear and collapse.
  const names = await region.evaluate((element) =>
    [...element.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
  );
  expect(names).toEqual([
    'Show the transcript',
    expect.stringMatching(/^Answer language: /),
    'Latest words: open the transcript',
    'Clear transcript',
    'Hide the status bar',
  ]);
  await expect(region.getByRole('button', { name: /^Answer language: / })).toBeVisible();
  await expect(
    region.getByRole('button', { name: 'Clear transcript' }).locator('kbd'),
  ).toContainText('⌫');
  await expect(region.getByRole('button', { name: 'Clear transcript' })).toContainText('Clear');
  // 1.6.3 (ADR-0075): no floating Auto answer pill beside it; the toggle is on bar 1, and toggles.
  await expect(page.getByRole('button', { name: /^Auto answer / })).toHaveCount(0);
  const toggle = page
    .getByRole('toolbar', { name: 'Overlay controls' })
    .getByRole('switch', { name: 'Auto answer' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  expect(await watched.log()).toContainEqual({ type: 'auto-answer', on: true });
  // The page says how tall the bars are, so any shell from 1.1.0 fits them.
  const heights = (await watched.log())
    .filter(isLoggedLayout)
    .map((entry) => entry.layout.popupHeight);
  expect(heights.at(-1)).toBeGreaterThanOrEqual(bar2.y + bar2.height);
  // The language list stays in the page, and the window is asked to fit it.
  await region.getByRole('button', { name: /^Answer language: / }).click();
  await expect(page.getByRole('listbox', { name: 'Answer language' })).toBeVisible();
  await page.keyboard.press('Escape');
  await region.getByRole('button', { name: 'Show the transcript' }).click();
  const panel = page.getByRole('region', { name: 'Transcript panel' });
  await expect(panel).toBeVisible();
  // ADR-0082: the panel's header is the same status bar (one on screen): its level button and collapse
  // close the panel, and its line does not repeat the words that are in the panel.
  await expect(region).toHaveCount(1);
  const header = panel.getByRole('group', { name: 'Status bar' });
  await expect(header.getByRole('button', { name: 'Hide the transcript' })).toBeVisible();
  await expect(header.getByLabel('Latest words')).toHaveCount(0);
  await header.getByRole('button', { name: 'Close the transcript' }).click();
  await expect(panel).toHaveCount(0);
  await expect(region.getByLabel('Latest words')).toBeVisible();
  await watched.context.close();
});

test('S13: the icon: 48 px, drags without restoring, restores on a click or the keyboard', async () => {
  const watched = await openOverlayView(BARS_SIZE, '&panels=none&shell=1');
  const { page } = watched;
  await page.getByRole('button', { name: 'Shrink to an icon' }).click();
  const icon = page.getByRole('button', { name: 'Restore the overlay' });
  const box = (await icon.boundingBox())!;
  expect(box.width).toBe(48);
  expect(box.height).toBe(48);
  expect(await watched.log()).toContainEqual({ mode: 'icon' });
  await expect(page.getByRole('toolbar', { name: 'Overlay controls' })).toHaveCount(0);
  await shot(watched, BARS_SIZE, 'call-icon');
  // A drag moves the window and does not restore the overlay.
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect(icon).toBeVisible();
  const moves = (await watched.log()).filter(
    (entry) => typeof entry === 'object' && !!entry && 'move' in entry,
  );
  expect(moves.length).toBeGreaterThan(0);
  // A click restores it.
  await icon.click();
  await expect(page.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  expect((await watched.log()).at(-1)).toMatchObject({ layout: expect.anything() });
  // And so does the keyboard.
  await page.getByRole('button', { name: 'Shrink to an icon' }).click();
  await icon.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  await watched.context.close();
});

test('S13: a shell before 1.2.0 has no icon: compact collapses to bar 1 and opens again', async () => {
  const watched = await openOverlayView(BARS_SIZE, '&panels=none');
  const { page } = watched;
  await expect(page.getByRole('button', { name: 'Shrink to an icon' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse the overlay' }).click();
  expect(await watched.log()).toContainEqual({ mode: 'collapsed' });
  const statusBar = page.getByRole('group', { name: 'Status bar' });
  await expect(statusBar).toHaveCount(0);
  await page.getByRole('button', { name: 'Open the overlay' }).click();
  await expect(statusBar).toBeVisible();
  // Bar 2's collapse does the same, and bar 1 opens it again.
  await page.getByRole('button', { name: 'Hide the status bar' }).click();
  await expect(statusBar).toHaveCount(0);
  await page.getByRole('button', { name: 'Open the overlay' }).click();
  await expect(statusBar).toBeVisible();
  await watched.context.close();
});

/** ADR-0082: one message the status bar can show, as the harness's ?status= sets it up. */
interface StatusCase {
  /** The ?status= value (harness/live.tsx statusParams()). */
  status: string;
  /** The message's key (data-status). */
  key: string;
  /** The line's words. */
  text: string | RegExp;
  /** Its button. */
  button: string;
  /** What the button sends to the live page, or null when it opens a list on the overlay. */
  sends: object | null;
  /** True for an alert (it stays when the overlay is collapsed to bar 1). */
  alert: boolean;
}

/** ADR-0082: the status bar's messages and their buttons (statusLine.ts). */
const STATUS_CASES: readonly StatusCase[] = [
  {
    status: 'them-silent',
    key: 'them-silent',
    text: "Can't hear the other side",
    button: 'Choose audio source',
    sends: null,
    alert: true,
  },
  {
    status: 'listening',
    key: 'listening',
    text: 'Listening… (Esc cancels)',
    button: 'Cancel',
    sends: { type: 'voice-cancel' },
    alert: false,
  },
  {
    status: 'headphones',
    key: 'headphones',
    text: 'Speakers echoing — use headphones',
    button: 'OK',
    sends: { type: 'headphones-seen' },
    alert: false,
  },
  {
    status: 'still-here',
    key: 'still-here',
    text: 'Still in a call?',
    button: 'Yes',
    sends: { type: 'still-here' },
    alert: false,
  },
  {
    status: 'paused',
    key: 'paused',
    text: /^Listening is paused/,
    button: 'Resume',
    sends: { type: 'resume' },
    alert: false,
  },
  {
    status: 'answer-key',
    key: 'answer-key',
    text: 'Ctrl+Enter is used by another app',
    button: 'Hotkeys',
    sends: { type: 'hotkey-settings' },
    alert: true,
  },
];

test('ADR-0082: the status bar shows the current message with its button; no separate warning bars', async () => {
  const watched = await openOverlayView(BARS_SIZE, '&panels=none');
  const { page } = watched;
  const statusBar = page.getByRole('group', { name: 'Status bar' });
  for (const { status, key, text, button, sends, alert } of STATUS_CASES) {
    await page.goto(overlayUrl(`&panels=none&status=${status}`));
    await statusBar.waitFor();
    const line = statusBar.locator(`[data-status="${key}"]`);
    // The message takes the line's place: the live words are not shown with it.
    await expect(line, status).toBeVisible();
    await expect(line.getByRole(alert ? 'alert' : 'status'), status).toHaveText(text);
    await expect(statusBar.getByLabel('Latest words'), status).toHaveCount(0);
    // One bar: nothing else on the overlay says it (the old warning bars under bar 1 are gone).
    await expect(page.getByText(text), status).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Status bar' }), status).toHaveCount(1);
    await line.getByRole('button', { name: button, exact: true }).click();
    if (sends) expect(await watched.log(), status).toContainEqual(sends);
    else {
      // "Choose audio source" opens the device list on the overlay.
      await expect(page.getByRole('group', { name: 'Audio source' }), status).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }

  // The "can't hear" message stays visible when the overlay collapses to bar 1 (it needs the user); the
  // headphones hint does not.
  await page.goto(overlayUrl('&panels=none&status=them-silent'));
  await statusBar.getByRole('button', { name: 'Hide the status bar' }).click();
  await expect(statusBar.locator('[data-status="them-silent"]')).toBeVisible();
  await shot(watched, BARS_SIZE, 'call-status-collapsed-alert');
  await page.goto(overlayUrl('&panels=none&status=headphones'));
  await statusBar.getByRole('button', { name: 'Hide the status bar' }).click();
  await expect(statusBar).toHaveCount(0);

  // With the transcript panel open, its header (the same status bar) carries the message.
  await page.goto(overlayUrl('&panels=transcript&status=listening'));
  const panel = page.getByRole('region', { name: 'Transcript panel' });
  await expect(panel.locator('[data-status="listening"]')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Status bar' })).toHaveCount(1);
  await shot(watched, BARS_SIZE, 'call-status-listening');
  await watched.context.close();
});

test('S15: the panels sit side by side when wide, stack when narrow; bubbles and the answer card', async () => {
  const watched = await openOverlayView(WIDE_SIZE, '&panels=transcript,answer&shell=1');
  const { page } = watched;
  const transcript = page.getByRole('region', { name: 'Transcript panel' });
  const answer = page.getByRole('region', { name: 'Latest answer' });
  const left = (await transcript.boundingBox())!;
  const right = (await answer.boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(2);
  // The bars keep their width, centred over the panels.
  const bar1 = (await page.getByRole('toolbar', { name: 'Overlay controls' }).boundingBox())!;
  // ADR-0055: 900 wide since bar 1 holds the Transcript pill; ADR-0068 (1.5.0): 980 with the Rec pill.
  expect(bar1.width).toBeLessThanOrEqual(982);
  expect(Math.abs(bar1.x + bar1.width / 2 - 540)).toBeLessThanOrEqual(2);

  // v1.3.2 (like an Otter export): every turn from the same left edge, "<name>  <mm:ss>" above its words.
  const you = page.getByRole('listitem', { name: 'You said' }).first();
  const them = page.getByRole('listitem', { name: 'Them said' }).first();
  await expect(you).toBeVisible();
  await expect(them).toBeVisible();
  const youBox = (await you.boundingBox())!;
  const themBox = (await them.boundingBox())!;
  expect(Math.abs(youBox.x - themBox.x)).toBeLessThanOrEqual(1);
  await expect(you.locator(':scope > span').first()).toHaveText(/^You\s*\d\d:\d\d/);
  // v1.3.0 (ADR-0057): the reference's lines, 17/600 with a 14 px name and time line.
  await expect(you.locator(':scope > span').last()).toHaveCSS('font-size', '17px');
  await expect(you.locator(':scope > span').last()).toHaveCSS('font-weight', '600');
  await expect(you.locator(':scope > span').first()).toHaveCSS('font-size', '14px');

  // The header: ← →, Clear and collapse, in one line (1.6.3: Auto answer is on bar 1). ADR-0082: the
  // arrows only, with no Ctrl key-cap (their tooltips name the keys).
  const previous = answer.getByRole('button', { name: 'Previous question' });
  const next = answer.getByRole('button', { name: 'Next question' });
  await expect(previous).toHaveText('←');
  await expect(next).toHaveText('→');
  await expect(previous.locator('kbd')).toHaveCount(0);
  await expect(next.locator('kbd')).toHaveCount(0);
  await expect(previous).toHaveAttribute('title', 'Previous answer (Ctrl+Left)');
  await expect(next).toHaveAttribute('title', 'Next answer (Ctrl+Right)');
  await expect(answer.getByRole('button', { name: /^Auto answer / })).toHaveCount(0);
  await expect(answer.getByRole('switch', { name: 'Auto answer' })).toHaveCount(0);
  // ADR-0082: Clear clears the answers (Ctrl+Backspace); it sends 'clear' to the live page.
  const clear = answer.getByRole('button', { name: 'Clear answers' });
  await expect(clear.locator('kbd')).toContainText('⌫');
  await expect(clear).toHaveAttribute('title', 'Clear answers (Ctrl+Backspace)');
  // The card: the question with a 2 px accent bar, then the bold line.
  const question = answer.getByLabel('Question', { exact: true });
  await expect(question).toHaveCSS('border-left-width', '2px');
  await expect(question).not.toContainText('Question:');
  await expect(answer.getByRole('heading', { name: 'Answer line' })).toHaveCSS(
    'font-weight',
    '700',
  );
  await expect(answer.getByText('Answer:')).toHaveCount(0);
  // The footer: the actions first, how and when last.
  const copy = (await answer.getByRole('button', { name: 'Copy the answer' }).boundingBox())!;
  const up = (await answer.getByRole('button', { name: 'Good answer' }).boundingBox())!;
  const down = (await answer.getByRole('button', { name: 'Bad answer' }).boundingBox())!;
  const when = (await answer.getByText(/^Answer · /).boundingBox())!;
  expect(copy.x).toBeLessThan(up.x);
  expect(up.x).toBeLessThan(down.x);
  expect(down.x).toBeLessThan(when.x);
  // The grip at the bottom right.
  const grip = page.locator('[data-grip="corner"]');
  await expect(grip).toBeVisible();
  const gripBox = (await grip.boundingBox())!;
  expect(gripBox.x + gripBox.width).toBeGreaterThan(right.x + right.width - 16);
  await shot(watched, WIDE_SIZE, 'call-panels');

  // Too narrow for two: they stack, and nothing is cut off sideways.
  await page.setViewportSize({ width: 780, height: 700 });
  const top = (await transcript.boundingBox())!;
  const bottom = (await answer.boundingBox())!;
  expect(top.y + top.height).toBeLessThanOrEqual(bottom.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // ADR-0082: the answer panel's Clear asks the live page to clear the answers (the real clearing is
  // in sim-calls.spec.ts, with the live page).
  await clear.click();
  expect(await watched.log()).toContainEqual({ type: 'clear' });
  await watched.context.close();
});

test('S16: the ⋮ menu in order; Answer preferences as a sheet that fits the overlay', async () => {
  const watched = await openOverlayView(BARS_SIZE, '&panels=answer&shell=1');
  const { page } = watched;
  await page.getByRole('button', { name: 'Overlay menu' }).click();
  const menu = page.getByRole('group', { name: 'Overlay settings' });
  const rows = await menu.evaluate((element) =>
    [...element.querySelectorAll('[role="group"],[role="radiogroup"],p,button,[role="switch"]')]
      .map((row) => row.getAttribute('aria-label') ?? row.textContent?.trim() ?? '')
      .filter((row) => !/: (more|less|reset)$|^About | theme$|the system$/.test(row)),
  );
  expect(rows).toEqual([
    'sam.lee@example.com',
    'Dashboard',
    'Get help',
    'Private',
    'Zoom',
    'Theme',
    'Opacity',
    'Answer text size',
    expect.stringMatching(/^Answer language: /),
    'Auto answer',
    'Answer preferences',
    'Edit session',
    'Open call window',
    'Reset position',
  ]);
  const textSize = menu.getByRole('group', { name: 'Answer text size' }).locator('span').first();
  expect(
    await textSize.evaluate((label) => label.scrollWidth <= label.clientWidth),
    'the longest label is not cut off',
  ).toBe(true);
  await expect(menu.getByRole('button', { name: 'About Answer preferences' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'About Edit session' })).toBeVisible();
  await shot(watched, BARS_SIZE, 'call-menu');
  await menu.getByRole('button', { name: 'Get help' }).click();
  expect(await watched.log()).toContain('help');

  // Answer preferences: Format with STAR, Length, Tone, and a sample; each change goes to the call.
  await page.getByRole('button', { name: 'Overlay menu' }).click();
  await menu.getByRole('button', { name: 'Answer preferences', exact: true }).click();
  const sheet = page.getByRole('group', { name: 'Answer preferences' });
  await expect(sheet.getByRole('region', { name: 'Sample answer' })).toBeVisible();
  await sheet.getByRole('button', { name: /^Tone:/ }).click();
  await sheet.getByRole('option', { name: 'Technical' }).click();
  await sheet.getByRole('switch', { name: 'STAR structure' }).click();
  const styles = (await watched.log()).filter(
    (entry) =>
      typeof entry === 'object' && !!entry && (entry as { type?: string }).type === 'style',
  );
  expect(styles[0]).toMatchObject({ style: { tone: 'technical' } });
  expect(styles[1]).toMatchObject({ style: { star: true } });
  await shot(watched, BARS_SIZE, 'call-preferences');
  await sheet.getByRole('button', { name: 'Back' }).click();
  await expect(menu).toBeVisible();
  // The window is asked to grow for whichever is open.
  const last = (await watched.log()).findLast(isLoggedLayout);
  expect(last?.layout.popupHeight).toBeGreaterThan(0);
  await watched.context.close();
});

test('ADR-0056: the bottom row mirrors the overlay; the ⋮ Position grid; Ctrl+Alt+T toggles the transcript', async () => {
  const watched = await openOverlayView(OVERLAY_SIZES.default, '&position=bottom-left');
  const { page, log } = watched;
  const bar1 = page.getByRole('toolbar', { name: 'Overlay controls' });
  const answer = page.getByRole('region', { name: 'Latest answer' });
  // Bar 1 sits at the bottom edge, the answer panel above it.
  const barBox = (await bar1.boundingBox())!;
  const answerBox = (await answer.boundingBox())!;
  expect(answerBox.y + answerBox.height).toBeLessThanOrEqual(barBox.y);
  expect(barBox.y + barBox.height).toBeGreaterThan(OVERLAY_SIZES.default.height - 12);
  // The ⋮ menu opens upward, over the panel, with the Position grid; the current one is checked.
  await page.getByRole('button', { name: 'Overlay menu' }).click();
  const menu = page.getByRole('group', { name: 'Overlay settings' });
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(barBox.y);
  const grid = menu.getByRole('radiogroup', { name: 'Position' });
  await expect(grid.getByRole('radio')).toHaveCount(6);
  await expect(grid.getByRole('radio', { name: 'Bottom left' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(menu.getByRole('button', { name: 'Reset position' })).toHaveCount(0);
  await menu.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await shot(watched, OVERLAY_SIZES.default, 'overlay-bottom-row-menu');
  await grid.getByRole('radio', { name: 'Top right' }).click();
  expect(await log()).toContainEqual({ position: 'top-right' });
  // Top row: bar 1 back at the top, the answer below it.
  await expect(page.locator('.k-overlay-root')).toHaveAttribute('data-row', 'top');
  const topBar = (await bar1.boundingBox())!;
  expect(topBar.y).toBeLessThan(12);
  expect((await answer.boundingBox())!.y).toBeGreaterThan(topBar.y + topBar.height);
  // Ctrl+Alt+T, with the bars focused: the transcript opens, and closes again.
  await page.keyboard.press('Escape');
  await bar1.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+Alt+t');
  await expect(page.getByRole('region', { name: 'Transcript panel' })).toBeVisible();
  await page.keyboard.press('Control+Alt+t');
  await expect(page.getByRole('region', { name: 'Transcript panel' })).toHaveCount(0);
  await shot(watched, OVERLAY_SIZES.default, 'overlay-position-grid');
});

test('overlay look: panel background at 40% and 82% over light and dark busy backgrounds (ADR-0033)', async () => {
  // The opacity slider dims the panel background only; the text stays opaque with a shadow. Render
  // the minimum (0.4) and the default (0.82, spec §1) over each backdrop and size.
  for (const alpha of [0.4, 0.82]) {
    for (const [sizeName, size] of Object.entries(OVERLAY_SIZES)) {
      for (const [backdropName, backdrop] of Object.entries(BACKDROPS)) {
        const context = await browser!.newContext({
          viewport: { width: size.width, height: size.height },
          userAgent: WINDOWS_UA,
        });
        const page = await context.newPage();
        await page.goto(`${origin}/?view=compact&glass=1&alpha=${alpha}`);
        // The window's own material is the desktop's job; here the backdrop sits on the page, and
        // the panel's backdrop-filter blurs it.
        await page.evaluate((image) => {
          document.documentElement.style.backgroundImage = image;
          document.documentElement.style.backgroundAttachment = 'fixed';
        }, backdrop);
        // Bar 1: each bar and panel is its own piece of glass (v1.1.0).
        const panel = page.locator('.k-overlay.k-glass').first();
        await expect(panel).toBeVisible();
        // Every control of the top bar stays inside the window, End above all.
        const end = await page.getByRole('button', { name: 'End call' }).boundingBox();
        expect(end!.x + end!.width).toBeLessThanOrEqual(size.width);
        const look = await panel.evaluate((element) => {
          const style = getComputedStyle(element);
          const end = element.querySelector('button[aria-label="Exit: end call"]')!;
          return {
            background: style.backgroundColor,
            // The text itself is fully opaque with a shadow, whatever the background opacity.
            textShadow: style.textShadow,
            radius: style.borderRadius,
            blur: style.backdropFilter,
            end: getComputedStyle(end).backgroundColor,
            bodyBackground: getComputedStyle(document.body).backgroundColor,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        expect(look).toEqual({
          background: `rgba(24, 24, 27, ${alpha})`,
          textShadow: 'rgba(0, 0, 0, 0.6) 0px 1px 2px',
          radius: '12px',
          blur: 'blur(16px)',
          end: 'rgb(220, 38, 38)',
          // Clear: otherwise the window's material could not show through.
          bodyBackground: 'rgba(0, 0, 0, 0)',
          overflow: 0,
        });
        if (SHOT_DIR) {
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: path.join(
              SHOT_DIR,
              `overlay-${Math.round(alpha * 100)}-${sizeName}-${backdropName}.png`,
            ),
          });
        }
        await context.close();
      }
    }
  }
});

test('overlay look: picture-in-picture stays solid', async () => {
  const watched = await open('compact', OVERLAY_SIZES.default);
  const panel = watched.page.locator('.k-overlay').first();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('background-color', 'rgb(24, 24, 27)');
  await expect(watched.page.locator('.k-glass')).toHaveCount(0);
  await watched.context.close();
});

test('browser split view: preview and transcript left, answers right; side by side at 1280+, stacked below (live-ui-split)', async () => {
  const CASES = [
    { name: '1440', size: { width: 1440, height: 900, touch: false }, split: true },
    { name: '1280', size: { width: 1280, height: 900, touch: false }, split: true },
    { name: '390', size: { width: 390, height: 844, touch: true }, split: false },
  ] as const;
  for (const { name, size, split } of CASES) {
    const watched = await open('split', size);
    // Both halves are present, with the control strip and the right-side header.
    await expect(
      watched.page.getByRole('region', { name: 'Shared tab and transcript' }),
    ).toBeVisible();
    await expect(watched.page.getByRole('region', { name: 'Answers', exact: true })).toBeVisible();
    await expect(watched.page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(watched.page.getByLabel('Answer language')).toBeVisible();
    await expect(watched.page.getByRole('button', { name: 'End', exact: true })).toBeVisible();
    await expect(watched.page.getByLabel('Call time')).toBeVisible();
    const divider = watched.page.getByRole('separator', { name: 'Resize' });
    const left = await box(watched.page, '[aria-label="Shared tab and transcript"]');
    const right = await box(watched.page, '[aria-label="Answers panel"]');
    if (split) {
      await expect(divider).toBeVisible();
      // Side by side: the answers start to the right of the preview, under the top bar there.
      expect(left.x).toBeLessThan(right.x);
      expect(right.y - left.y).toBeLessThan(90);
    } else {
      await expect(divider).toHaveCount(0);
      // Stacked: the answers sit below the preview column.
      expect(right.y).toBeGreaterThan(left.y);
    }
    if (split) {
      await shot(watched, size, `split-${name}`);
    } else if (SHOT_DIR) {
      // The real app never shows the split view on a touch device (phones get "Live calls need a
      // computer"), so the stacked layout is screenshotted for the record without the mobile
      // touch-target audit that shot() applies.
      await watched.page.evaluate(() => document.fonts.ready);
      await watched.page.screenshot({ path: path.join(SHOT_DIR!, `split-${name}.png`) });
    }
    await watched.context.close();
  }
});

test('browser split view: the shared screen is big, with nothing laid over most of it', async () => {
  const size = { width: 1903, height: 875, touch: false };
  const watched = await open('split', size);
  const video = watched.page.getByLabel('Shared tab preview');
  await expect(video).toBeVisible();
  // The harness's stream is 1920 × 950: the preview takes that shape as soon as it plays.
  await expect
    .poll(async () => {
      const shown = await box(watched.page, '[aria-label="Shared tab preview"]');
      return Math.round((shown.width / shown.height) * 100);
    })
    .toBe(Math.round((1920 / 950) * 100));

  // Edge to edge from the window's corner, over the sidebar, half the window wide.
  const shown = await box(watched.page, '[aria-label="Shared tab preview"]');
  expect(shown.x).toBe(0);
  expect(shown.y).toBe(0);
  expect(shown.width).toBeGreaterThan(size.width * 0.49);

  // The control strip is under the picture, not over it, and the transcript keeps room.
  const stop = await watched.page.getByRole('button', { name: 'Stop' }).boundingBox();
  expect(stop!.y).toBeGreaterThanOrEqual(shown.height);
  const transcript = await box(watched.page, '[aria-label="Live transcript"]');
  expect(transcript.height).toBeGreaterThan(200);
  // Nothing in the window scrolls.
  expect(transcript.y + transcript.height).toBeLessThanOrEqual(size.height);

  // The top bar is only the timer, ⋮ and End; the big buttons are still there.
  const bar = watched.page.getByRole('toolbar', { name: 'Call controls' });
  await expect(bar.getByRole('button')).toHaveCount(2);
  await expect(watched.page.getByRole('button', { name: /^Answer/ })).toHaveCount(1);
  await expect(watched.page.getByRole('button', { name: /^Screenshot/ })).toHaveCount(1);

  // Hiding the answers: the column takes the window's width, and End stays.
  await watched.page.getByRole('button', { name: 'Hide answers' }).click();
  const left = await box(watched.page, '[aria-label="Shared tab and transcript"]');
  expect(left.width).toBe(size.width);
  await expect(watched.page.getByRole('button', { name: 'End', exact: true })).toBeVisible();
  await watched.page.getByRole('button', { name: 'Show answers' }).click();
  await expect(watched.page.getByRole('button', { name: /^Answer/ })).toBeVisible();
  await watched.context.close();
});

/** 1.6.3: the desktop overlay window's real sizes (apps/desktop/src/windows.ts COMPACT_DEFAULT_SIZE, COMPACT_MIN_SIZE). */
const DESKTOP_OVERLAY = {
  default: { width: 980, height: 480, touch: false },
  narrowest: { width: 560, height: 260, touch: false },
} as const;

/**
 * 1.6.3: opens the overlay as desktop 1.6.2 has it (positions, the icon, click-through), at a size,
 * over a busy light page (what shows through the panels).
 *
 * @param size  The window.
 * @param extra More of the address: position, panels, rec, private, auto.
 * @returns The page, with a way to read what it asked for.
 */
async function openDesktopOverlay(size: Width, extra: string) {
  const watched = await openOverlayView(size, `&shell=1${extra}`);
  await watched.page.evaluate((image) => {
    document.documentElement.style.backgroundImage = image;
    document.documentElement.style.backgroundAttachment = 'fixed';
  }, BACKDROPS.light);
  return watched;
}

test('1.6.3 overlay pictures: top and bottom rows, recording with Private off, the narrowest window', async () => {
  test.skip(!SHOT_DIR, 'pictures only (KITE_SCREENSHOT_DIR)');
  const CASES: readonly {
    /** The picture's name. */
    name: string;
    /** The window. */
    size: Width;
    /** The address's switches. */
    extra: string;
    /** A bar-1 switch to hover first, so its tooltip is in the picture. */
    hover?: string;
  }[] = [
    {
      name: 'tooltip-top',
      size: DESKTOP_OVERLAY.default,
      extra: '&position=top-center&rec=on&private=off',
      hover: 'Transcript',
    },
    {
      name: 'tooltip-bottom',
      size: DESKTOP_OVERLAY.default,
      extra: '&position=bottom-center&rec=on&private=off',
      hover: 'Auto answer',
    },
    {
      name: 'tooltip-narrowest',
      size: DESKTOP_OVERLAY.narrowest,
      extra: '&position=top-center&rec=on&private=off&auto=on',
      hover: 'Auto answer',
    },
    { name: 'top-answer', size: DESKTOP_OVERLAY.default, extra: '&position=top-center&rec=off' },
    {
      name: 'top-both',
      size: DESKTOP_OVERLAY.default,
      extra: '&position=top-center&rec=off&panels=transcript,answer',
    },
    {
      name: 'bottom-answer',
      size: DESKTOP_OVERLAY.default,
      extra: '&position=bottom-center&rec=off',
    },
    {
      name: 'bottom-transcript',
      size: DESKTOP_OVERLAY.default,
      extra: '&position=bottom-left&rec=off&panels=transcript',
    },
    {
      name: 'bottom-both',
      size: DESKTOP_OVERLAY.default,
      extra: '&position=bottom-right&rec=off&panels=transcript,answer',
    },
    {
      name: 'recording-private-off',
      size: DESKTOP_OVERLAY.default,
      extra: '&position=top-center&rec=on&private=off',
    },
    {
      name: 'bottom-recording-private-off',
      size: DESKTOP_OVERLAY.default,
      extra: '&position=bottom-center&rec=on&private=off',
    },
    {
      name: 'narrowest-recording-private-off-auto',
      size: DESKTOP_OVERLAY.narrowest,
      extra: '&position=top-center&rec=on&private=off&auto=on',
    },
    {
      name: 'narrowest-bars',
      size: DESKTOP_OVERLAY.narrowest,
      extra: '&position=top-center&rec=off&panels=none',
    },
  ];
  for (const { name, size, extra, hover } of CASES) {
    const watched = await openDesktopOverlay(size, extra);
    await watched.page.evaluate(() => document.fonts.ready);
    if (hover) {
      await watched.page
        .getByRole('toolbar', { name: 'Overlay controls' })
        .getByRole('switch', { name: hover, exact: true })
        .hover();
      await watched.page.getByRole('tooltip').filter({ hasText: hover }).waitFor();
    }
    await watched.page.waitForTimeout(300);
    await watched.page.screenshot({ path: path.join(SHOT_DIR, `overlay-163-${name}.png`) });
    await watched.context.close();
  }
});

/**
 * 1.6.3 (ADR-0075): whether bar 1 fits its window: nothing scrolls sideways, the left side's content fits
 * its room (nothing there is cut off), and ⋮ and Exit are whole inside the bar and the window.
 *
 * @param page The overlay's page.
 * @returns What was measured, and the fit step the bar chose.
 */
async function barFit(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(
      '[role="toolbar"][aria-label="Overlay controls"]',
    )!;
    const content = bar.querySelector<HTMLElement>('[data-fit-step]')!;
    const room = content.parentElement!;
    const barBox = bar.getBoundingClientRect();
    const exit = bar.querySelector('button[aria-label="Exit: end call"]')!.getBoundingClientRect();
    const menu = bar.querySelector('button[aria-label="Overlay menu"]')!.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    return {
      barFits: bar.scrollWidth <= bar.clientWidth,
      leftFits: content.offsetWidth <= room.clientWidth,
      exitInside:
        exit.width > 30 && exit.left >= barBox.left && exit.right <= Math.min(barBox.right, width),
      menuInside: menu.width >= 30 && menu.left >= barBox.left && menu.right <= exit.left,
      step: Number(content.dataset.fitStep),
    };
  });
}

/**
 * 1.6.3: the overlay's address for a set of switches (see harness/live.tsx withOverlayParams()).
 *
 * @param extra The switches: position, panels, rec, private, auto.
 * @returns The address.
 */
const overlayUrl = (extra: string) => `${origin}/?view=compact&glass=1&alpha=0.82&shell=1${extra}`;

test('1.6.3: ⋮ and Exit are always whole; bar 1 gives way in order at the default and narrowest sizes', async () => {
  for (const [sizeName, size] of Object.entries(DESKTOP_OVERLAY)) {
    const watched = await openDesktopOverlay(size, '&position=top-center');
    const { page } = watched;
    for (const rec of ['off', 'on']) {
      for (const privateSetting of ['on', 'off']) {
        for (const auto of ['off', 'on']) {
          const name = `${sizeName} rec ${rec}, Private ${privateSetting}, auto ${auto}`;
          await page.goto(
            overlayUrl(`&position=top-center&rec=${rec}&private=${privateSetting}&auto=${auto}`),
          );
          const bar = page.getByRole('toolbar', { name: 'Overlay controls' });
          await expect(bar.getByRole('switch', { name: 'Auto answer' })).toHaveAttribute(
            'aria-checked',
            auto === 'on' ? 'true' : 'false',
          );
          if (rec === 'on' && privateSetting === 'off') {
            // ADR-0082: the warning is the status bar's message now.
            await expect(page.locator('[data-status="private-off"]')).toBeVisible();
          }
          await expect
            .poll(() => barFit(page), { message: name })
            .toMatchObject({
              barFits: true,
              leftFits: true,
              exitInside: true,
              menuInside: true,
            });
          // The controls that never give way are still there; the timer stays, short; so do move and
          // compact. ADR-0082: no Answer, Screenshot or Chat buttons.
          for (const control of ['Overlay menu', 'Exit: end call', 'Shrink to an icon']) {
            await expect(bar.getByRole('button', { name: control, exact: true })).toBeVisible();
          }
          for (const control of ['Answer', 'Screenshot', 'Chat']) {
            await expect(bar.getByRole('button', { name: control, exact: true })).toHaveCount(0);
          }
          await expect(bar.getByRole('img', { name: 'Drag here to move' })).toBeVisible();
          await expect(bar.getByRole('timer', { name: 'Call time' })).toHaveText(/^\d+:\d\d$/);
          if (sizeName === 'default') {
            // The default window keeps the words on the Transcript and Auto answer switches.
            await expect(bar.getByRole('switch', { name: 'Transcript' })).toHaveText(/Transcript/);
            await expect(bar.getByRole('switch', { name: 'Auto answer' })).toHaveText(/Auto/);
          }
        }
      }
    }
    await watched.context.close();
  }
});

/** 1.6.3: one of bar 1's controls and its tooltip's words. */
interface BarControl {
  /** Its role. */
  role: 'button' | 'img' | 'switch';
  /** Its accessible name (exact when a string). */
  name: string | RegExp;
  /** What its tooltip says. */
  tip: string;
}

/** ADR-0082: the Click-through switch, on bar 1 while the mode is on (it was a "Click-through on" button). */
const CLICK_THROUGH_CONTROL: BarControl = {
  role: 'switch',
  name: 'Click-through',
  tip: 'Click-through: On (clicks outside the bars go to the app behind) · Ctrl+Alt+X',
};

/**
 * 1.6.3 (ADR-0075): bar 1's controls and the tooltip each one shows, for a bar drawn with
 * rec=on&private=off (and Click-through mode on when asked).
 *
 * @param clickThrough True when the Click-through switch is on the bar (the mode on).
 * @returns How to find each control, and its tooltip's words.
 */
function barControls(clickThrough: boolean): readonly BarControl[] {
  return [
    { role: 'button', name: 'Choose audio source', tip: 'Choose audio source' },
    { role: 'img', name: /^Screen audio:/, tip: 'Screen audio: capturing' },
    { role: 'button', name: 'Choose microphone', tip: 'Choose microphone' },
    { role: 'img', name: /^Microphone:/, tip: 'Microphone: capturing' },
    { role: 'switch', name: 'Transcript', tip: 'Transcript: Off · Ctrl+Alt+T' },
    { role: 'button', name: /^Recording, /, tip: 'Stop recording · Ctrl+Alt+R' },
    { role: 'switch', name: 'Auto answer', tip: 'Auto answer: Off' },
    ...(clickThrough ? [CLICK_THROUGH_CONTROL] : []),
    { role: 'img', name: 'Drag here to move', tip: 'Drag to move · Ctrl+Alt+Arrows' },
    { role: 'button', name: 'Shrink to an icon', tip: 'Shrink to an icon' },
    { role: 'button', name: 'Overlay menu', tip: 'Menu' },
    { role: 'button', name: 'Exit: end call', tip: 'Exit: end the call' },
  ];
}

/**
 * 1.6.3: hovers each of bar 1's controls and checks its tooltip: the words, solid dark with white
 * text, whole inside the window, on top of everything at its middle, and on the expected side.
 *
 * @param page         The overlay's page.
 * @param size         The window.
 * @param side         Where the tooltip should be: 'below' bar 1, 'above' it, or 'beside' its control.
 * @param clickThrough True when Click-through mode is on.
 * @param label        For the messages.
 */
async function checkBarTips(
  page: Page,
  size: Width,
  side: 'below' | 'above' | 'beside',
  clickThrough: boolean,
  label: string,
): Promise<void> {
  const bar = page.getByRole('toolbar', { name: 'Overlay controls' });
  const tip = page.getByRole('tooltip');
  for (const control of barControls(clickThrough)) {
    const name = `${label}: ${String(control.name)}`;
    const target = bar.getByRole(control.role, {
      name: control.name,
      ...(typeof control.name === 'string' ? { exact: true } : {}),
    });
    if ((await target.count()) === 0) {
      // Only a window narrower than the default lets a control give way (the Transcript pill first).
      expect(size.width, `${name} is on the bar`).toBeLessThan(DESKTOP_OVERLAY.default.width);
      continue;
    }
    await target.hover();
    await expect(tip, name).toHaveText(control.tip);
    await expect(tip, name).toHaveAttribute('data-bar-tip', side);
    const seen = await tip.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // Hit-tested with pointer events on for a moment: what is drawn on top at its middle.
      (element as HTMLElement).style.pointerEvents = 'auto';
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      (element as HTMLElement).style.pointerEvents = '';
      const barBox = document
        .querySelector('[role="toolbar"][aria-label="Overlay controls"]')!
        .getBoundingClientRect();
      return {
        onTop: top === element || element.contains(top),
        inside:
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= window.innerWidth &&
          box.bottom <= window.innerHeight,
        background: style.backgroundColor,
        colour: style.color,
        below: box.top >= barBox.bottom,
        above: box.bottom <= barBox.top,
      };
    });
    expect(seen, name).toMatchObject({
      onTop: true,
      inside: true,
      background: 'rgb(15, 15, 17)',
      colour: 'rgb(255, 255, 255)',
      ...(side === 'below' ? { below: true } : side === 'above' ? { above: true } : {}),
    });
    expect(size.width, name).toBeGreaterThan(0);
  }
  // Away from the bar it goes.
  await page.mouse.move(size.width / 2, side === 'above' ? 4 : size.height - 4);
  await expect(tip).toHaveCount(0);
}

test('1.6.3: every bar-1 control shows its tooltip on top and inside the window, in all six positions', async () => {
  // About 15 hovers per position, each waiting for its tooltip.
  test.setTimeout(240_000);
  for (const [sizeName, size] of Object.entries(DESKTOP_OVERLAY)) {
    const watched = await openDesktopOverlay(size, '&position=top-center');
    const { page } = watched;
    for (const position of [
      'top-left',
      'top-center',
      'top-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]) {
      // The narrowest window at two positions is enough: the rows differ, not the columns.
      if (sizeName === 'narrowest' && !position.endsWith('center')) continue;
      await page.goto(overlayUrl(`&position=${position}&rec=on&private=off&panels=answer`));
      await page.getByRole('toolbar', { name: 'Overlay controls' }).waitFor();
      await checkBarTips(
        page,
        size,
        position.startsWith('top') ? 'below' : 'above',
        false,
        `${sizeName} ${position}`,
      );
    }
    await watched.context.close();
  }
});

test('1.6.3: tooltips with Click-through on, in the light theme, over a dark page, and in the collapsed bar', async () => {
  // About 15 hovers per position, each waiting for its tooltip.
  test.setTimeout(240_000);
  const watched = await openDesktopOverlay(DESKTOP_OVERLAY.default, '&position=top-center');
  const { page } = watched;
  // Click-through mode on, top and bottom rows.
  for (const position of ['top-right', 'bottom-left']) {
    await page.goto(overlayUrl(`&position=${position}&rec=on&private=off&ct=on`));
    await page.getByRole('toolbar', { name: 'Overlay controls' }).waitFor();
    await checkBarTips(
      page,
      DESKTOP_OVERLAY.default,
      position.startsWith('top') ? 'below' : 'above',
      true,
      `click-through ${position}`,
    );
  }
  // The light theme, over a dark page: still solid dark with white text.
  await page.goto(overlayUrl('&position=top-center&rec=on&private=off&theme=light'));
  await page.evaluate((image) => {
    document.documentElement.style.backgroundImage = image;
  }, BACKDROPS.dark);
  await page.getByRole('toolbar', { name: 'Overlay controls' }).waitFor();
  await checkBarTips(page, DESKTOP_OVERLAY.default, 'below', false, 'light theme');
  // Collapsed to bar 1 (the shell makes the window 56 tall): beside each control, still whole.
  await page.goto(overlayUrl('&position=top-center&rec=on&private=off&panels=none'));
  await page.getByRole('button', { name: 'Hide the status bar' }).click();
  await page.setViewportSize({ width: DESKTOP_OVERLAY.default.width, height: 56 });
  await checkBarTips(
    page,
    { ...DESKTOP_OVERLAY.default, height: 56 },
    'beside',
    false,
    'collapsed',
  );
  await watched.context.close();
});

test('ADR-0082: the default window keeps the words on Transcript, Auto and Click-through in every state; bar 1 fits up to 130 % zoom', async () => {
  const watched = await openDesktopOverlay(DESKTOP_OVERLAY.default, '&position=top-center');
  const { page } = watched;
  const bar = page.getByRole('toolbar', { name: 'Overlay controls' });
  for (const extra of [
    '&rec=off',
    '&rec=on&private=off&auto=on',
    '&rec=on&private=off&auto=on&ct=on',
  ]) {
    await page.goto(overlayUrl(`&position=top-center${extra}`));
    await bar.waitFor();
    // The UI scale (Settings → Zoom, 80–130 %) is CSS zoom on the page (useAppearance.ts).
    for (const zoom of [1, 1.1, 1.2, 1.3]) {
      await page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
      }, zoom);
      const name = `${extra} at ${zoom * 100} %`;
      await expect
        .poll(() => barFit(page), { message: name })
        .toMatchObject({ barFits: true, leftFits: true, exitInside: true, menuInside: true });
      // At 100 % the words stay; zoomed in, they may give way to icons (measured), but the bar still fits.
      if (zoom !== 1) continue;
      await expect(bar.getByRole('switch', { name: 'Transcript' }), name).toHaveText(/Transcript/);
      await expect(bar.getByRole('switch', { name: 'Auto answer' }), name).toHaveText(/Auto/);
      if (extra.includes('ct=on')) {
        await expect(bar.getByRole('switch', { name: 'Click-through' }), name).toHaveText(
          /Click-through/,
        );
      }
    }
  }
  // Narrower than the default, they do become icons (the narrowest window, everything on).
  await page.setViewportSize(DESKTOP_OVERLAY.narrowest);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await expect(bar.getByRole('switch', { name: 'Click-through' })).toHaveText('');
  await expect(bar.getByRole('switch', { name: 'Click-through' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await watched.context.close();
});

test('1.6.3: the Opacity setting changes the panels’ background (40–100 %, as before)', async () => {
  const watched = await openDesktopOverlay(DESKTOP_OVERLAY.default, '&position=top-center');
  const { page } = watched;
  /**
   * The background of every see-through panel.
   *
   * @returns Their computed background colours, without repeats.
   */
  const backgrounds = () =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('.k-overlay.k-glass')].map(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      ),
    ]);
  expect(await backgrounds()).toEqual(['rgba(24, 24, 27, 0.82)']);
  await page.getByRole('button', { name: 'Overlay menu' }).click();
  const menu = page.getByRole('group', { name: 'Overlay settings' });
  const less = menu.getByRole('button', { name: 'Opacity: less' });
  const more = menu.getByRole('button', { name: 'Opacity: more' });
  // Down to the minimum: the panels are 40 % opaque.
  while (await less.isEnabled()) await less.click();
  await expect.poll(backgrounds).toEqual(['rgba(24, 24, 27, 0.4)']);
  // Up to the maximum: solid.
  while (await more.isEnabled()) await more.click();
  await expect.poll(backgrounds).toEqual(['rgb(24, 24, 27)']);
  await watched.context.close();
});

/** 1.6.3: a layout the view gave the shell, with the content height it asked for. */
interface LoggedContentLayout {
  /** The layout. */
  layout: {
    /** How tall the bars and panels are (v1.3.2), when a panel is open. */
    contentHeight?: number;
  };
}

test('1.6.3: on the bottom row the panels sit on the bars, mirrored from the top row with the same spacing', async () => {
  /**
   * The gap between the bars and the panels nearest them, and how much of the window the page asks for.
   *
   * @param page The overlay's page.
   * @param up   True on the bottom row.
   * @returns The gap (px) and the page's last reported content height.
   */
  const measure = (page: Page, up: boolean) =>
    page.evaluate((bottomRow) => {
      const bars = [...document.querySelectorAll('[data-bars]')].map((element) =>
        element.getBoundingClientRect(),
      );
      const panels = [...document.querySelectorAll('[data-panel]')].map((element) =>
        element.getBoundingClientRect(),
      );
      const log = (window as unknown as { overlayLog: unknown[] }).overlayLog;
      const layouts = log.filter(
        (entry) => typeof entry === 'object' && !!entry && 'layout' in entry,
      ) as LoggedContentLayout[];
      return {
        gap: bottomRow
          ? Math.min(...bars.map((box) => box.top)) - Math.max(...panels.map((box) => box.bottom))
          : Math.min(...panels.map((box) => box.top)) - Math.max(...bars.map((box) => box.bottom)),
        contentHeight: layouts.at(-1)?.layout.contentHeight ?? null,
      };
    }, up);
  const CASES = [
    { panels: 'answer', size: DESKTOP_OVERLAY.default },
    { panels: 'transcript', size: DESKTOP_OVERLAY.default },
    // Side by side (the shell widens the window to 1080 for both), and stacked in a narrow window.
    { panels: 'transcript,answer', size: { width: 1080, height: 540, touch: false } },
    { panels: 'transcript,answer', size: { width: 560, height: 440, touch: false } },
  ] as const;
  for (const { panels, size } of CASES) {
    const watched = await openDesktopOverlay(size, `&position=top-left&panels=${panels}`);
    const { page } = watched;
    for (const column of ['left', 'center', 'right']) {
      await page.goto(overlayUrl(`&panels=${panels}&position=top-${column}`));
      await page.getByRole('toolbar', { name: 'Overlay controls' }).waitFor();
      const above = await measure(page, false);
      await page.goto(overlayUrl(`&panels=${panels}&position=bottom-${column}`));
      await expect(page.locator('.k-overlay-root')).toHaveAttribute('data-row', 'bottom');
      const below = await measure(page, true);
      const name = `${panels} at ${size.width} px, ${column}`;
      // The same 6 px gap as on the top row (gap-1.5), not the window's empty space.
      expect(above.gap, `top: ${name}`).toBe(6);
      expect(below.gap, `bottom: ${name}`).toBe(6);
      // The page asks for no more of the window than the top row does, so the window shrinks to them.
      expect(below.contentHeight, name).toBe(above.contentHeight);
      if (panels === 'transcript,answer' && size.width < 900) {
        // Stacked and mirrored: the transcript nearest the bars, the answer above it.
        const transcript = (await page
          .getByRole('region', { name: 'Transcript panel' })
          .boundingBox())!;
        const answer = (await page.getByRole('region', { name: 'Latest answer' }).boundingBox())!;
        expect(answer.y + answer.height).toBeLessThanOrEqual(transcript.y);
      }
    }
    await watched.context.close();
  }
});

test('1.6.3: Auto answer is a toggle on bar 1; the recording warning shows once', async () => {
  const watched = await openDesktopOverlay(
    DESKTOP_OVERLAY.default,
    '&position=top-center&rec=on&private=off',
  );
  const { page } = watched;
  const bar = page.getByRole('toolbar', { name: 'Overlay controls' });
  // No floating "Auto answer Off" box anywhere: one toggle, on bar 1, muted while off.
  await expect(page.getByRole('button', { name: /^Auto answer / })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Auto answer' })).toHaveCount(1);
  const auto = bar.getByRole('switch', { name: 'Auto answer' });
  await expect(auto).toHaveText('Auto');
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  await auto.click();
  expect(await watched.log()).toContainEqual({ type: 'auto-answer', on: true });

  // The warning once: on the status bar (ADR-0082) with its fix; the Rec pill only "● Rec m:ss" and an
  // amber dot.
  await expect(
    page.getByText('Private is off: Paramount AI will appear in your recording'),
  ).toHaveCount(1);
  const warning = page
    .getByRole('group', { name: 'Status bar' })
    .locator('[data-status="private-off"]');
  await expect(warning.getByRole('alert')).toHaveText(
    'Private is off: Paramount AI will appear in your recording',
  );
  await expect(page.getByText('Visible in recording')).toHaveCount(0);
  const rec = bar.getByRole('button', { name: /^Recording, / });
  await expect(rec).toHaveText(/^Rec \d+:\d\d$/);
  await expect(rec.locator('[data-visible-in-recording]')).toBeVisible();
  // Screen readers still hear it.
  await expect(rec).toHaveAttribute('aria-label', /Visible in recording/);
  await warning.getByRole('button', { name: 'Turn on' }).click();
  await expect(warning).toHaveCount(0);
  await expect(rec.locator('[data-visible-in-recording]')).toHaveCount(0);

  await watched.context.close();
});

test('ADR-0082: bar 1 has a Click-through switch where clicks can pass, which turns the mode on and off', async () => {
  const watched = await openDesktopOverlay(DESKTOP_OVERLAY.default, '&position=top-center&ct=off');
  const { page } = watched;
  const bar = page.getByRole('toolbar', { name: 'Overlay controls' });
  const toggle = bar.getByRole('switch', { name: 'Click-through' });
  // Off: the switch is there, unchecked, and a click asks for the mode on.
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toHaveText('Click-through');
  await toggle.hover();
  await expect(page.getByRole('tooltip')).toHaveText(
    'Click-through: Off (turn on to click the app behind the overlay) · Ctrl+Alt+X',
  );
  await toggle.click();
  expect(await watched.log()).toContainEqual({ type: 'click-through', on: true });
  // On: checked, and a click turns it off (the bars always take clicks).
  await page.goto(overlayUrl('&position=top-center&ct=on'));
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  expect(await watched.log()).toContainEqual({ type: 'click-through', on: false });
  // Where clicks cannot pass (a browser, an older shell), there is no switch.
  await page.goto(overlayUrl('&position=top-center'));
  await bar.waitFor();
  await expect(bar.getByRole('switch', { name: 'Click-through' })).toHaveCount(0);
  await watched.context.close();
});
