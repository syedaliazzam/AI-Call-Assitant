/**
 * Harness test for the Prepare tools (parity Phase 4, ADR-0029), no sign-in, runs in CI. With the
 * real MockInterview and QuestionBank on the browser's real IndexedDB, /api/prepare mocked (no
 * Claude call), and stand-ins for the voice, microphone and speech engine, it covers: a whole mock
 * interview (questions read aloud, the microphone opening only after each has been read, the last
 * words of an answer not lost, feedback, summary, saved as an ended Mock session and its source left
 * alone); typing instead of speaking, also with no microphone; ending early; failures; and the
 * question bank (written once, saved, shown again at no cost).
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
import type { MockFeedbackRequest, MockSummaryRequest, PrepareRequest } from '@kite/shared';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import { pickOption } from '../lib/pick-option';

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
/** The requests the mocked server received. */
let requests: PrepareRequest[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-prepare-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'prepare.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: bundleDir,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    alias: {
      'next/link': path.join(WEB_DIR, 'tests', 'integration', 'harness', 'next-link-stub.tsx'),
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
  writeFileSync(path.join(bundleDir, 'prepare.css'), css.css);
  server = createServer((req, res) => {
    if (req.url === '/harness/prepare.js' || req.url === '/harness/prepare.css') {
      const isCss = req.url.endsWith('.css');
      res.writeHead(200, { 'Content-Type': isCss ? 'text/css' : 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, isCss ? 'prepare.css' : 'prepare.js')));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paramount AI prepare harness</title>' +
        '<link rel="stylesheet" href="/harness/prepare.css"></head>' +
        '<body class="font-sans"><div id="root"></div>' +
        '<script type="module" src="/harness/prepare.js"></script></body></html>',
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
  context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  requests = [];
  await page.route('**/api/prepare', async (route) => {
    const body = route.request().postDataJSON() as PrepareRequest;
    requests.push(body);
    if (body.kind === 'mock-questions') {
      await route.fulfill({
        json: { questions: Array.from({ length: body.count }, (_, i) => `Question ${i + 1}?`) },
      });
    } else if (body.kind === 'mock-feedback') {
      await route.fulfill({ json: { feedback: `Feedback on: ${body.question}` } });
    } else if (body.kind === 'mock-summary') {
      await route.fulfill({
        json: { summary: ['You answered clearly.'], nextSteps: ['Use more numbers.'] },
      });
    } else {
      await route.fulfill({
        json: {
          groups: [
            {
              type: 'behavioural',
              questions: [
                {
                  question: 'Tell me about a conflict.',
                  answer: 'I listened first.\n- Then I asked',
                },
              ],
            },
            { type: 'role', questions: [{ question: 'Why this role?', answer: 'I like data.' }] },
          ],
        },
      });
    }
  });
  await page.goto(origin);
  await page.waitForFunction(() => 'kitePrepareHarness' in window);
});

test.afterEach(async () => {
  await context.close();
});

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
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/**
 * Seeds a session, shows the Mock Interview page and starts a 3-question interview.
 *
 * @param micFails True when the microphone is refused.
 */
async function startInterview(micFails = false): Promise<void> {
  await page.evaluate(async (fails) => {
    const h = window.kitePrepareHarness;
    await h.seed('interview', 'Lantern Freight (invented)', 'Data Analyst');
    h.showMock({ micFails: fails });
  }, micFails);
  await pickOption(page, page.getByLabel('Length'), '3 questions');
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page.getByLabel('Question', { exact: true })).toHaveText('Question 1?');
}

