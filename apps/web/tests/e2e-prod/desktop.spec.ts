/**
 * Production end-to-end suite, desktop app: the real Electron shell (apps/desktop, built to
 * dist/) opening https://kite-call-assistant.vercel.app with a fresh, empty profile, signed in
 * as the test account. Covers, in order: sign in; the dashboard is empty (the desktop app keeps
 * its own data, separate from Chrome); create a session, which survives a reload; Open goes
 * straight to Connect (no
 * Choose platform dialog); Connect needs no picker (system audio + Chromium's fake microphone
 * playing the official recording 0.wav); Go live shows final lines; a typed Chat question
 * streams an answer, which is rated (Day 4); the compact window (Day 5) opens on top without
 * focus, shows the live answer, and a question typed into it is answered; End closes it;
 * Settings → Delete all
 * local data → the dashboard is empty again. Manual run only (never in CI). Prints numbers only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  PRODUCTION_URL,
  RECORDINGS,
  WEB_DIR,
  answerAndRate,
  isMode,
  createSession,
  report,
  sessionCard,
  signIn,
  testAccount,
} from './helpers';

/** apps/desktop: package.json "main" → dist/main.js (built by the test:e2e-prod script). */
const DESKTOP_DIR = path.join(WEB_DIR, '..', 'desktop');

/** The Electron binary installed for apps/desktop (the `electron` package exports its path). */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/** A unique company per run. */
const COMPANY = `E2E Desktop Co ${Date.now().toString(36)}`;

test.describe.configure({ mode: 'serial' });

