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
 * - the overlay: three bars, the answer's parts, one scroll area, at its default and smallest sizes.
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
      // The brand fonts for screenshots only (the app self-hosts them with next/font; CI does
      // not need them, and makes no request to Google).
      const fonts = SHOT_DIR
        ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=block">' +
          "<style>:root{--font-inter:'Inter'}</style>"
        : '';
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
      // Under a bubble are its name and time (v1.1.0); the name carries the speaker's colour.
      getComputedStyle(
        items.find((li) => li.getAttribute('aria-label') === name)!.lastElementChild!
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
    you: 'rgb(96, 165, 250)',
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
    await expect(page.getByRole('region', { name: 'Live transcript bar' })).toBeVisible();
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

    // The current live question sits in the strip (v1.1.0: above the words, not the answer).
    await expect(page.getByLabel('Current question from the other person')).toContainText(
      'What would the Professional plan cost',
    );
    // Collapse leaves only the controls.
    await page.getByRole('button', { name: 'Collapse the overlay' }).click();
    await expect(page.getByRole('region', { name: 'Latest answer' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open the overlay' }).click();
    await expect(page.getByRole('region', { name: 'Latest answer' })).toBeVisible();
    // The strip's Clear hides the words on screen; the answer stays (v1.1.0).
    await page
      .getByRole('region', { name: 'Live transcript bar' })
      .getByRole('button', { name: 'Clear' })
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
    // The chat box's switch sits next to it, on the choice the live page holds.
    await page.getByRole('button', { name: 'Chat', exact: false }).first().click();
    // Below 620 px the switch is hidden to leave room to type; the last choice still applies.
    if (size.width >= 620) {
      await expect(
        page.getByRole('radiogroup', { name: 'Who the answer is for' }).getByRole('radio', {
          name: 'Ask AI',
        }),
      ).toHaveAttribute('aria-checked', 'true');
    }
    await shot(coding, size, `overlay-chat-${size.width}`);
    await coding.context.close();

    const privately = await open('compact-private', size);
    await expect(privately.page.getByLabel('Private answer')).toContainText('397.8');
    await expect(privately.page.getByLabel('About this answer')).toContainText('Just for you');
    await shot(privately, size, `overlay-private-${size.width}`);
    await privately.context.close();
  }
});

test('auto-answer: answers a finished question by itself, at most once per 15 s', async () => {
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

  await page.waitForTimeout(2_000);
  expect(answers, 'no auto-answer for the opening lines').toBe(0);
  await addThem('WHAT DOES THE ANNUAL PLAN COST FOR FORTY SEATS');
  const panel = page.getByRole('region', { name: 'Answer' });
  await expect(panel.getByText('Auto', { exact: true })).toBeVisible({ timeout: 5_000 });
  expect(answers).toBe(1);
  const firstAt = Date.now();

  // A second question within 15 s is not answered by itself.
  await addThem('HOW LONG DOES THE ROLLOUT TAKE');
  await page.waitForTimeout(4_000);
  expect(answers, 'rate limit: one auto-answer per 15 s').toBe(1);

  // After 15 s, the still-unanswered question is answered.
  await page.waitForTimeout(Math.max(0, 15_500 - (Date.now() - firstAt)));
  await expect.poll(() => answers, { timeout: 3_000 }).toBe(2);
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
    await expect(page.getByLabel('Password')).toBeVisible();
    await shot(watched, size, 'error-sign-in-again');
    dropExpectedFailures(watched);
    await watched.context.close();
  }
});