test('a whole interview: asked aloud, listened to, feedback, summary, saved', async () => {
  await page.evaluate(async () => {
    const h = window.kitePrepareHarness;
    await h.seed('regular', 'Regular Co (invented)', 'A topic');
    await h.seed('interview', 'Lantern Freight (invented)', 'Data Analyst');
    h.showMock();
  });
  // Regular calls are not offered: an interview needs a job.
  await page.getByLabel('Session').click();
  await expect(page.getByRole('option')).toHaveText(['Data Analyst at Lantern Freight (invented)']);
  await page.keyboard.press('Escape');
  await shots('mock-choose');
  await pickOption(page, page.getByLabel('Length'), '3 questions');
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page.getByLabel('Question', { exact: true })).toHaveText('Question 1?');
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  expect(requests[0]).toMatchObject({ kind: 'mock-questions', count: 3 });
  expect(requests[0]!.session.documents[0]?.name).toBe('resume.txt');

  // The microphone opens only after the question has been read.
  let events = await page.evaluate(() => window.kitePrepareHarness.events());
  expect(events.indexOf('speak:Question 1?')).toBeLessThan(events.indexOf('attach'));

  await page.evaluate(() => window.kitePrepareHarness.hear('I have used SQL'));
  await page.evaluate(() => window.kitePrepareHarness.hearPartial('for four'));
  await expect(page.getByLabel('What Paramount AI heard')).toContainText(
    'I have used SQL for four',
  );
  await shots('mock-listening');
  // Words still being heard when Done is pressed arrive as a final line; they are not lost.
  await page.evaluate(() => window.kitePrepareHarness.hearOnDetach('for four years'));
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Feedback')).toHaveText('Feedback on: Question 1?');
  await shots('mock-feedback');
  const first = requests[1] as MockFeedbackRequest;
  expect(first.answer).toBe('I have used SQL for four years');

  // The channel closes between questions.
  events = await page.evaluate(() => window.kitePrepareHarness.events());
  expect(events).toContain('detach');

  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.getByLabel('Question', { exact: true })).toHaveText('Question 2?');
  // Nothing from the last answer is carried over.
  await expect(page.getByLabel('What Paramount AI heard')).toHaveCount(0);
  await page.evaluate(() => window.kitePrepareHarness.hear('Second answer'));
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Feedback')).toHaveText('Feedback on: Question 2?');
  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.getByLabel('Question', { exact: true })).toHaveText('Question 3?');
  await page.evaluate(() => window.kitePrepareHarness.hear('Third answer'));
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Feedback')).toHaveText('Feedback on: Question 3?');
  await page.getByRole('button', { name: 'Finish' }).click();

  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toContainText('You answered clearly.');
  await expect(summary).toContainText('Use more numbers.');
  await shots('mock-summary');
  const summaryRequest = requests.at(-1) as MockSummaryRequest;
  expect(summaryRequest.items.map((item) => item.answer)).toEqual([
    'I have used SQL for four years',
    'Second answer',
    'Third answer',
  ]);

  // Saved as an ended Mock session; the session it came from is unchanged.
  const sessions = await page.evaluate(() => window.kitePrepareHarness.sessions());
  const mock = sessions.find((session) => session.type === 'mock')!;
  expect(mock).toMatchObject({ status: 'ended', company: 'Lantern Freight (invented)' });
  expect(sessions.filter((session) => session.type === 'interview')[0]?.status).toBe('not-started');
  const lines = await page.evaluate((id) => window.kitePrepareHarness.lines(id), mock.id);
  expect(lines).toHaveLength(6);
  expect(lines[0]).toEqual({ speaker: 'them', text: 'Question 1?' });
  expect(lines[1]).toEqual({ speaker: 'you', text: 'I have used SQL for four years' });
  expect(await page.evaluate((id) => window.kitePrepareHarness.summary(id), mock.id)).toEqual([
    'You answered clearly.',
  ]);
  await expect(summary.getByRole('link', { name: 'Review this interview' })).toHaveAttribute(
    'href',
    `/sessions/${mock.id}`,
  );
  // The microphone and engine are released.
  events = await page.evaluate(() => window.kitePrepareHarness.events());
  expect(events).toContain('stop');
});

test('a typed answer works, and is used over what was heard', async () => {
  await startInterview();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  await page.evaluate(() => window.kitePrepareHarness.hear('Misheard words'));
  await page.getByLabel('Or type your answer').fill('My typed answer');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Feedback')).toBeVisible();
  expect((requests[1] as MockFeedbackRequest).answer).toBe('My typed answer');
});

test('with the microphone refused, says so and answers can still be typed', async () => {
  await startInterview(true);
  await expect(page.getByText('The microphone is not available')).toBeVisible();
  await page.getByLabel('Or type your answer').fill('Typed instead');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Feedback')).toBeVisible();
});

