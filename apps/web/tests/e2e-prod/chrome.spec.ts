/**
 * Production end-to-end suite, Chrome (Playwright's Chromium), for the web app at
 * https://kite-call-assistant.vercel.app signed in as the test account. Covers, in order:
 * sign in; create a session with an invented one-page .txt and the key terms "Bluefin Route"
 * and "Northwind"; Open in browser shows "Listening for N key terms" (N ≥ 3); the live page's
 * warm-up writes Claude's prompt cache and a second warm-up (reload) reads it; Connect with
 * Chromium's fake microphone (official recording 0.wav) and a fake shared tab playing 1.wav;
 * Go live shows transcript lines; Answer (Ctrl+Enter, Day 4) streams a headline, which is rated
 * 👍, and its cache read is reported; End shows "Saved transcript (N lines)", which survives a
 * reload; the session is deleted. Manual run only (never in CI). Prints numbers only.
 */
import { readFileSync } from 'node:fs';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  PRODUCTION_URL,
  RECORDINGS,
  answerAndRate,
  createSession,
  inventedDocument,
  isWarmUp,
  report,
  sessionCard,
  signIn,
  testAccount,
  warmUsage,
} from './helpers';

/** Title of the fake "meeting" tab; Chromium auto-selects it when the page asks to share a tab. */
const THEM_TAB_TITLE = 'Kite E2E Them audio';

/** A unique company per run, so the card is found even if an old run left one behind. */
const COMPANY = `E2E Test Co ${Date.now().toString(36)}`;

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
/** The first warm-up's cache write, compared with the second warm-up's read. */
let firstWrite = 0;
/** The first warm-up's cache read: the shared rules block (Day 4: over the 512-token minimum, so
 * it is cached once for every session), or 0 when no other session used it in the last 5 min. */
