/**
 * Production end-to-end suite, desktop app (v1.3.0 flow, ADR-0051, ADR-0053, ADR-0055, ADR-0056): the
 * real Electron shell (apps/desktop, built to dist/, or an installed program with KITE_INSTALLED_EXE)
 * opening https://call.paramountintelligence.co with a fresh, empty profile, signed in as the end-to-end
 * TEST account (listed in KITE_SYNC_USERS). In order: sign in on the home panel, with the acceptable-use
 * notice, landing on "Your sessions"; an invented session put into the account through the sync API (the
 * desktop app has no dashboard) shows there; a call from the panel: the session → Start your session →
 * Start free → Connect Call Session → Connect (downloading the speech model first when the profile has
 * none); the call window opens minimised and the overlay on top; lines in the transcript (the Transcript
 * switch); a real answer to a typed question in the reference chat bar, rated; asking again adds no entry;
 * Private covers every window; the ⋮ Position grid moves the overlay to the bottom row and back; Exit
 * asks first, the overlay closes, the panel comes back with "Call ended", and the call window closes
 * itself; the session is deleted (only what this run made, ADR-0050). Manual run only (never in CI).
 * Prints numbers only, and takes no screenshots: "Them" is this computer's real sound. Paid: 2 answers
 * on the fast model (well under $0.01).
 * Run: pnpm --filter @kite/desktop build, then
 *      pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts desktop.spec.ts
 */
import { randomUUID } from 'node:crypto';
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
  report,
  signIn,
  testAccount,
} from './helpers';

/** apps/desktop: package.json "main" → dist/main.js (built before this run). */
const DESKTOP_DIR = path.join(WEB_DIR, '..', 'desktop');

/** The Electron binary installed for apps/desktop (the `electron` package exports its path). */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/**
 * A built desktop program to test instead of this checkout's shell. It opens the address built into
 * it, so it runs as an installed app does (set KITE_E2E_URL to that address too).
 */
const BUILT_PROGRAM = process.env.KITE_INSTALLED_EXE;

/** This run's invented session. */
const SESSION = {
  id: randomUUID(),
  company: `E2E Desktop Co ${Date.now().toString(36)}`,
};

/** How long the speech model may take to download on a fresh profile, in ms. */
const MODEL_TIMEOUT_MS = 480_000;

test.describe.configure({ mode: 'serial' });

/** A fresh profile folder for this run, so the desktop app starts with no local data. */
const PROFILE_DIR = mkdtempSync(path.join(tmpdir(), 'kite-e2e-desktop-'));

let app: ElectronApplication;
/** The home panel (the desktop app's first window). */
let page: Page;

/**
 * The invented session, as the app stores it: a pilot review whose description holds the fact the
 * typed question asks about.
 *
 * @returns The record.
 */
function sessionRecord() {
  return {
    id: SESSION.id,
    type: 'regular',
    company: SESSION.company,
    role: 'Pilot review',
    description:
      'Pilot review with an invented logistics customer. The late delivery change in the pilot: the cut-off moved from 5 pm to 3 pm, so late orders now ship the next morning.',
    preferences: {
      language: 'en',
      model: 'fast',
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      keyTerms: 'Bluefin Route\nNorthwind',
    },
    instructions: '',
    saveTranscript: false,
    autoAnswer: false,
    createdAt: Date.now() - 60_000,
    status: 'not-started',
    lastActiveAt: null,
  };
}

/**
 * Sends sync operations from the signed-in panel.
 *
 * @param ops The operations.
 * @returns The HTTP status.
 */
function push(ops: unknown[]): Promise<number> {
  return page.evaluate(async (body) => {
    const response = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: body }),
    });
    return response.status;
  }, ops);
}

/**
 * What the shell's windows are doing.
 *
 * @returns The state of each, by its page's path.
 */
function windows() {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      path: new URL(window.webContents.getURL()).pathname,
      visible: window.isVisible(),
      minimized: window.isMinimized(),
      shielded: window.isContentProtected(),
      onTop: window.isAlwaysOnTop(),
      bounds: window.getBounds(),
    })),
  );
}

