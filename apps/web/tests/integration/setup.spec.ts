/**
 * Harness test for session setup (parity Phase 2, ADR-0029), no sign-in, runs in CI. With the real
 * Dashboard, SessionWizard and LibraryPage on the browser's real IndexedDB, and /api/job-import and
 * /api/preview mocked (no Claude call), it covers: the dashboard's tabs with counts, search, sort,
 * grid or list, the session card's chips and menu (rename, duplicate, delete), and Create session's
 * menu of types; the job link filling in details, saying what was imported, and failing kindly;
 * the Resume and Documents pickers with upload; a session keeping its copy when a library item is
 * deleted; the Answer preferences window with a preview asked for once and kept, and Set as
 * default; language and AI instructions.
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
} from '@playwright/test';
import type { AnswerPreviewRequest } from '@kite/shared';
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
/** How many previews were asked of the mocked server. */
let previewRequests = 0;

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
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kite setup harness</title>' +
        '<link rel="stylesheet" href="/harness/setup.css"></head>' +
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
  context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  previewRequests = 0;
  await page.route('**/api/preview', async (route) => {
    previewRequests += 1;
    const body = route.request().postDataJSON() as AnswerPreviewRequest;
    await route.fulfill({
      json: {
        text: `I would look at the query plan first (${body.style.tone}).\n- Check the indexes\nTip: Mention the 40 second report.`,
      },
    });
  });
  await page.goto(origin);
  await page.waitForFunction(() => 'kiteSetupHarness' in window);
});

test.afterEach(async () => {
  await context.close();
});

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
  await expect(page.getByRole('heading', { name: 'Alder Foods (invented)' })).toBeVisible();
}

/**
 * The cards' titles, top to bottom.
 *
 * @returns The titles.
 */
function titles() {
  return page.getByRole('heading', { level: 2 }).allTextContents();
}

test('dashboard: tabs with counts, search, sort, and grid or list', async () => {
  await seedDashboard();
  const tabs = page.getByRole('group', { name: 'Session type' }).or(page.getByRole('tablist'));
  await expect(tabs.first()).toContainText('All (3)');
  await expect(tabs.first()).toContainText('Interview (1)');
  await expect(tabs.first()).toContainText('Regular (1)');
  await expect(tabs.first()).toContainText('Mock (1)');
  await shots('dashboard-list');

  expect(await titles()).toEqual([
    'Alder Foods (invented)',
    'Lantern Freight (invented)',
    'Zephyr Labs (invented)',
  ]);
  await page.getByLabel('Sort').selectOption('oldest');
  expect((await titles())[0]).toBe('Zephyr Labs (invented)');
  await page.getByLabel('Sort').selectOption('company');
  expect((await titles())[0]).toBe('Alder Foods (invented)');

  await page.getByLabel('Search sessions').fill('analyst');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(2);
  await page.getByLabel('Search sessions').fill('zzz');
  await expect(page.getByText('No sessions match')).toBeVisible();
  await page.getByLabel('Search sessions').fill('');

  await page.getByText('Mock (1)').click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(1);
  await page.getByText('All (3)').click();

  await page.getByRole('radio', { name: 'Grid' }).click();
  await expect(page.getByRole('radio', { name: 'Grid' })).toBeChecked();
  await shots('dashboard-grid');
  // The choice is remembered.
  await page.reload();
  await page.waitForFunction(() => 'kiteSetupHarness' in window);
  await go('/');
  await expect(page.getByRole('radio', { name: 'Grid' })).toBeChecked();
});

test('session card: chips, status, Start or Review, and its menu', async () => {
  await seedDashboard();
  const card = (name: string) =>
    page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });
  const ready = card('Lantern Freight (invented)');
  await expect(ready).toContainText('Interview');
  await expect(ready).toContainText('Transcript');
  await expect(ready).toContainText('Ready to start');
  await expect(ready.getByRole('button', { name: 'Start session' })).toBeVisible();
  const ended = card('Zephyr Labs (invented)');
  await expect(ended).toContainText('Ended');
  await expect(ended).not.toContainText('Transcript');
  await expect(ended.getByRole('link', { name: 'Review' })).toBeVisible();

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

  // Duplicate: a new session that has not started.
  await card('Zephyr Labs (invented)')
    .getByRole('button', { name: /^More for / })
    .click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: 'Zephyr Labs (invented)' })).toHaveCount(2);
  await expect(page.getByText('All (4)')).toBeVisible();
  await expect(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Zephyr Labs (invented)' }) })
      .filter({ hasText: 'Ready to start' }),
  ).toHaveCount(1);

  // Delete asks first.
  await card('Alder Foods (invented)')
    .getByRole('button', { name: /^More for / })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this session?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('heading', { name: 'Alder Foods (invented)' })).toHaveCount(0);
});

