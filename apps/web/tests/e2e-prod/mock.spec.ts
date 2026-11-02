/**
 * Production check of Mock Interview, in Chromium, signed in as the test account, with the real
 * speech model and a fake microphone playing a recording: the harness (tests/integration/prepare.spec.ts)
 * uses stand-ins for these. Creates an Interview session, writes the questions, listens, gets
 * feedback, ends early, gets a summary, and opens the saved Mock session. Headless Chromium has no
 * voice, so this also covers reading aloud finishing by itself. Prints numbers only. Manual run only
 * (never in CI): 4 Claude requests (about $0.02). The temporary browser profile goes with its data.
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PRODUCTION_URL, RECORDINGS, report, signIn, testAccount } from './helpers';

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      // Fake microphone, looped: the microphone opens only after a question has been read, so
      // the recording must still be playing by then. No permission prompt.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${RECORDINGS.you}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  page = context.pages()[0] ?? (await context.newPage());
  await signIn(page, testAccount());
});

test.afterAll(async () => {
  await context?.close();
});

test('a mock interview with the real speech model, saved as a Mock session', async () => {
  await page.goto(`${PRODUCTION_URL}/sessions/new?type=interview`);
  await page.getByLabel('Company').fill('E2E Mock Co (invented)');
  await page.getByLabel('Role').fill('Data Analyst');
  await page
    .getByLabel('Job description (optional)')
    .fill('Build weekly reports with SQL and explain them to the operations team.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeVisible();

  await page.goto(`${PRODUCTION_URL}/mock`);
  await page.getByLabel('Length').selectOption('3');
  await page.getByRole('button', { name: 'Start interview' }).click();
  const question = page.getByLabel('Question', { exact: true });
  await expect(question).toHaveText(/\S/, { timeout: 60_000 });
  report('mock questions written', true, { characters: (await question.textContent())!.length });

  // Reading aloud ends by itself here (no voice); then the microphone opens.
  const done = page.getByRole('button', { name: 'Done' });
  await expect(done).toBeVisible({ timeout: 90_000 });
  // The first run on a new profile downloads the speech model (204 MB).
  const heard = page.getByLabel('What Kite heard');
  await expect(heard).toHaveText(/\S/, { timeout: 480_000 });
  report('mock listening: words heard', true, {
    words: (await heard.textContent())!.trim().split(/\s+/).length,
  });

  await done.click();
  const feedback = page.getByLabel('Feedback');
  await expect(feedback).toHaveText(/\S/, { timeout: 60_000 });
  report('mock feedback written', true, { characters: (await feedback.textContent())!.length });

  // The second question: the microphone is reconnected, and the words start again.
  const firstQuestion = await question.textContent();
  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(question).not.toHaveText(firstQuestion!);
  await expect(done).toBeVisible({ timeout: 90_000 });
  await expect(heard).toHaveText(/\S/, { timeout: 60_000 });
  report('mock listening again on the second question', true);
  await done.click();
  await expect(feedback).toHaveText(/\S/, { timeout: 60_000 });

  await page.getByRole('button', { name: 'End interview' }).click();
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });
  report('mock summary written', true, { points: await summary.getByRole('listitem').count() });

  await summary.getByRole('link', { name: 'Review this interview' }).click();
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  await expect(page.getByRole('listitem', { name: 'Them said' })).toHaveCount(2);
  await expect(page.getByRole('listitem', { name: 'You said' })).toHaveCount(2);
  await expect(page.getByRole('listitem', { name: 'Saved answer' })).toHaveCount(2);
  report('mock saved as a session', true);

  await page.goto(PRODUCTION_URL);
  await page.getByText(/^Mock \(1\)$/).click();
  await expect(page.getByRole('heading', { name: 'E2E Mock Co (invented)' })).toHaveCount(1);
  report('mock on the dashboard', true);
});
