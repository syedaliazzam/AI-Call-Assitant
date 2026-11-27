/**
 * Harness test for session setup (parity Phase 2, ADR-0029), no sign-in, runs in CI. With the real
 * Dashboard, SessionWizard and LibraryPage on the browser's real IndexedDB, and /api/job-import and
 * /api/preview mocked (no Claude call), it covers: the sessions page's tabs, count, Active and Past
 * sections, search, sort, grid or list and empty state, the session card's shape, chips and menu (rename,
 * duplicate, delete), and the split button's types; the wizard's modal, stepper, validation and
 * discard question; the job link filling in details, saying what was imported, and failing kindly;
 * the Resume and Documents pickers with upload; a session keeping its copy when a library item is
 * deleted; key terms as chips; the Answer preferences window with its drill-in views, static preview
 * (no API call), STAR and Set as default; AI instructions; language, model and the admin's switch;
 * each session type's button; the company field's suggestions and the logos on cards, with Brandfetch
 * mocked (ADR-0048), covering the pause, the order, the keyboard, what is sent, what is kept, failures
 * and the off switch.
 * Set KITE_SCREENSHOT_DIR to also save screenshots at 1440 and 390 px.
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
  type Request,
} from '@playwright/test';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { pickOption } from '../lib/pick-option';
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
/** Requests the page made to the server's API. */
let apiRequests: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-setup-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'setup.tsx')],
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
    define: {
      'process.env.NODE_ENV': '"production"',
      // Made up: Brandfetch is always mocked here.
      'process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID': '"invented-client-id"',
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
  writeFileSync(path.join(bundleDir, 'setup.css'), css.css);
  server = createServer((req, res) => {
    if (req.url === '/harness/setup.js' || req.url === '/harness/setup.css') {
      const isCss = req.url.endsWith('.css');
      res.writeHead(200, { 'Content-Type': isCss ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, isCss ? 'setup.css' : 'setup.js')));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html data-theme="' +
        (process.env.KITE_VISUAL_THEME ?? 'light') +
        '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paramount AI setup harness</title>' +
        '<link rel="stylesheet" href="/harness/setup.css">' +
        brandFonts() +
        '</head>' +
        '<body class="font-sans"><div id="root"></div>' +
        '<script type="module" src="/harness/setup.js"></script></body></html>',
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

test.beforeEach(async () => {
  // A fresh context per test: an empty database and no saved preferences.
  context = await browser!.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  // These tests never reach Brandfetch: anything a test does not answer itself is refused and counted.
  brandfetchRequests = [];
  await context.route(/brandfetch\.io/, (route) => {
    brandfetchRequests.push(route.request().url());
    return route.abort();
  });
  page = await context.newPage();
  apiRequests = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/')) apiRequests.push(pathname);
  });
  await page.goto(origin);
  await page.waitForFunction(() => 'kiteSetupHarness' in window);
});

test.afterEach(async () => {
  await context.close();
});

/** Every request to Brandfetch that no test answered, in this test. */
let brandfetchRequests: string[] = [];

/** One red pixel, as a logo: a colour, so that it shows in a screenshot. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The brands a mocked search finds, with the extra fields the real API may send. */
const BRANDS = [
  {
    name: 'Alderway Foods',
    domain: 'alderway.example',
    icon: 'https://cdn.brandfetch.io/icon-alderway-expires?c=x',
    brandId: 'b1',
    claimed: true,
    verified: true,
  },
  {
    name: 'Alder Works',
    domain: 'alderworks.example',
    icon: 'https://cdn.brandfetch.io/icon-works?c=x',
  },
];

/**
 * Answers Brandfetch: searches with the brands above, and every image with a pixel.
 *
 * @returns The searches and the images asked for.
 */
async function mockBrandfetch(): Promise<{
  /** The search requests. */
  searches: Request[];
  /** The image requests. */
  images: Request[];
}> {
  const searches: Request[] = [];
  const images: Request[] = [];
  await page.route('https://api.brandfetch.io/**', (route) => {
    searches.push(route.request());
    return route.fulfill({ json: BRANDS, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://cdn.brandfetch.io/**', (route) => {
    images.push(route.request());
    return route.fulfill({ body: PIXEL, contentType: 'image/png' });
  });
  return { searches, images };
}

/**
 * Finishes a Regular session in the wizard with the company already chosen.
 */
async function createRegular(): Promise<void> {
  await page.getByLabel('Topic').fill('Pilot review');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create regular session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();
}

/**
 * Goes to an address in the harness.
 *
 * @param href The address.
 */
async function go(href: string): Promise<void> {
  await page.evaluate((target) => window.kiteSetupHarness.go(target), href);
}

/**
 * Saves a screenshot at phone and desktop width when KITE_SCREENSHOT_DIR is set.
 *
 * @param name File name without extension.
 */
async function shots(name: string): Promise<void> {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name} at ${width}: sideways scroll`).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: path.join(SHOT_DIR, `${name}-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/**
 * Seeds the dashboard's three sessions, and shows it.
 */
async function seedDashboard(): Promise<void> {
  await page.evaluate(async () => {
    const h = window.kiteSetupHarness;
    await h.seedSession('interview', 'Lantern Freight (invented)', 'Data Analyst', 2_000);
    await h.seedSession('regular', 'Alder Foods (invented)', 'Renewal review', 3_000);
    await h.seedSession('mock', 'Zephyr Labs (invented)', 'Data Analyst', 1_000, 'ended');
  });
  await go('/');
  await expect(page.getByRole('heading', { name: 'Renewal review' })).toBeVisible();
}

/**
 * The cards' titles, top to bottom.
 *
 * @returns The titles.
 */
function titles() {
  return page.getByRole('heading', { level: 2 }).allTextContents();
}

/**
 * Chooses a sort order.
 *
 * @param name The order's words.
 */
async function sortBy(name: string): Promise<void> {
  await page.getByRole('button', { name: 'Sort' }).click();
  await page.getByRole('menuitemradio', { name }).click();
}

test('sessions page: tabs, the count, sections, search, sort, and grid or list', async () => {
  await seedDashboard();
  const tabs = page.getByRole('group', { name: 'Session type' });
  await expect(tabs.getByRole('button')).toHaveText(['All', 'Interview', 'Regular', 'Mock']);
  await expect(page.getByText('3 Sessions')).toBeVisible();
  await shots('dashboard-grid');

  // Active sessions first, each section newest first, with its count.
  const activeSection = page.getByRole('region', { name: 'Active sessions' });
  const pastSection = page.getByRole('region', { name: 'Past sessions' });
  await expect(activeSection.getByRole('button', { name: 'Active sessions' })).toContainText('2');
  await expect(pastSection.getByRole('button', { name: 'Past sessions' })).toContainText('1');
  expect(await titles()).toEqual([
    'Renewal review',
    'Lantern Freight (invented)',
    'Zephyr Labs (invented)',
  ]);
  await sortBy('Oldest first');
  expect((await titles())[0]).toBe('Lantern Freight (invented)');
  await sortBy('A–Z');
  expect(await titles()).toEqual([
    'Renewal review',
    'Lantern Freight (invented)',
    'Zephyr Labs (invented)',
  ]);

  // A section collapses.
  await pastSection.getByRole('button', { name: 'Past sessions' }).click();
  await expect(page.getByRole('heading', { name: 'Zephyr Labs (invented)' })).toHaveCount(0);
  await pastSection.getByRole('button', { name: 'Past sessions' }).click();

  await page.getByLabel('Search sessions').fill('analyst');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(2);
  await page.getByLabel('Search sessions').fill('zzz');
  await expect(page.getByText('No sessions match')).toBeVisible();
  await page.getByLabel('Search sessions').fill('');

  await tabs.getByRole('button', { name: 'Mock' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(1);
  await expect(page.getByText('1 Session', { exact: true })).toBeVisible();
  await tabs.getByRole('button', { name: 'All' }).click();

  // The grid by default; the choice of list is remembered.
  await expect(page.getByRole('radio', { name: 'Grid' })).toBeChecked();
  await page.getByRole('radio', { name: 'List' }).click();
  await expect(page.getByRole('radio', { name: 'List' })).toBeChecked();
  await shots('dashboard-list');
  await page.reload();
  await page.waitForFunction(() => 'kiteSetupHarness' in window);
  await go('/');
  await expect(page.getByRole('radio', { name: 'List' })).toBeChecked();
});

test('the empty state offers the split button', async () => {
  await go('/');
  await expect(page.getByText('No sessions yet. Create one to get started.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create session' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose a session type' })).toBeVisible();
  await shots('dashboard-empty');
});

test('session card: chips, status, Start or Review, and its menu', async () => {
  await seedDashboard();
  const card = (name: string) =>
    page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });
  const ready = card('Lantern Freight (invented)');
  await expect(ready).toContainText('Interview');
  await expect(ready).toContainText('Transcript');
  await expect(ready).toContainText('Ready to start');
  await expect(ready).toContainText('Not started yet');
  await expect(ready).toContainText('Data Analyst');
  await expect(ready.getByRole('button', { name: 'Start session' })).toBeVisible();
  // The card's shape (spec §1).
  // v1.3.0 (ADR-0057): outer radius 48, padding 8/8/12; the inner panel radius 32, padding 12.
  await expect(ready).toHaveCSS('border-top-left-radius', '48px');
  await expect(ready).toHaveCSS('padding-top', '8px');
  await expect(ready).toHaveCSS('padding-bottom', '12px');
  await expect(ready.locator('> div').first()).toHaveCSS('border-top-left-radius', '32px');
  await expect(ready.locator('> div').first()).toHaveCSS('padding-top', '12px');
  await expect(ready.getByRole('heading', { level: 2 })).toHaveCSS('font-size', '18px');
  const ended = card('Zephyr Labs (invented)');
  await expect(ended).toContainText('Ended');
  await expect(ended).toContainText('6m 53s');
  await expect(ended).not.toContainText('Transcript');
  await expect(ended.getByRole('link', { name: 'View transcript' })).toHaveAttribute(
    'href',
    /^\/sessions\/[\w-]+$/,
  );
  // A regular call's title is its topic.
  const regular = card('Renewal review');
  await expect(regular).toContainText('Alder Foods (invented)');

  // The menu's rows; there is nothing to download yet.
  await ready.getByRole('button', { name: /^More for / }).click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Edit',
    'Rename',
    'Duplicate',
    'Download transcript',
    'Delete',
  ]);
  await expect(page.getByRole('menuitem', { name: 'Download transcript' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await ended.getByRole('button', { name: /^More for / }).click();
  await expect(page.getByRole('menuitem').first()).toHaveText('Start again');
  await page.keyboard.press('Escape');

  // Rename.
  await ready.getByRole('button', { name: /^More for / }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await ready.getByRole('button', { name: /^More for / }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename this session' });
  await rename.getByLabel('Company').fill('Lantern Group (invented)');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Lantern Group (invented)' })).toBeVisible();

  // Duplicate (ADR-0129): "Copy of <name>", a new session that has not started.
  await card('Zephyr Labs (invented)')
    .getByRole('button', { name: /^More for / })
    .click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(
    page.getByRole('heading', { name: 'Copy of Zephyr Labs (invented)', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Zephyr Labs (invented)', exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText('4 Sessions')).toBeVisible();
  await expect(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Copy of Zephyr Labs (invented)' }) })
      .filter({ hasText: 'Ready to start' }),
  ).toHaveCount(1);

  // Delete asks first.
  await card('Renewal review')
    .getByRole('button', { name: /^More for / })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this session?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('heading', { name: 'Renewal review' })).toHaveCount(0);
});

test('the wizard starts with the type chosen in the split button', async () => {
  await go('/');
  await page.getByRole('button', { name: 'Choose a session type' }).click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Interview call',
    'Regular call',
    'Mock interview',
  ]);
  await page.getByRole('menuitem', { name: 'Mock interview' }).click();
  await expect(page.getByRole('radio', { name: 'Mock' })).toBeChecked();
});

/**
 * Fills in step 1's required fields.
 */
async function fillDetails(): Promise<void> {
  await page.getByLabel('Company').fill('Lantern Freight (invented)');
  await page.getByLabel('Role').fill('Data Analyst');
}

test('the wizard: modal, stepper, validation, type switch and the discard question', async () => {
  await go('/sessions/new');
  const dialog = page.getByRole('dialog', { name: 'Create session' });
  await expect(dialog).toBeVisible();
  // v1.3.1: measured once the modal has finished scaling in from 98 % (ADR-0058).
  await settleAnimations(page);
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeCloseTo(760, 0);
  expect(box.height).toBeCloseTo(600, 0);
  await expect(dialog.getByRole('list', { name: 'Steps' })).toContainText('Details');
  await expect(dialog.getByRole('button', { name: 'View tutorial' })).toBeDisabled();

  // Next checks the required fields.
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Enter the company the call is with.')).toBeVisible();
  await shots('wizard-errors');

  // Switching type keeps what the types share.
  await page.getByLabel('Company').fill('Lantern Freight (invented)');
  await dialog.getByRole('radio', { name: 'Regular' }).click();
  await expect(page.getByLabel('Topic')).toBeVisible();
  await expect(page.getByLabel('Company')).toHaveValue('Lantern Freight (invented)');
  await dialog.getByRole('radio', { name: 'Interview' }).click();

  // ✕ asks first once something was typed; Keep editing keeps it.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard this session?' });
  await discard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Company')).toHaveValue('Lantern Freight (invented)');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await discard.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();
  await expect(page.getByRole('dialog', { name: 'Create session' })).toHaveCount(0);

  // With nothing typed it just closes.
  await go('/sessions/new');
  await page
    .getByRole('dialog', { name: 'Create session' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Discard this session?' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();
});

test('Mock presets fill in a practice role', async () => {
  await go('/sessions/new');
  await page.getByRole('button', { name: 'Mock presets' }).click();
  await page.getByRole('button', { name: 'Product manager' }).click();
  await expect(page.getByRole('radio', { name: 'Mock' })).toBeChecked();
  await expect(page.getByLabel('Role')).toHaveValue('Product manager');
  await expect(page.getByLabel('Job description')).not.toHaveValue('');
});

test('job link: fills in the details, says what came in, and they can be edited', async () => {
  await page.route('**/api/job-import', (route) =>
    route.fulfill({
      json: {
        fields: {
          company: 'Lantern Freight (invented)',
          role: 'Data Analyst',
          description: 'Build reports with SQL.',
        },
        host: 'jobs.example.com',
      },
    }),
  );
  await go('/sessions/new');
  await page.getByLabel('Company').fill('Typed first');
  await expect(
    page.getByText('Got a job post link? We’ll fill in the details for you.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Paste a job link' }).click();
  await page.getByLabel('Job post link').fill('https://jobs.example.com/42');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Imported the company, role and job description from jobs.example.com',
  );
  await expect(page.getByLabel('Company')).toHaveValue('Lantern Freight (invented)');
  await expect(page.getByLabel('Role')).toHaveValue('Data Analyst');
  await expect(page.getByLabel('Job description')).toHaveValue('Build reports with SQL.');
  await shots('wizard-details');
  await page.getByLabel('Role').fill('Senior Data Analyst');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create interview session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  expect(session).toMatchObject({
    company: 'Lantern Freight (invented)',
    role: 'Senior Data Analyst',
    description: 'Build reports with SQL.',
  });
});

test('job link: a page it cannot read leaves what was typed, and says so', async () => {
  await page.route('**/api/job-import', (route) =>
    route.fulfill({
      status: 422,
      json: {
        code: 'bad_request',
        message: 'Couldn’t read that page. Paste the description instead.',
      },
    }),
  );
  await go('/sessions/new');
  await page.getByLabel('Company').fill('Typed first');
  await page.getByRole('button', { name: 'Paste a job link' }).click();
  await page.getByLabel('Job post link').fill('https://10.0.0.1/');
  await page.getByLabel('Job post link').press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'Couldn’t read that page. Paste the description instead.',
  );
  await expect(page.getByLabel('Company')).toHaveValue('Typed first');
});

test('job link: a page with no job in it adds nothing', async () => {
  await page.route('**/api/job-import', (route) =>
    route.fulfill({
      json: { fields: { company: '', role: '', description: '' }, host: 'blog.example.com' },
    }),
  );
  await go('/sessions/new');
  await page.getByRole('button', { name: 'Paste a job link' }).click();
  await page.getByLabel('Job post link').fill('https://blog.example.com/');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Couldn’t read that page. Paste the description instead.',
  );
});

test('regular sessions have a topic and no job link or resume', async () => {
  await go('/sessions/new?type=regular');
  await expect(page.getByLabel('Topic')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paste a job link' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'CV / Resume' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Documents' })).toBeVisible();
});

test('pickers: choose from the library, upload, one resume, and the session keeps a copy', async () => {
  await page.evaluate(async () => {
    const h = window.kiteSetupHarness;
    await h.seedLibrary('resume', 'old-resume.txt', 'Old experience (invented).');
    await h.seedLibrary('document', 'prices.txt', 'Prices (invented).');
    await h.seedLibrary('document', 'notes.txt', 'Notes (invented).');
  });
  await go('/sessions/new');
  await fillDetails();

  await page.getByRole('combobox', { name: 'CV / Resume' }).click();
  await shots('wizard-cv-menu');
  await page.keyboard.press('Escape');

  // Several documents; one taken away again.
  const documents = page.getByRole('combobox', { name: 'Documents' });
  await documents.click();
  await page.getByRole('option', { name: 'prices.txt' }).click();
  await page.getByRole('option', { name: 'notes.txt' }).click();
  await expect(documents).toHaveText('2 selected');
  await page.getByRole('option', { name: 'notes.txt' }).click();
  await expect(documents).toHaveText('prices.txt');
  await shots('wizard-documents-menu');
  await page.keyboard.press('Escape');

  // One resume: choosing, then uploading another, leaves only the new one.
  const resume = page.getByRole('combobox', { name: 'CV / Resume' });
  await expect(resume).toHaveText('None');
  await pickOption(page, resume, 'old-resume.txt');
  await expect(resume).toHaveText('old-resume.txt');
  await page.getByLabel('Upload a resume').setInputFiles({
    name: 'new-resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('New experience (invented).'),
  });
  await expect(resume).toHaveText('new-resume.txt');
  await shots('wizard-pickers');
  await resume.click();
  await expect(page.getByRole('option')).toHaveText(['None', 'new-resume.txt', 'old-resume.txt']);
  await page.keyboard.press('Escape');

  // None takes it away; choosing again brings it back.
  await pickOption(page, resume, 'None');
  await expect(resume).toHaveText('None');
  await pickOption(page, resume, 'new-resume.txt');

  // A file that cannot be read says so, and the wizard carries on.
  await page.getByLabel('Add a document').setInputFiles({
    name: 'picture.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not text'),
  });
  await expect(page.getByRole('alert')).toContainText('picture.png');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create interview session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();

  const stored = await page.evaluate(() => window.kiteSetupHarness.newestDocuments());
  expect(stored).toEqual(
    expect.arrayContaining([
      { name: 'prices.txt', text: 'Prices (invented).', kind: 'document' },
      { name: 'new-resume.txt', text: 'New experience (invented).', kind: 'resume' },
    ]),
  );
  expect(stored).toHaveLength(2);
  // An upload in the wizard joins the library.
  expect(await page.evaluate(() => window.kiteSetupHarness.library('resume'))).toContain(
    'new-resume.txt',
  );

  // Deleting from the library leaves the session's copy, and Edit still shows it.
  await go('/resumes');
  await page.getByRole('button', { name: 'Delete new-resume.txt' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this resume?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('button', { name: 'Delete new-resume.txt' })).toHaveCount(0);
  const after = await page.evaluate(() => window.kiteSetupHarness.newestDocuments());
  expect(after.map((document) => document.name)).toContain('new-resume.txt');
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  await go(`/sessions/${session!.id}/edit`);
  await expect(page.getByRole('combobox', { name: 'CV / Resume' })).toHaveText('new-resume.txt');
  await expect(page.getByRole('dialog', { name: 'Edit session' })).toBeVisible();
});

test('key terms are chips: typed, pasted as a list, removed, and saved one per line', async () => {
  await go('/sessions/new');
  await fillDetails();
  // v1.3.0 (ADR-0057): Key terms sit in a collapsed Advanced section; Contact name is gone.
  await expect(page.getByLabel('Contact name')).toHaveCount(0);
  await expect(page.getByLabel('Key terms')).toBeHidden();
  await page.getByText('Advanced', { exact: true }).click();
  const terms = page.getByLabel('Key terms');
  await terms.fill('Northwind');
  await terms.press('Enter');
  await terms.fill('Harbor, RAG; BM25');
  await terms.press('Enter');
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(4);
  await page.getByRole('button', { name: 'Remove RAG' }).click();
  await terms.press('Backspace');
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(2);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create interview session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();
  expect(await page.evaluate(() => window.kiteSetupHarness.keyTerms())).toBe('Northwind\nHarbor');
});

test('library pages: upload, list and delete, each library separately', async () => {
  await go('/documents');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByText('Upload price lists')).toBeVisible();
  await page.getByLabel('Upload a document').setInputFiles([
    { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('Alpha (invented).') },
    { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('Beta (invented).') },
  ]);
  await expect(page.getByRole('button', { name: 'Delete a.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete b.txt' })).toBeVisible();
  await shots('library-documents');
  await go('/resumes');
  await expect(page.getByRole('heading', { name: 'Resumes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete a.txt' })).toHaveCount(0);
});

test('Answer preferences: drill-in views, a static preview, STAR and Set as default', async () => {
  await go('/sessions/new');
  await fillDetails();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Configure' }).click();
  const dialog = page.getByRole('dialog', { name: 'Answer preferences' });
  await expect(dialog.getByRole('button', { name: /^Format/ })).toContainText(
    'Opening line + bullets',
  );
  // A new session starts at the built-in Balanced length.
  await expect(dialog.getByRole('button', { name: /^Length/ })).toContainText('Balanced');
  await expect(dialog.getByRole('button', { name: /^Tone/ })).toContainText('Plain');
  // Save waits for a change.
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  // The window's name follows its view, so the sample is found on the page.
  const sample = page.getByRole('region', { name: 'Sample answer' });
  await expect(sample).toContainText('Tell me about a time you disagreed');
  await shots('answer-preferences');

  // The preview follows the question type; nothing is asked of the server, then or later.
  await pickOption(page, dialog.getByRole('combobox', { name: 'Question type' }), 'Coding');
  await expect(sample).toContainText('Find the first repeated number');

  // A drill-in view: the preview changes at once; Back drops the change.
  await dialog.getByRole('button', { name: /^Format/ }).click();
  const format = page.getByRole('dialog', { name: 'Format' });
  await format.getByRole('radio', { name: /Bullets only/ }).click();
  await expect(sample).not.toContainText('Walk through the list once');
  await shots('answer-preferences-format');
  await format.getByRole('button', { name: 'Back' }).click();
  await expect(sample).toContainText('Walk through the list once');
  await expect(dialog.getByRole('button', { name: /^Format/ })).toContainText(
    'Opening line + bullets',
  );

  // Select keeps it; Save can be pressed now.
  await dialog.getByRole('button', { name: /^Format/ }).click();
  await format.getByRole('radio', { name: /Bullets only/ }).click();
  await format.getByRole('button', { name: 'Select' }).click();
  await expect(dialog.getByRole('button', { name: /^Format/ })).toContainText('Bullets only');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();

  // STAR, shown on a behavioural answer; Filler words is not available yet.
  await pickOption(page, dialog.getByRole('combobox', { name: 'Question type' }), 'Behavioural');
  await dialog.getByRole('button', { name: /^Format/ }).click();
  await format.getByRole('switch', { name: 'STAR structure' }).click();
  await expect(sample).toContainText('Situation:');
  await expect(sample).toContainText('Result:');
  await expect(format.getByText('Filler words')).toBeVisible();
  await expect(format.getByRole('switch', { name: 'Filler words' })).toHaveCount(0);
  await format.getByRole('button', { name: 'Select' }).click();

  // Length and tone; Technical stays as a third card.
  await dialog.getByRole('button', { name: /^Length/ }).click();
  const length = page.getByRole('dialog', { name: 'Length' });
  await expect(length).toBeVisible();
  await shots('answer-preferences-length');
  await expect(length.getByRole('radio')).toHaveCount(3);
  // Detailed, not Balanced: Balanced is already the default, so this still picks a different card.
  await length.getByRole('radio', { name: /Detailed/ }).click();
  await length.getByRole('button', { name: 'Select' }).click();
  await dialog.getByRole('button', { name: /^Tone/ }).click();
  const tone = page.getByRole('dialog', { name: 'Tone' });
  await expect(tone).toBeVisible();
  await shots('answer-preferences-tone');
  await expect(tone.getByRole('radio')).toHaveCount(3);
  await tone.getByRole('radio', { name: /Technical/ }).click();
  await tone.getByRole('button', { name: 'Select' }).click();

  await dialog.getByRole('button', { name: 'Set as default' }).click();
  await expect(dialog.getByText('New sessions will start with these.')).toBeVisible();
  expect(await page.evaluate(() => window.kiteSetupHarness.defaultTone())).toBe('technical');
  await dialog.getByRole('button', { name: 'Save' }).click();

  // AI instructions: Save waits for a change, Clear empties, and the row shows the start of it.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const instructions = page.getByRole('dialog', { name: 'AI instructions' });
  await expect(instructions.getByRole('button', { name: 'Save' })).toBeDisabled();
  await instructions
    .getByLabel('Context')
    .fill('Answer as a data analyst who likes short, clear points.');
  await instructions.getByRole('button', { name: 'Clear' }).click();
  await expect(instructions.getByLabel('Context')).toHaveValue('');
  await instructions
    .getByLabel('Context')
    .fill('Answer as a data analyst who likes short, clear points.');
  await shots('ai-instructions');
  await instructions.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Answer as a data analyst who likes short…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();

  await page.getByRole('combobox', { name: 'Select model' }).click();
  await shots('wizard-model-menu');
  await page.keyboard.press('Escape');

  // Language: a list with a search box.
  await page.getByRole('combobox', { name: 'Language' }).click();
  await shots('wizard-language-menu');
  await page.getByRole('textbox', { name: 'Search language' }).fill('span');
  await page.getByRole('option', { name: 'Spanish' }).click();
  await expect(page.getByText('Language of the answers')).toBeVisible();

  await page.getByRole('switch', { name: 'Auto answer' }).click();
  await shots('wizard-preferences');
  await page.getByRole('button', { name: 'Create interview session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  expect(session).toMatchObject({
    language: 'es',
    format: 'bullets',
    tone: 'technical',
    star: true,
    instructions: 'Answer as a data analyst who likes short, clear points.',
    autoAnswer: true,
  });
  expect(apiRequests.filter((request) => request !== '/api/models')).toEqual([]);
});

test('the model: Haiku recommended, and Sonnet unavailable when an admin turned it off', async () => {
  await go('/sessions/new');
  await fillDetails();
  await page.getByRole('button', { name: 'Next' }).click();
  const model = page.getByRole('combobox', { name: 'Select model' });
  await expect(model).toHaveText('Claude Haiku 5.5');
  await model.click();
  await expect(page.getByRole('option', { name: /Haiku/ })).toContainText('Recommended');
  await expect(page.getByRole('option', { name: /Sonnet/ })).toContainText('Deeper, slower');
  await page.getByRole('option', { name: /Sonnet/ }).click();
  await expect(model).toHaveText('Claude Sonnet 5.5');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard' }).click();

  await page.route('**/api/models', (route) => route.fulfill({ json: { deepModel: false } }));
  await go('/sessions/new');
  await fillDetails();
  await page.getByRole('button', { name: 'Next' }).click();
  await model.click();
  const sonnet = page.getByRole('option', { name: /Sonnet/ });
  await expect(sonnet).toContainText('Turned off');
  await expect(sonnet).toHaveAttribute('aria-disabled', 'true');
});

test('the last button follows the type, and Save transcript is on by default', async () => {
  for (const [type, label] of [
    ['interview', 'Create interview session'],
    ['regular', 'Create regular session'],
    ['mock', 'Create mock interview'],
  ] as const) {
    await go(`/sessions/new?type=${type}`);
    await page.getByLabel('Company').fill('Lantern Freight (invented)');
    await page.getByLabel(type === 'regular' ? 'Topic' : 'Role').fill('Data Analyst');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('button', { name: label })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Save transcript' })).toBeChecked();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
  }
});

test('company field: past sessions, then Brandfetch, one search after the pause, by keyboard', async () => {
  const printed: string[] = [];
  page.on('console', (message) => printed.push(message.text()));
  const { searches } = await mockBrandfetch();
  await page.evaluate(() =>
    window.kiteSetupHarness.seedSession('regular', 'Alder Partners (invented)', 'Old call', 1_000),
  );
  await go('/sessions/new');
  await page.getByRole('radio', { name: 'Regular' }).click();
  const field = page.getByRole('combobox', { name: 'Company' });

  // One character: nothing happens.
  await field.fill('A');
  await page.waitForTimeout(400);
  await expect(page.getByRole('listbox', { name: 'Suggestions' })).toHaveCount(0);
  expect(searches).toHaveLength(0);

  // Typing quickly sends one search, for the finished text.
  await field.pressSequentially('lder', { delay: 40 });
  const list = page.getByRole('listbox', { name: 'Suggestions' });
  await expect(list.getByRole('option')).toHaveText([
    // The past company's row starts with its letter tile.
    /Alder Partners \(invented\)$/,
    /Alderway Foods.*alderway\.example/,
    /Alder Works.*alderworks\.example/,
  ]);
  expect(searches).toHaveLength(1);

  // Only the typed text and the client ID are sent, with no cookie.
  expect(searches[0]!.url()).toBe('https://api.brandfetch.io/v2/search/Alder?c=invented-client-id');
  expect(searches[0]!.method()).toBe('GET');
  expect((await searches[0]!.allHeaders()).cookie).toBeUndefined();
  // Rows show the icon as it came, and no badge.
  await expect(list.getByRole('option').nth(1).locator('img')).toHaveAttribute(
    'src',
    BRANDS[0]!.icon,
  );
  await expect(list).not.toContainText(/verified|claimed/i);
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  await shots('company-suggestions');

  // Up from nothing goes to the last row, Down wraps to the first, then on to the second.
  await field.press('ArrowUp');
  await expect(list.getByRole('option').nth(2)).toHaveAttribute('aria-selected', 'true');
  await field.press('ArrowDown');
  await expect(list.getByRole('option').nth(0)).toHaveAttribute('aria-selected', 'true');
  await field.press('ArrowDown');
  await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(field).toHaveAttribute(
    'aria-activedescendant',
    (await list.getByRole('option').nth(1).getAttribute('id'))!,
  );
  await field.press('Enter');
  await expect(field).toHaveValue('Alderway Foods');
  await expect(list).toHaveCount(0);
  // Enter picked the row and stayed on this step.
  await expect(page.getByLabel('Topic')).toBeVisible();

  await createRegular();
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  expect(session).toMatchObject({ company: 'Alderway Foods', companyDomain: 'alderway.example' });
  // The name and domain are kept; the icon's address, which expires, is not.
  const everything = await page.evaluate(() => window.kiteSetupHarness.everything());
  expect(everything).not.toContain('icon-alderway');
  expect(everything).not.toContain('Alder Works');
  // Nothing typed reached the console.
  expect(printed.filter((line) => /alder/i.test(line))).toEqual([]);
});

test('company field: Esc closes only the list, and a typed name still works', async () => {
  const { searches } = await mockBrandfetch();
  await go('/sessions/new');
  await page.getByRole('radio', { name: 'Regular' }).click();
  const field = page.getByRole('combobox', { name: 'Company' });
  await field.fill('Alder');
  const list = page.getByRole('listbox', { name: 'Suggestions' });
  await expect(list.getByRole('option')).toHaveCount(2);
  await field.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Create session' })).toBeVisible();
  await expect(field).toHaveValue('Alder');

  // Enter with no row chosen picks nothing, and the name stays as typed.
  await field.fill('Alder Mills (invented)');
  await expect(list.getByRole('option')).toHaveCount(2);
  await field.press('Enter');
  await expect(field).toHaveValue('Alder Mills (invented)');
  expect(searches.length).toBeGreaterThan(0);

  // Leaving the field closes the list, and a reply that comes later does not open it.
  await page.getByLabel('Topic').click();
  await expect(list).toHaveCount(0);
  await createRegular();
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  expect(session).toMatchObject({ company: 'Alder Mills (invented)', companyDomain: null });
});

test('company field: a pick by mouse, then typing again, forgets the domain', async () => {
  await mockBrandfetch();
  await go('/sessions/new');
  await page.getByRole('radio', { name: 'Regular' }).click();
  const field = page.getByRole('combobox', { name: 'Company' });
  await field.fill('Alder');
  await page.getByRole('option', { name: /Alder Works/ }).click();
  await expect(field).toHaveValue('Alder Works');
  await field.fill('Alder Works Two (invented)');
  await page.getByLabel('Topic').click();
  await createRegular();
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  expect(session!.companyDomain).toBeNull();
});

test('company field: a failed search says so, keeps past sessions, and blocks nothing', async () => {
  await page.route('https://api.brandfetch.io/**', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'temporarily_unavailable' },
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  await page.evaluate(() =>
    window.kiteSetupHarness.seedSession('regular', 'Alder Partners (invented)', 'Old call', 1_000),
  );
  await go('/sessions/new');
  await page.getByRole('radio', { name: 'Regular' }).click();
  const field = page.getByRole('combobox', { name: 'Company' });
  await field.fill('Alder');
  await expect(page.getByRole('status').filter({ hasText: 'keep typing' })).toBeVisible();
  await expect(page.getByRole('option')).toHaveText([/Alder Partners \(invented\)$/]);
  await page.getByLabel('Topic').click();
  await createRegular();
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  expect(session!.company).toBe('Alder');
});

test('session card: the logo for its domain, with a real Referer, and a letter on any failure', async () => {
  const { images } = await mockBrandfetch();
  await page.evaluate(async () => {
    const h = window.kiteSetupHarness;
    const id = await h.seedSession('regular', 'Alderway Foods', 'Pilot review', 2_000);
    await h.setDomain(id, 'alderway.example');
    await h.seedSession('regular', 'Typed Name (invented)', 'No domain', 1_000);
  });
  await go('/');
  const card = page.getByRole('listitem').filter({ hasText: 'Alderway Foods' });
  const logo = card.locator('img');
  await expect(logo).toHaveAttribute(
    'src',
    'https://cdn.brandfetch.io/domain/alderway.example/w/48/h/48/fallback/404/type/icon?c=invented-client-id',
  );
  await expect
    .poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  // Brandfetch requires the page's address in the Referer.
  expect(new URL((await images[0]!.allHeaders()).referer ?? '').origin).toBe(
    new URL(page.url()).origin,
  );
  await shots('company-card-logo');
  // A typed name asks Brandfetch for nothing.
  expect(images).toHaveLength(1);
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Typed Name' }).locator('img'),
  ).toHaveCount(0);

  // No logo, or any failure: the letter tile.
  await page.unroute('https://cdn.brandfetch.io/**');
  await page.route('https://cdn.brandfetch.io/**', (route) => route.fulfill({ status: 404 }));
  await go('/settings-away');
  await page.reload();
  await page.waitForFunction(() => 'kiteSetupHarness' in window);
  await go('/');
  const reloaded = page.getByRole('listitem').filter({ hasText: 'Alderway Foods' });
  await expect(reloaded.getByText('P', { exact: true })).toBeVisible();
  await expect(reloaded.locator('img')).toHaveCount(0);
});

test('company suggestions off: nothing goes to Brandfetch, and cards show letters', async () => {
  await page.evaluate(async () => {
    localStorage.setItem('kite.companySuggestions', 'off');
    const h = window.kiteSetupHarness;
    const id = await h.seedSession('regular', 'Alderway Foods', 'Pilot review', 1_000);
    await h.setDomain(id, 'alderway.example');
  });
  await go('/');
  const card = page.getByRole('listitem').filter({ hasText: 'Alderway Foods' });
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toHaveCount(0);

  await go('/sessions/new');
  await page.getByRole('radio', { name: 'Regular' }).click();
  const field = page.getByRole('combobox', { name: 'Company' });
  await field.fill('Alder');
  // The past session is still suggested, with its domain but with no logo.
  const option = page.getByRole('option');
  await expect(option).toHaveText([/Alderway Foods.*alderway\.example/]);
  await expect(option.locator('img')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(brandfetchRequests).toEqual([]);
  await expect(page.getByRole('status').filter({ hasText: 'keep typing' })).toHaveCount(0);
});

test("the job link's company replaces a picked one, with no old domain", async () => {
  await mockBrandfetch();
  await page.route('**/api/job-import', (route) =>
    route.fulfill({
      json: { fields: { company: 'Lantern Freight (invented)' }, host: 'jobs.example.com' },
    }),
  );
  await go('/sessions/new');
  const field = page.getByRole('combobox', { name: 'Company' });
  await field.fill('Alder');
  await page.getByRole('option', { name: /Alder Works/ }).click();
  await page.getByRole('button', { name: 'Paste a job link' }).click();
  await page.getByLabel('Job post link').fill('https://jobs.example.com/42');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(field).toHaveValue('Lantern Freight (invented)');
  await page.getByLabel('Role').fill('Data Analyst');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create interview session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  expect(session!.companyDomain).toBeNull();
});