/** A fresh profile folder for this run, so the desktop app starts with no local data. */
const PROFILE_DIR = mkdtempSync(path.join(tmpdir(), 'kite-e2e-desktop-'));

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  // ELECTRON_RUN_AS_NODE would start Electron as plain Node.js (set by some editors' tools).
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [
      `--user-data-dir=${PROFILE_DIR}`,
      // Fake microphone: the recording once, then silence (no real microphone is used).
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${RECORDINGS.you}%noloop`,
      DESKTOP_DIR,
    ],
    env: { ...parentEnv, KITE_URL: `${PRODUCTION_URL}/` },
  });
  page = await app.firstWindow();
  // The profile really is the fresh one (otherwise "empty dashboard" would prove nothing).
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  expect(path.resolve(userData)).toBe(path.resolve(PROFILE_DIR));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(PROFILE_DIR, { recursive: true, force: true });
});

test('1. sign in, and the dashboard is empty (separate desktop data)', async () => {
  // Fresh: the desktop app keeps its own cookies (separate from the browser suites).
  await signIn(page, testAccount(), true);
  report('desktop sign in', true);
  // The first call runs with the main window in front, so the page can be driven; test 4 covers
  // the default, starting in the overlay.
  await page.evaluate(() => localStorage.setItem('kite.startInOverlay', 'off'));
  await expect(page.getByText('No sessions yet')).toBeVisible();
  report('desktop dashboard empty', true, {
    sessions: await page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'Open' }) })
      .count(),
  });
});

test('2. create a session (survives a reload); Open goes straight to Connect', async () => {
  await createSession(page, { company: COMPANY, keyTerms: ['Bluefin Route', 'Northwind'] });
  report('desktop create session', true);
  // The session is stored in the desktop app's own IndexedDB: still there after a reload.
  await page.reload();
  await expect(sessionCard(page, COMPANY)).toBeVisible();
  report('desktop session survives reload', true);
  await sessionCard(page, COMPANY).getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/live\//);
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
  const dialogs = await page.getByRole('dialog').count();
  report('desktop open without dialog', dialogs === 0, { dialogs });
  expect(dialogs).toBe(0);
});

test('3. Connect needs no picker; Go live shows lines; a Chat answer is rated; End', async () => {
  const startedAt = Date.now();
  await expect(page.getByText('Speech model ready')).toBeVisible({ timeout: 480_000 });
  report('desktop speech model ready', true, {
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });

  await page.getByRole('button', { name: 'Connect' }).click();
  // No picker exists in the desktop app: the shell approves system audio itself (media.ts).
  await expect(page.getByRole('button', { name: 'Go live' })).toBeVisible({ timeout: 30_000 });
  report('desktop connect (no picker)', true);
  await page.getByRole('button', { name: 'Go live' }).click();

  const lines = page.getByLabel('Live transcript').getByRole('listitem');
  // Final lines use the normal text colour (TranscriptStrip: text-ui-text, UI theme U3).
  const finals = lines.filter({ has: page.locator('span.text-ui-text') });
  await expect(finals.first()).toBeVisible({ timeout: 120_000 });
  const counts = {
    final: await finals.count(),
    finalYou: await finals.filter({ hasText: /^\s*You/ }).count(),
    finalThem: await finals.filter({ hasText: /^\s*Them/ }).count(),
  };
  report('desktop live lines appear', counts.final > 0, counts);

  // Answer with a typed Chat question: on this test machine "Them" (system audio) is silent,
  // so there is no question from the other side for the Answer key.
  const check = await answerAndRate(page, 'chat');
  report('desktop chat answer streams and is rated', check.headlineWords > 0, { ...check });
  expect(check.headlineWords).toBeGreaterThan(0);

  // The compact window (Day 5): a second Electron window with the real compact view.
  const compactOpened = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Overlay' }).click();
  const compact = await compactOpened;
  await compact.waitForLoadState();
  const liveHeadline = page.getByRole('heading', { name: 'Answer headline' });
  const compactHeadline = compact.getByRole('heading', { name: 'Answer line' });
  // (b) The live answer reaches the compact window over the session's BroadcastChannel.
  await expect(compactHeadline).toHaveText((await liveHeadline.textContent()) ?? '', {
    timeout: 20_000,
  });
  const shown = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      new URL(x.webContents.getURL()).pathname.startsWith('/compact/'),
    )!;
    return {
      onTop: w.isAlwaysOnTop(),
      focused: w.isFocused(),
      protectedOn: w.isContentProtected(),
    };
  });
  report('desktop compact window shows the live answer', shown.onTop && !shown.focused, {
    onTop: shown.onTop ? 1 : 0,
    focusedWhenShown: shown.focused ? 1 : 0,
    protectedByDefault: shown.protectedOn ? 1 : 0,
  });
  expect(shown).toMatchObject({ onTop: true, focused: false, protectedOn: false });
  await expect(compact.getByText('Visible in screen share')).toBeVisible();

  // (a) Click into the compact window's question box, type, Enter: the live page answers it.
  const before = (await liveHeadline.textContent()) ?? '';
  const chatResponse = page.waitForResponse((r) => isMode(r, 'chat'), { timeout: 60_000 });
  const box = compact.getByLabel('Type a question');
  await box.click();
  await box.pressSequentially('What was the late delivery change in the pilot?');
  await expect(box).toHaveValue('What was the late delivery change in the pilot?');
  await box.press('Enter');
  // Wait for the whole answer (the stream's end), then for the panel to finish showing it.
  await (await chatResponse).text();
  await expect(page.getByText('Answering…')).toHaveCount(0, { timeout: 30_000 });
  await expect(liveHeadline).not.toHaveText(before);
  await expect(compactHeadline).toHaveText((await liveHeadline.textContent()) ?? '', {
    timeout: 20_000,
  });
  const focusedAfterClick = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((x) => new URL(x.webContents.getURL()).pathname.startsWith('/compact/'))!
      .isFocused(),
  );
  report('desktop compact question box: typed question answered', true, {
    focusedAfterClick: focusedAfterClick ? 1 : 0,
  });

  await page.getByRole('button', { name: 'End', exact: true }).click();
  // End closes the compact window.
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1);
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
  report('desktop end', true);
});

test('4. starting in the overlay: it opens, the main window minimises, End restores it', async () => {
  await page.evaluate(() => localStorage.removeItem('kite.startInOverlay'));
  await page.reload();
  await expect(page.getByText('Speech model ready')).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('button', { name: 'Go live' })).toBeVisible({ timeout: 30_000 });
  const overlayOpened = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Go live' }).click();
  const overlay = await overlayOpened;
  await overlay.waitForLoadState();
  await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  /**
   * Whether the main window is minimised.
   *
   * @returns True when minimised.
   */
  const minimized = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((window) => !new URL(window.webContents.getURL()).pathname.startsWith('/compact/'))
        .some((window) => window.isMinimized()),
    );
  await expect.poll(minimized, { timeout: 10_000 }).toBe(true);
  report('desktop overlay start minimises', true);
  await overlay.getByRole('button', { name: 'End', exact: true }).click();
  await expect.poll(minimized, { timeout: 15_000 }).toBe(false);
  report('desktop overlay end restores', true);
  await page.getByRole('button', { name: 'Connect' }).waitFor({ timeout: 30_000 });
});

test('5. Settings → Delete all local data → empty dashboard', async () => {
  await page.goto(`${PRODUCTION_URL}/settings`);
  await page.getByRole('button', { name: 'Delete all local data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete everything' }).click();
  const deleted = page.getByText(/Deleted (\d+) sessions/);
  await expect(deleted).toBeVisible();
  const sessions = Number(/Deleted (\d+)/.exec((await deleted.textContent()) ?? '')?.[1]);
  await page.goto(PRODUCTION_URL);
  await expect(page.getByText('No sessions yet')).toBeVisible();
  report('desktop delete all local data', sessions >= 1, { sessionsDeleted: sessions });
  expect(sessions).toBeGreaterThanOrEqual(1);
});
