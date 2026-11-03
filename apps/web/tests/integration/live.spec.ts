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
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
          `<title>Kite live harness</title><link rel="stylesheet" href="/harness/live.css">${fonts}</head>` +
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

test.describe.configure({ mode: 'serial' });

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
  const transcriptBox = await box(page, '[aria-label="Live transcript"]');
  const panel = '[aria-label="Answer"]';
  expect(transcriptBox.x).toBeLessThan((await box(page, panel)).x);

  // Speaker colours and the provisional line (theme §6).
  const colours = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[aria-label="Live transcript"] li')];
    const label = (name: string) =>
      getComputedStyle(items.find((li) => li.textContent?.startsWith(name))!.firstElementChild!)
        .color;
    const provisional = document.querySelector('[aria-label="Live transcript"] li span.italic');
    if (!provisional) return { lines: items.map((li) => li.textContent) };
    return {
      you: label('You'),
      them: label('Them'),
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
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Answer headline' })).toHaveText(HEADLINE);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const toolbar = '[aria-label="Call actions"]';
  const before = {
    toolbar: await box(page, toolbar),
    panel: await box(page, panel),
    footer: await box(page, 'button:has-text("Cancel")'),
  };
  await expect(
    page.getByRole('list', { name: 'Answer details' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const after = {
    toolbar: await box(page, toolbar),
    panel: await box(page, panel),
    footer: await box(page, 'button:has-text("Cancel")'),
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
    const panel = await box(page, '[aria-label="Answer"]');
    const transcript = await box(page, '[aria-label="Live transcript"]');
    expect(panel.y).toBeLessThan(transcript.y);
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

test('the Connect view is on the dark tokens', async () => {
  for (const size of [
    { width: 1440, height: 900, touch: false },
    { width: 900, height: 900, touch: false },
  ] as const) {
    const watched = await open('connect', size);
    const { page } = watched;
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(page.getByText('This is a Regular session about')).toBeVisible();
    await shot(watched, size, 'connect');
    // Each way of calling opens a short how-to for this platform.
    await expect(
      page.getByRole('list', { name: 'Ways of calling' }).getByRole('button'),
    ).toHaveText([/Zoom/, /Teams/, /Google Meet/, /Webex/, /Phone/]);
    await page.getByRole('button', { name: 'Google Meet' }).click();
    const howTo = page.getByRole('dialog', { name: 'Connect Google Meet' });
    await expect(howTo).toContainText('Also share tab audio');
    await howTo.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: 'Phone' }).click();
    await expect(page.getByRole('dialog', { name: 'Connect Phone' })).toContainText('desktop app');
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Video tutorial: coming soon')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'No call to share? Open a mock interview video' }),
    ).toHaveAttribute('rel', 'noreferrer');
    await expect(page.getByRole('link', { name: 'Back' })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Answer line' })).toHaveText(
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

    // The transcript and the answer can each take the space.
    await page.getByRole('button', { name: 'Expand the transcript' }).click();
    await expect(page.getByRole('region', { name: 'Transcript', exact: true })).toContainText(
      'forty seats',
    );
    await page.getByRole('button', { name: 'Show the answer' }).click();
    await page.getByRole('button', { name: 'Expand the answer' }).click();
    await expect(page.getByRole('region', { name: 'Live transcript bar' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show the transcript bar' }).click();
    // Collapse leaves only the controls.
    await page.getByRole('button', { name: 'Collapse the overlay' }).click();
    await expect(page.getByRole('region', { name: 'Latest answer' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open the overlay' }).click();
    await expect(page.getByRole('region', { name: 'Latest answer' })).toBeVisible();
    // Clear hides the words on screen.
    await page
      .getByRole('region', { name: 'Live transcript bar' })
      .getByRole('button', { name: 'Clear' })
      .click();
    await expect(page.getByLabel('Latest words')).not.toContainText('the Professional plan');
    // The menu: a browser window has no opacity control and says so.
    await page.getByRole('button', { name: 'Overlay menu' }).click();
    await expect(page.getByLabel('Hide this window from screen share')).toBeVisible();
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
    await expect(page.getByRole('list', { name: 'Other answers' })).toContainText('pilot cost');
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
    await expect(page.getByLabel('Who the answer is for')).toHaveValue('kite');
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

test('overlay look: panel background at 40% and 70% over light and dark busy backgrounds (ADR-0033)', async () => {
  // The opacity slider dims the panel background only; the text stays opaque with a shadow. Render
  // the minimum (0.4) and the default (0.7) over each backdrop and size.
  for (const alpha of [0.4, 0.7]) {
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
        const panel = page.locator('.k-overlay.k-glass');
        await expect(panel).toBeVisible();
        // Every control of the top bar stays inside the window, End above all.
        const end = await page.getByRole('button', { name: 'End', exact: true }).boundingBox();
        expect(end!.x + end!.width).toBeLessThanOrEqual(size.width);
        const look = await panel.evaluate((element) => {
          const style = getComputedStyle(element);
          const end = [...element.querySelectorAll('button')].find((b) => b.textContent === 'End')!;
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
          radius: '16px',
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
  const panel = watched.page.locator('.k-overlay');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('background-color', 'rgb(24, 24, 27)');
  await expect(watched.page.locator('.k-glass')).toHaveCount(0);
  await watched.context.close();
});