test('error states: Them silent for 20 s', async () => {
  for (const size of ERROR_SIZES) {
    const watched = await open('live-errors', size);
    await expect(
      watched.page.getByRole('alert').filter({ hasText: 'Nothing heard from Them' }),
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

test('S13: bar 1 in order, 44 tall, radius 12, every key-cap from the map, nothing cut off', async () => {
  const watched = await openOverlayView(BARS_SIZE, '&panels=none&shell=1');
  const { page } = watched;
  const bar = page.getByRole('toolbar', { name: 'Overlay controls' });
  expect((await bar.boundingBox())!.height).toBeCloseTo(44, 0);
  const words = await bar.evaluate((element) =>
    [...element.querySelectorAll('button,[role="img"],[role="timer"]')].map(
      (item) => item.getAttribute('aria-label') ?? item.textContent?.trim(),
    ),
  );
  expect(
    words.filter((word) => !word?.includes('capturing') && !word?.includes('not connected')),
  ).toEqual([
    'Choose audio source',
    'Choose microphone',
    expect.stringMatching(/^Answer/),
    expect.stringMatching(/^Screenshot/),
    expect.stringMatching(/^Chat/),
    // ADR-0055: the Transcript pill with its switch.
    'Transcript',
    'Drag here to move',
    'Shrink to an icon',
    'Call time',
    'Overlay menu',
    'Exit: end call',
  ]);
  await expect(bar.getByRole('button', { name: 'Answer' }).locator('kbd')).toContainText('Ctrl');
  // [Ctrl ⇧ ↵] and [Ctrl ⇧ ␣]: their shift, enter and space are icons with the symbol for readers.
  await expect(bar.getByRole('button', { name: 'Screenshot' }).locator('kbd')).toContainText('⇧');
  await expect(bar.getByRole('button', { name: 'Screenshot' }).locator('kbd')).toContainText('↵');
  await expect(bar.getByRole('button', { name: 'Chat' }).locator('kbd')).toContainText('␣');
  await shot(watched, BARS_SIZE, 'call-bars');
  // At the width a 1.1.0 window keeps, at its smallest, and in a narrow picture-in-picture window,
  // everything still fits, Exit's question too.
  const exit = bar.getByRole('button', { name: 'Exit: end call' });
  for (const width of [900, 780, 680, 560, 460]) {
    await page.setViewportSize({ width, height: 400 });
    /**
     * Whether nothing on the bar is cut off.
     *
     * @returns True when it fits.
     */
    const fits = () => bar.evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(await fits(), `bar 1 fits ${width}`).toBe(true);
    await exit.click();
    await expect(bar.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(await fits(), `the question fits ${width}`).toBe(true);
    await bar.getByRole('button', { name: 'Cancel' }).click();
  }
  // Exit is red, and asks first.
  await page.setViewportSize({ width: 780, height: 400 });
  await expect(exit).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await exit.click();
  await bar.getByRole('button', { name: 'End call?' }).click();
  expect(await watched.log()).toContainEqual({ type: 'end' });
  await watched.context.close();
});

test('S13: bar 2 is narrower and left-aligned, the level button opens the transcript, Auto answer sits apart', async () => {
  const watched = await openOverlayView(BARS_SIZE, '&panels=none');
  const { page } = watched;
  const bar1 = (await page.getByRole('toolbar', { name: 'Overlay controls' }).boundingBox())!;
  const region = page.getByRole('region', { name: 'Live transcript bar' });
  const bar2 = (await region.boundingBox())!;
  expect(Math.abs(bar2.x - bar1.x)).toBeLessThanOrEqual(2);
  expect(bar2.width).toBeLessThan(bar1.width - 100);
  await expect(region.getByRole('button', { name: /^Answer language: / })).toBeVisible();
  await expect(region.getByRole('button', { name: 'Clear' }).locator('kbd')).toContainText('⌫');
  // The pill is to its right, and toggles.
  const pill = page.getByRole('button', { name: /^Auto answer / });
  expect((await pill.boundingBox())!.x).toBeGreaterThan(bar2.x + bar2.width);
  await pill.click();
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
  await page.getByRole('button', { name: 'Open the transcript', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Transcript panel' })).toBeVisible();
  await expect(region).toHaveCount(0);
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
  await expect(page.getByRole('region', { name: 'Live transcript bar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open the overlay' }).click();
  await expect(page.getByRole('region', { name: 'Live transcript bar' })).toBeVisible();
  // Bar 2's collapse does the same, and bar 1 opens it again.
  await page.getByRole('button', { name: 'Hide the transcript bar' }).click();
  await expect(page.getByRole('region', { name: 'Live transcript bar' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open the overlay' }).click();
  await expect(page.getByRole('region', { name: 'Live transcript bar' })).toBeVisible();
  await watched.context.close();
});

test('S14: the chat bar opens under bar 1 at its width; Send waits for words; a screenshot can go alone', async () => {
  const watched = await openOverlayView(BARS_SIZE, '&panels=none');
  const { page } = watched;
  await page.getByRole('button', { name: 'Chat' }).first().click();
  const chat = page.getByRole('group', { name: 'Chat' });
  const bar1 = (await page.getByRole('toolbar', { name: 'Overlay controls' }).boundingBox())!;
  const box = (await chat.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(bar1.y + bar1.height);
  expect(Math.abs(box.width - bar1.width)).toBeLessThanOrEqual(2);
  const input = chat.getByLabel('Type a question');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('placeholder', 'Type a message…');
  // [Ctrl Alt ↵] and [↵], from the map; Send is muted until there are words.
  await expect(
    chat.getByRole('button', { name: 'Send with a screenshot' }).locator('kbd'),
  ).toContainText('Alt');
  const send = chat.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await shot(watched, BARS_SIZE, 'call-chat');
  await input.fill('What did they ask?');
  await expect(send).toBeEnabled();
  await send.click();
  expect(await watched.log()).toContainEqual({ type: 'chat', question: 'What did they ask?' });
  await expect(chat).toHaveCount(0);
  // With no words, the screenshot button simply takes a screenshot.
  await page.getByRole('button', { name: 'Chat' }).first().click();
  await chat.getByRole('button', { name: 'Send with a screenshot' }).click();
  expect(await watched.log()).toContainEqual({ type: 'screenshot' });
  // With words, they go with it.
  await page.getByRole('button', { name: 'Chat' }).first().click();
  await chat.getByLabel('Type a question').fill('And this diagram?');
  await chat.getByRole('button', { name: 'Send with a screenshot' }).click();
  expect(await watched.log()).toContainEqual({
    type: 'chat-screenshot',
    question: 'And this diagram?',
  });
  // The ✕ closes it, and who the answer is for stays available.
  await page.getByRole('button', { name: 'Chat' }).first().click();
  await expect(chat.getByRole('radiogroup', { name: 'Who the answer is for' })).toBeVisible();
  await chat.getByRole('button', { name: 'Close chat' }).click();
  await expect(chat).toHaveCount(0);
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
  // ADR-0055: 900 wide since bar 1 holds the Transcript pill.
  expect(bar1.width).toBeLessThanOrEqual(902);
  expect(Math.abs(bar1.x + bar1.width / 2 - 540)).toBeLessThanOrEqual(2);

  // You on the right, Them on the left, plain words with who and when under them.
  const you = page.getByRole('listitem', { name: 'You said' }).first();
  const them = page.getByRole('listitem', { name: 'Them said' }).first();
  await expect(you).toBeVisible();
  await expect(them).toBeVisible();
  const youBox = (await you.boundingBox())!;
  const themBox = (await them.boundingBox())!;
  expect(youBox.x + youBox.width).toBeGreaterThan(themBox.x + themBox.width);
  await expect(you).toContainText(/You\s*·\s*\d/);
  await expect(you.locator('span').first()).toHaveCSS('font-size', '15px');

  // The header: nav chips, Auto answer, Clear and collapse, in one line.
  await expect(
    answer.getByRole('button', { name: 'Previous question' }).locator('kbd'),
  ).toContainText('←');
  await expect(answer.getByRole('button', { name: 'Next question' }).locator('kbd')).toContainText(
    '→',
  );
  await expect(answer.getByRole('button', { name: /^Auto answer / })).toBeVisible();
  await expect(answer.getByRole('button', { name: 'Clear' }).locator('kbd')).toContainText('⌫');
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
