/**
 * Production end-to-end suite, desktop app: the real Electron shell (apps/desktop, built to
 * dist/) opening https://call.paramountintelligence.co with a fresh, empty profile, signed in
 * as the test account. Covers the v1.1.0 flow, in order: sign in on the home panel, with the
 * acceptable-use notice; the panel opens the main window, where a session is created, and shows it;
 * a call starts from the panel's card, in the overlay, with the main window minimised and the panel
 * aside; lines in the transcript panel; a real answer in the answer panel, rated; asking again adds no
 * entry; Private covers every window; Dashboard opens a side window and the call carries on; the full
 * call window and back; End asks first, closes the overlay and brings the panel back; deleting the
 * session removes it from the panel (only what this run made, ADR-0050). Manual run only (never in
 * CI). Prints numbers only, and takes no screenshots: "Them" is this computer's real sound. Paid: 2
 * answers on the fast model.
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

/**
 * A built desktop program to test instead of this checkout's shell. It opens the address built into
 * it, so it runs as an installed app does (set KITE_E2E_URL to that address too).
 */
const BUILT_PROGRAM = process.env.KITE_INSTALLED_EXE;

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
    executablePath: BUILT_PROGRAM ?? ELECTRON_PATH,
    args: [
      `--user-data-dir=${PROFILE_DIR}`,
      // Fake microphone: the recording on a loop, so a line is sure to come however long the panel takes
      // to open (no real microphone is used).
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${RECORDINGS.you}`,
      ...(BUILT_PROGRAM ? [] : [DESKTOP_DIR]),
    ],
    // A built program must not look for updates here: it could install one when it closes.
    env: BUILT_PROGRAM
      ? { ...parentEnv, KITE_NO_UPDATE_CHECK: '1' }
      : { ...parentEnv, KITE_URL: `${PRODUCTION_URL}/` },
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

/** The main window, once the panel has opened it. */
let main: Page;

test('1. sign in on the home panel', async () => {
  // Fresh: the desktop app keeps its own cookies (separate from the browser suites). The panel keeps to
  // its own pages, so a sign-in comes back to it rather than going on to the dashboard.
  await signIn(page, testAccount(), true, true);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('dialog', { name: 'Using Paramount AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  // With account sync (ADR-0049) the panel shows the test account's sessions; without it, this fresh
  // profile has none. Either way the panel is ready: its list or its empty message.
  await expect(
    page.getByRole('list', { name: 'Sessions' }).or(page.getByText('No sessions yet')),
  ).toBeVisible();
  report('desktop sign in, home panel ready', true);
});

test('2. create a session in the main window; it shows on the panel, and survives a reload', async () => {
  const opened = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Create session' }).click();
  main = await opened;
  await main.waitForLoadState();
  await expect(main).toHaveURL(/\/sessions\/new/);
  report('desktop panel opens the main window', true);
  await createSession(main, { company: COMPANY, keyTerms: ['Bluefin Route', 'Northwind'] });
  await main.reload();
  await expect(sessionCard(main, COMPANY)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Sessions' })).toContainText(COMPANY);
  report('desktop session on the panel, survives reload', true);
});

test('3. a call: the overlay, Private on every window, a real answer, the side window, End', async () => {
  // Start from the panel's card: the main window goes to the call.
  await page
    .getByRole('list', { name: 'Sessions' })
    .getByRole('button', { name: 'Start' })
    .first()
    .click();
  // v1.2.0 (spec S10): what the call will use, first.
  await expect(page.getByRole('heading', { name: 'Start your session' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(main).toHaveURL(/\/live\//);
  const startedAt = Date.now();
  await expect(main.getByText('Speech model ready')).toBeVisible({ timeout: 480_000 });
  report('desktop speech model ready', true, {
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
  // No picker exists in the desktop app: the shell approves system audio itself (media.ts).
  // ADR-0053: Connect opens the overlay first and starts the call; there is no "Go live" step.
  const overlayOpened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Connect' }).click();
  const overlay = await overlayOpened;
  await expect(main.getByRole('button', { name: 'Go live' })).toHaveCount(0);
  await overlay.waitForLoadState();
  await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();

  /**
   * What the shell's windows are doing.
   *
   * @returns The state of each by its page.
   */
  const windows = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        path: new URL(window.webContents.getURL()).pathname,
        visible: window.isVisible(),
        minimized: window.isMinimized(),
        shielded: window.isContentProtected(),
        onTop: window.isAlwaysOnTop(),
        focused: window.isFocused(),
      })),
    );
  await expect
    .poll(async () => (await windows()).find((w) => w.path.startsWith('/live/'))?.minimized, {
      timeout: 10_000,
    })
    .toBe(true);
  await expect
    .poll(async () => (await windows()).find((w) => w.path === '/home')?.visible)
    .toBe(false);
  const overlayState = (await windows()).find((w) => w.path.startsWith('/compact/'))!;
  report('desktop call: overlay on top, main minimised, panel aside', overlayState.onTop, {
    focused: overlayState.focused ? 1 : 0,
  });
  expect(overlayState).toMatchObject({ onTop: true, shielded: false });

  // The microphone's fake recording reaches the transcript panel.
  await overlay.getByRole('button', { name: 'Open the transcript', exact: true }).click();
  const panel = overlay.getByRole('region', { name: 'Transcript panel' });
  await expect(panel.getByRole('listitem', { name: 'You said' }).first()).toBeVisible({
    timeout: 120_000,
  });
  report('desktop transcript panel shows lines', true);

  // A typed question gets a real answer, in the answer panel. "Them" is this computer's real sound,
  // which may be silent, so there may be no question for the Answer key.
  const question = 'What was the late delivery change in the pilot?';
  const ask = async () => {
    const response = main.waitForResponse((r) => isMode(r, 'chat'), { timeout: 60_000 });
    await overlay.getByRole('button', { name: /^Chat/ }).click();
    // For the call: on Auto, a question with no documents behind it may rightly go to Ask Kite.
    await overlay.getByRole('radio', { name: 'For the call' }).click();
    const box = overlay.getByLabel('Type a question');
    await box.fill(question);
    await box.press('Enter');
    await (await response).text();
  };
  await ask();
  const answer = overlay.getByRole('region', { name: 'Latest answer' });
  await expect(answer.getByRole('heading', { name: 'Answer line' })).not.toBeEmpty({
    timeout: 30_000,
  });
  await expect(answer.getByLabel('Question', { exact: true })).toContainText('?');
  await answer.getByRole('button', { name: 'Good answer' }).click();
  await expect(answer.getByRole('button', { name: 'Good answer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const words = (
    (await answer.getByRole('heading', { name: 'Answer line' }).textContent()) ?? ''
  ).split(/\s+/).length;
  report('desktop real answer on the card, rated', words > 0, { lineWords: words });
  // The same question again, and still one entry.
  await ask();
  await expect(overlay.getByText(/^\d+ of \d+$/)).toHaveCount(0);
  report('desktop asking again adds no entry', true);

  // Private: one switch, every window, on and off.
  await overlay.getByRole('button', { name: 'Overlay menu' }).click();
  const menu = overlay.getByRole('group', { name: 'Overlay settings' });
  await menu.getByRole('switch', { name: 'Private' }).click();
  await expect.poll(async () => (await windows()).every((w) => w.shielded)).toBe(true);
  report('desktop Private covers every window', true, { windows: (await windows()).length });

  // Dashboard during the call: a window of its own, also covered, and the call carries on.
  const sideOpened = app.waitForEvent('window');
  await menu.getByRole('button', { name: 'Dashboard' }).click();
  const side = await sideOpened;
  await side.waitForLoadState();
  await expect.poll(async () => (await windows()).every((w) => w.shielded)).toBe(true);
  expect((await windows()).some((w) => w.path.startsWith('/live/'))).toBe(true);
  report('desktop side window during the call', true);
  await side.close();
  // Dashboard closed the menu.
  await overlay.getByRole('button', { name: 'Overlay menu' }).click();
  await menu.getByRole('switch', { name: 'Private' }).click();
  await expect.poll(async () => (await windows()).some((w) => w.shielded)).toBe(false);

  // Open call window: the full view, solid, with the overlay hidden; Back to compact returns.
  await menu.getByRole('button', { name: 'Open call window' }).click();
  await expect
    .poll(async () => (await windows()).find((w) => w.path.startsWith('/compact/'))?.visible)
    .toBe(false);
  await expect(main.getByRole('toolbar', { name: 'Call controls' })).toBeVisible();
  await expect(main.getByRole('article', { name: 'Answer' })).toHaveCount(1);
  await expect(main.locator('.k-glass')).toHaveCount(0);
  await main.getByRole('button', { name: 'Back to compact' }).click();
  await expect
    .poll(async () => (await windows()).find((w) => w.path.startsWith('/compact/'))?.visible)
    .toBe(true);
  report('desktop call window and back', true);

  // End asks first; the overlay closes, the panel comes back.
  const closed = overlay.waitForEvent('close', { timeout: 15_000 });
  await overlay.getByRole('button', { name: 'End call' }).click();
  await overlay.getByRole('button', { name: 'End call?' }).click();
  await closed;
  await expect
    .poll(async () => (await windows()).find((w) => w.path === '/home')?.visible, {
      timeout: 15_000,
    })
    .toBe(true);
  report('desktop end: overlay closes, panel returns', true);
});

test('4. delete the session; it leaves the panel', async () => {
  // Only what this run made: with account sync, "Delete all my data" would remove every session of
  // the test account on every device (ADR-0050: tests clean up only what they created).
  await main.goto(PRODUCTION_URL);
  const card = sessionCard(main, COMPANY);
  await card.getByRole('button', { name: /^More for / }).click();
  await card.getByRole('menuitem', { name: 'Delete' }).click();
  await main.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Sessions' }).filter({ hasText: COMPANY }),
  ).toHaveCount(0);
  report('desktop session deleted', true);
});