test('Create session offers the types, and the wizard starts with the one chosen', async () => {
  await seedDashboard();
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Interview', 'Regular', 'Mock']);
  await page.getByRole('menuitem', { name: 'Mock' }).click();
  await expect(page.getByLabel('Session type')).toHaveValue('mock');
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
  await page.getByLabel('Paste a job link (optional)').fill('https://jobs.example.com/42');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Imported the company, role and job description from jobs.example.com',
  );
  await expect(page.getByLabel('Company')).toHaveValue('Lantern Freight (invented)');
  await expect(page.getByLabel('Role')).toHaveValue('Data Analyst');
  await expect(page.getByLabel('Job description (optional)')).toHaveValue(
    'Build reports with SQL.',
  );
  await shots('wizard-details');
  await page.getByLabel('Role').fill('Senior Data Analyst');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeVisible();
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
      json: { code: 'bad_request', message: 'Kite can only read public web pages.' },
    }),
  );
  await go('/sessions/new');
  await page.getByLabel('Company').fill('Typed first');
  await page.getByLabel('Paste a job link (optional)').fill('http://10.0.0.1/');
  await page.getByLabel('Paste a job link (optional)').press('Enter');
  await expect(page.getByRole('alert')).toContainText('public web pages');
  await expect(page.getByLabel('Company')).toHaveValue('Typed first');
});

test('job link: a page with no job in it adds nothing', async () => {
  await page.route('**/api/job-import', (route) =>
    route.fulfill({
      json: { fields: { company: '', role: '', description: '' }, host: 'blog.example.com' },
    }),
  );
  await go('/sessions/new');
  await page.getByLabel('Paste a job link (optional)').fill('https://blog.example.com/');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('alert')).toContainText('No job details found');
});