let firstRead = 0;
/** Final transcript lines on screen just before End. */
let liveFinals = 0;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    // Full Chromium in new headless mode: tab capture is not available in the headless shell.
    channel: 'chromium',
    headless: true,
    args: [
      // Fake microphone: plays the recording once (%noloop), then silence, so the utterance
      // ends as speech does; looped back to back it would never pause. No permission prompt.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${RECORDINGS.you}%noloop`,
      // Fake tab share: getDisplayMedia picks the tab with this title, with its audio.
      `--auto-select-tab-capture-source-by-title=${THEM_TAB_TITLE}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  page = context.pages()[0] ?? (await context.newPage());
});

test.afterAll(async () => {
  await context?.close();
});

test('1. sign in', async () => {
  await signIn(page, testAccount());
  report('sign in', true);
});

test('2. create a session with a document and key terms', async () => {
  await createSession(page, {
    company: COMPANY,
    keyTerms: ['Bluefin Route', 'Northwind'],
    document: inventedDocument(),
  });
  report('create session', true);
});

test('3. Open in browser: key terms and the first warm-up (cache write)', async () => {
  const warm = page.waitForResponse(isWarmUp, { timeout: 60_000 });
  await sessionCard(page, COMPANY).getByRole('button', { name: 'Open' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open in browser' }).click();
  const line = page.getByText(/Listening for \d+ key terms?/);
  await expect(line).toBeVisible();
  const keyTerms = Number(/Listening for (\d+)/.exec((await line.textContent()) ?? '')?.[1]);
  report('listening for key terms', keyTerms >= 3, { keyTerms });
  expect(keyTerms).toBeGreaterThanOrEqual(3);

  const usage = await warmUsage(await warm);
  expect(usage).not.toBeNull();
  firstWrite = usage!.cache_creation_input_tokens;
  firstRead = usage!.cache_read_input_tokens;
  // A new session writes its own blocks; it may read the rules block other sessions cached.
  const pass = firstWrite > 0;
  report('warm-up 1 (cache write)', pass, {
    write: usage!.cache_creation_input_tokens,
    read: usage!.cache_read_input_tokens,
    output: usage!.output_tokens,
  });
  expect(pass).toBe(true);
});

test('4. second warm-up on reload (cache read)', async () => {
  const warm = page.waitForResponse(isWarmUp, { timeout: 60_000 });
  await page.reload();
  const usage = await warmUsage(await warm);
  expect(usage).not.toBeNull();
  const pass =
    usage!.cache_creation_input_tokens === 0 &&
    usage!.cache_read_input_tokens === firstWrite + firstRead;
  report('warm-up 2 (cache read)', pass, {
    write: usage!.cache_creation_input_tokens,
    read: usage!.cache_read_input_tokens,
    output: usage!.output_tokens,
  });
  expect(pass).toBe(true);
});

test('5. Connect (fake mic + fake tab), Go live, lines appear', async () => {
  const startedAt = Date.now();
  await expect(page.getByText('Speech model ready')).toBeVisible({ timeout: 480_000 });
  report('speech model ready', true, { seconds: Math.round((Date.now() - startedAt) / 1000) });

  // The "meeting" tab: a page in the same browser playing the second recording in a loop.
  const them = await context.newPage();
  const wav = readFileSync(RECORDINGS.them).toString('base64');
  await them.setContent(
    `<title>${THEM_TAB_TITLE}</title><audio autoplay loop src="data:audio/wav;base64,${wav}"></audio>`,
  );
  await page.bringToFront();

  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('button', { name: 'Go live' })).toBeVisible({ timeout: 30_000 });
  report('connect (no picker shown)', true);
  await page.getByRole('button', { name: 'Go live' }).click();

  const lines = page.getByLabel('Live transcript').getByRole('listitem');
  // Final lines use the normal text colour (TranscriptStrip: text-ui-text, UI theme U3); grey lines are still
  // being heard. Only final lines are saved, so the test waits for final ones.
  const finals = lines.filter({ has: page.locator('span.text-ui-text') });
  const you = finals.filter({ hasText: /^\s*You/ });
  const themLines = finals.filter({ hasText: /^\s*Them/ });
  // Wait for final lines, then a little longer for more. In headless Chromium the fake
  // microphone also carries the shared tab's sound (measured 2026-10-30: the You and Them meters
  // move together), so "You" repeats "Them" and the echo filter correctly hides those lines.
  // The step therefore needs final lines from either side, and reports each side's count.
  await expect(finals.first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(15_000);
  const counts = {
    shown: await lines.count(),
    final: await finals.count(),
    finalYou: await you.count(),
    finalThem: await themLines.count(),
  };
  report('live lines appear', counts.final > 0, counts);
  liveFinals = counts.final;
});

test('6. Answer (Ctrl+Enter): the headline streams in, and the answer is rated', async () => {
  const check = await answerAndRate(page, 'hotkey');
  const pass = check.headlineWords > 0 && check.cacheRead > 0;
  report('answer streams and is rated', pass, { ...check });
  expect(pass).toBe(true);
});

test('7. End: saved transcript survives a reload', async () => {
  await page.getByRole('button', { name: 'End', exact: true }).click();
  const saved = page.getByText(/Saved transcript \((\d+) lines?\)/);
  await expect(saved).toBeVisible({ timeout: 30_000 });
  const before = Number(/\((\d+)/.exec((await saved.textContent()) ?? '')?.[1]);
  await page.reload();
  await expect(saved).toBeVisible({ timeout: 30_000 });
  const after = Number(/\((\d+)/.exec((await saved.textContent()) ?? '')?.[1]);
  // At least the final lines seen during the call (merged lines can make it fewer only if two
  // finals merged into one, so compare with ≥ 1 and report both numbers).
  const pass = before > 0 && after === before;
  report('saved transcript after reload', pass, {
    finalLinesInCall: liveFinals,
    // The Day 4 End fix: the line still being heard at End is saved too, so never fewer.
    savedAtLeastLive: before >= liveFinals ? 1 : 0,
    savedBefore: before,
    savedAfter: after,
  });
  expect(pass).toBe(true);
});

test('8. delete the session', async () => {
  await page.goto(PRODUCTION_URL);
  const card = sessionCard(page, COMPANY);
  await card.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
  report('delete session', true);
});