test.beforeAll(async () => {
  // ELECTRON_RUN_AS_NODE would start Electron as plain Node.js (set by some editors' tools).
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  app = await electron.launch({
    executablePath: BUILT_PROGRAM ?? ELECTRON_PATH,
    args: [
      `--user-data-dir=${PROFILE_DIR}`,
      // Fake microphone: the recording on a loop, so a line is sure to come (no real microphone).
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
  // The profile really is the fresh one.
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  expect(path.resolve(userData)).toBe(path.resolve(PROFILE_DIR));
});

test.afterAll(async () => {
  // Only what this run made (ADR-0050).
  await push([{ op: 'delete', kind: 'session', id: SESSION.id }]).catch(() => undefined);
  await app?.close().catch(() => undefined);
  rmSync(PROFILE_DIR, { recursive: true, force: true });
});

test('1. sign in on the home panel: Your sessions', async () => {
  await signIn(page, testAccount(), true, true);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('dialog', { name: 'Using Paramount AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('region', { name: 'Your sessions' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create session/ })).toHaveCount(0);
  report('desktop sign in, Your sessions', true);
});

test('2. a session made elsewhere shows on the panel', async () => {
  expect(
    await push([
      { op: 'put', kind: 'session', id: SESSION.id, baseRev: null, record: sessionRecord() },
    ]),
  ).toBe(200);
  // The panel pulls when its window gets focus.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForTimeout(1_500);
        return (await page.getByRole('list', { name: 'Sessions' }).allTextContents()).join(' ');
      },
      { timeout: 60_000 },
    )
    .toContain(SESSION.company);
  report('desktop session on the panel', true);
});

test('3. a call: Start → Connect, the overlay, an answer, Private, positions, Exit', async () => {
  await page
    .getByRole('list', { name: 'Sessions' })
    .getByRole('button', { name: new RegExp(SESSION.company) })
    .click();
  await expect(page.getByRole('heading', { name: 'Start your session' })).toBeVisible();
  await page.getByRole('button', { name: 'Start free' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Call Session' })).toBeVisible();

  const startedAt = Date.now();
  const overlayOpened = app.waitForEvent('window', {
    predicate: (window) => window.url().includes('/compact/'),
    timeout: MODEL_TIMEOUT_MS,
  });
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  // A fresh profile has no speech model: the one-time download comes first.
  const modelDialog = page.getByRole('dialog', { name: 'Speech model needed' });
  if (await modelDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await modelDialog.getByRole('button', { name: 'Download and connect' }).click();
    report('desktop speech model download asked', true);
  }
  const overlay = await overlayOpened;
  await overlay.waitForLoadState();
  await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
  report('desktop call connected', true, { seconds: Math.round((Date.now() - startedAt) / 1000) });
  const main = app.windows().find((window) => window.url().includes('/live/'))!;
  expect(main).toBeDefined();
  // ADR-0055: the call window stays minimised; the overlay is on top.
  await expect
    .poll(async () => (await windows()).find((w) => w.path.startsWith('/live/'))?.minimized, {
      timeout: 15_000,
    })
    .toBe(true);
  const overlayState = (await windows()).find((w) => w.path.startsWith('/compact/'))!;
  expect(overlayState).toMatchObject({ onTop: true, shielded: false });
  report('desktop call: overlay on top, call window minimised', true);

  // The Transcript switch opens the panel; the fake microphone's lines reach it.
  await overlay.getByRole('switch', { name: 'Transcript' }).click();
  const transcript = overlay.getByRole('region', { name: 'Transcript panel' });
  await expect(transcript.getByRole('listitem', { name: 'You said' }).first()).toBeVisible({
    timeout: 120_000,
  });
  report('desktop transcript panel shows lines', true);

  // A typed question in the reference chat bar gets a real answer in the answer panel. "Them" is this
  // computer's real sound, which may be silent, so there may be no question for the Answer key.
  const question = 'What was the late delivery change in the pilot?';
  const ask = async () => {
    const response = main.waitForResponse((r) => isMode(r, 'chat'), { timeout: 60_000 });
    if (!(await overlay.getByLabel('Type a question').isVisible())) {
      await overlay.getByRole('button', { name: /^Chat/ }).click();
    }
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
  await answer.getByRole('button', { name: 'Good answer' }).click();
  await expect(answer.getByRole('button', { name: 'Good answer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const words = (
    (await answer.getByRole('heading', { name: 'Answer line' }).textContent()) ?? ''
  ).split(/\s+/).length;
  report('desktop real answer, rated', words > 0, { lineWords: words });
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
  await menu.getByRole('switch', { name: 'Private' }).click();
  await expect.poll(async () => (await windows()).some((w) => w.shielded)).toBe(false);

  // ADR-0056: the Position grid puts the overlay on the bottom row (its bottom edge 16 above the work
  // area's) and back to the top centre.
  const grid = menu.getByRole('radiogroup', { name: 'Position' });
  await grid.getByRole('radio', { name: 'Bottom left' }).click();
  const area = await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.isAlwaysOnTop())!;
    return screen.getDisplayMatching(window.getBounds()).workArea;
  });
  await expect
    .poll(async () => {
      const bounds = (await windows()).find((w) => w.path.startsWith('/compact/'))!.bounds;
      return Math.abs(bounds.y + bounds.height - (area.y + area.height - 16)) <= 1;
    })
    .toBe(true);
  await expect(overlay.locator('.k-overlay-root')).toHaveAttribute('data-row', 'bottom');
  if (!(await menu.isVisible()))
    await overlay.getByRole('button', { name: 'Overlay menu' }).click();
  await grid.getByRole('radio', { name: 'Top centre' }).click();
  await expect(overlay.locator('.k-overlay-root')).toHaveAttribute('data-row', 'top');
  report('desktop positions: bottom row and back', true);
  await overlay.keyboard.press('Escape');

  // Exit asks first; the overlay closes; the panel comes back with "Call ended"; the call window
  // closes itself once the notes are saved.
  const closed = overlay.waitForEvent('close', { timeout: 15_000 });
  await overlay.getByRole('button', { name: /end call/i }).click();
  await overlay.getByRole('button', { name: 'End call?' }).click();
  await closed;
  await expect
    .poll(async () => (await windows()).find((w) => w.path === '/home')?.visible, {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Call ended' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => (await windows()).some((w) => w.path.startsWith('/live/')), {
      timeout: 90_000,
    })
    .toBe(false);
  report('desktop exit: overlay closes, panel returns, call window closes', true);
});

test('4. delete the session; it leaves the panel', async () => {
  expect(await push([{ op: 'delete', kind: 'session', id: SESSION.id }])).toBe(200);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.waitForTimeout(1_500);
        return (await page.getByRole('list', { name: 'Sessions' }).allTextContents()).join(' ');
      },
      { timeout: 60_000 },
    )
    .not.toContain(SESSION.company);
  report('desktop session deleted', true);
});