test('regular sessions have a topic and no job link or resume', async () => {
  await go('/sessions/new?type=regular');
  await expect(page.getByLabel('Topic')).toBeVisible();
  await expect(page.getByLabel('Paste a job link (optional)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload a resume' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload a document' })).toBeVisible();
});

test('pickers: choose from the library, upload, one resume, and the session keeps a copy', async () => {
  await page.evaluate(async () => {
    const h = window.kiteSetupHarness;
    await h.seedLibrary('resume', 'old-resume.txt', 'Old experience (invented).');
    await h.seedLibrary('document', 'prices.txt', 'Prices (invented).');
    await h.seedLibrary('document', 'notes.txt', 'Notes (invented).');
  });
  await go('/sessions/new');
  await page.getByLabel('Company').fill('Lantern Freight (invented)');
  await page.getByLabel('Role').fill('Data Analyst');

  // Several documents; one taken away again.
  await page.getByRole('checkbox', { name: 'prices.txt' }).click();
  await page.getByRole('checkbox', { name: 'notes.txt' }).click();
  await expect(page.getByRole('checkbox', { name: 'prices.txt' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'notes.txt' }).click();
  await expect(page.getByRole('checkbox', { name: 'notes.txt' })).not.toBeChecked();

  // One resume: choosing, then uploading another, leaves only the new one.
  await page.getByRole('radio', { name: 'old-resume.txt' }).click();
  await expect(page.getByRole('radio', { name: 'old-resume.txt' })).toBeChecked();
  await page.getByLabel('Upload a resume').setInputFiles({
    name: 'new-resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('New experience (invented).'),
  });
  await expect(page.getByRole('radio', { name: 'new-resume.txt' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'old-resume.txt' })).not.toBeChecked();
  await shots('wizard-pickers');

  // A file that cannot be read says so, and the wizard carries on.
  await page.getByLabel('Upload a document').setInputFiles({
    name: 'picture.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not text'),
  });
  await expect(page.getByRole('alert')).toContainText('picture.png');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeVisible();

  const documents = await page.evaluate(() => window.kiteSetupHarness.newestDocuments());
  expect(documents).toEqual(
    expect.arrayContaining([
      { name: 'prices.txt', text: 'Prices (invented).', kind: 'document' },
      { name: 'new-resume.txt', text: 'New experience (invented).', kind: 'resume' },
    ]),
  );
  expect(documents).toHaveLength(2);
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
  await expect(page.getByRole('button', { name: 'Remove new-resume.txt' })).toBeVisible();
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

test('Answer preferences: a preview is asked for once and kept; Apply and Set as default', async () => {
  await go('/sessions/new');
  await page.getByLabel('Company').fill('Lantern Freight (invented)');
  await page.getByLabel('Role').fill('Data Analyst');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Script + bullets · Short · Simple')).toBeVisible();
  await page.getByRole('button', { name: 'Configure: Answer preferences' }).click();
  const dialog = page.getByRole('dialog', { name: 'Answer preferences' });

  // Nothing is asked for until the user wants it.
  expect(previewRequests).toBe(0);
  await dialog.getByRole('button', { name: 'Show preview' }).click();
  await expect(dialog.getByText('I would look at the query plan first (simple).')).toBeVisible();
  await expect(dialog.getByText('Check the indexes')).toBeVisible();
  await expect(dialog.getByText('Mention the 40 second report.')).toBeVisible();
  expect(previewRequests).toBe(1);
  await shots('answer-preferences');

  // Another combination needs its own; going back shows the kept one, at no cost.
  await dialog.getByRole('radio', { name: 'Technical', exact: true }).first().click();
  await expect(dialog.getByRole('button', { name: 'Show preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Show preview' }).click();
  await expect(dialog.getByText('query plan first (technical)')).toBeVisible();
  expect(previewRequests).toBe(2);
  await dialog.getByRole('radio', { name: 'Simple' }).click();
  await expect(dialog.getByText('query plan first (simple)')).toBeVisible();
  expect(previewRequests).toBe(2);

  await dialog.getByRole('radio', { name: 'Professional' }).click();
  await dialog.getByRole('button', { name: 'Set as default' }).click();
  await expect(dialog.getByText('New sessions will start with these.')).toBeVisible();
  expect(await page.evaluate(() => window.kiteSetupHarness.defaultTone())).toBe('professional');
  await dialog.getByRole('radio', { name: 'Bullets only' }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Bullets only · Short · Professional')).toBeVisible();

  await page.getByLabel('Answer language').selectOption('es');
  await expect(page.getByText('Live transcription is English-only for now.')).toBeVisible();

  await page.getByRole('button', { name: 'Add: AI instructions' }).click();
  const instructions = page.getByRole('dialog', { name: 'AI instructions' });
  await instructions.getByLabel('Context for Kite').fill('Answer as a data analyst.');
  // Cancel keeps what was there; Save keeps the new words.
  await instructions.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('None yet. Tell Kite who you are')).toBeVisible();
  await page.getByRole('button', { name: 'Add: AI instructions' }).click();
  await instructions.getByLabel('Context for Kite').fill('Answer as a data analyst.');
  await instructions.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('None yet. Tell Kite who you are')).toHaveCount(0);

  await page.getByRole('switch', { name: 'Auto-answer (beta)' }).click();
  await shots('wizard-preferences');
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeVisible();
  const [session] = await page.evaluate(() => window.kiteSetupHarness.stored());
  expect(session).toMatchObject({
    language: 'es',
    format: 'bullets',
    tone: 'professional',
    instructions: 'Answer as a data analyst.',
    autoAnswer: true,
  });
});

test('a failed preview says so and can be tried again, and nothing is kept', async () => {
  await page.unroute('**/api/preview');
  await page.route('**/api/preview', (route) => route.fulfill({ status: 503, json: {} }));
  await go('/sessions/new');
  await page.getByLabel('Company').fill('Lantern Freight (invented)');
  await page.getByLabel('Role').fill('Data Analyst');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Configure: Answer preferences' }).click();
  const dialog = page.getByRole('dialog', { name: 'Answer preferences' });
  await dialog.getByRole('button', { name: 'Show preview' }).click();
  await expect(dialog.getByText('could not write a preview')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Show preview' })).toBeEnabled();
});