test('ending early saves what was answered; ending at once saves nothing', async () => {
  await startInterview();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  await page.getByRole('button', { name: 'End interview' }).click();
  await expect(page.getByRole('button', { name: 'Start interview' })).toBeVisible();
  let sessions = await page.evaluate(() => window.kitePrepareHarness.sessions());
  expect(sessions.filter((session) => session.type === 'mock')).toHaveLength(0);

  await page.getByRole('button', { name: 'Start interview' }).click();
  await page.getByLabel('Or type your answer').fill('One answer');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Feedback')).toBeVisible();
  await page.getByRole('button', { name: 'End interview' }).click();
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible();
  sessions = await page.evaluate(() => window.kitePrepareHarness.sessions());
  const mock = sessions.find((session) => session.type === 'mock')!;
  expect(await page.evaluate((id) => window.kitePrepareHarness.lines(id), mock.id)).toHaveLength(2);
});

test('failures: no questions go back to the start; a lost summary still saves', async () => {
  await page.unroute('**/api/prepare');
  await page.route('**/api/prepare', (route) => route.fulfill({ status: 502, json: {} }));
  await page.evaluate(async () => {
    const h = window.kitePrepareHarness;
    await h.seed('interview', 'Lantern Freight (invented)', 'Data Analyst');
    h.showMock();
  });
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page.getByRole('alert')).toContainText('could not do that');
  await expect(page.getByRole('button', { name: 'Start interview' })).toBeVisible();

  await page.unroute('**/api/prepare');
  await page.route('**/api/prepare', async (route) => {
    const body = route.request().postDataJSON() as PrepareRequest;
    if (body.kind === 'mock-questions') await route.fulfill({ json: { questions: ['Only one?'] } });
    else if (body.kind === 'mock-feedback') await route.fulfill({ status: 502, json: {} });
    else await route.fulfill({ status: 502, json: {} });
  });
  await page.getByRole('button', { name: 'Start interview' }).click();
  await page.getByLabel('Or type your answer').fill('An answer');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Feedback')).toContainText('could not be written');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('alert')).toContainText('Your answers are saved');
  await expect(page.getByRole('link', { name: 'Review this interview' })).toBeVisible();
});

test('with no interview sessions, says what to do first', async () => {
  await page.evaluate(() => window.kitePrepareHarness.showMock());
  await expect(page.getByRole('link', { name: 'Create session' })).toBeVisible();
  await page.evaluate(() => window.kitePrepareHarness.showBank());
  await expect(page.getByRole('link', { name: 'Create session' })).toBeVisible();
});

test('question bank: written on request, grouped, saved, and shown again at no cost', async () => {
  const id = await page.evaluate(async () => {
    const h = window.kitePrepareHarness;
    const created = await h.seed('interview', 'Lantern Freight (invented)', 'Data Analyst');
    h.showBank();
    return created;
  });
  await expect(page.getByRole('button', { name: 'Write questions' })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Write questions' }).click();
  const behavioural = page.getByRole('region', { name: 'Behavioural' });
  await expect(behavioural).toContainText('Tell me about a conflict.');
  await expect(page.getByRole('region', { name: 'About this role' })).toContainText(
    'Why this role?',
  );
  expect(requests[0]).toMatchObject({ kind: 'question-bank' });
  expect(requests[0]!.session.documents[0]?.name).toBe('resume.txt');
  // The answer opens from its question.
  await behavioural.getByText('Tell me about a conflict.').click();
  await expect(behavioural.getByText('I listened first.')).toBeVisible();
  await expect(behavioural.getByText('Then I asked')).toBeVisible();
  await shots('question-bank');
  expect(await page.evaluate((target) => window.kitePrepareHarness.bankSize(target), id)).toBe(2);

  // Coming back shows the saved one, with no new request.
  await page.reload();
  await page.waitForFunction(() => 'kitePrepareHarness' in window);
  await page.evaluate(() => window.kitePrepareHarness.showBank());
  await expect(page.getByRole('region', { name: 'Behavioural' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write again' })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('question bank: a failure says so and keeps what was saved', async () => {
  await page.evaluate(async () => {
    const h = window.kitePrepareHarness;
    await h.seed('interview', 'Lantern Freight (invented)', 'Data Analyst');
    h.showBank();
  });
  await page.getByRole('button', { name: 'Write questions' }).click();
  await expect(page.getByRole('region', { name: 'Behavioural' })).toBeVisible();
  await page.unroute('**/api/prepare');
  await page.route('**/api/prepare', (route) => route.fulfill({ status: 502, json: {} }));
  await page.getByRole('button', { name: 'Write again' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Behavioural' })).toBeVisible();
});
