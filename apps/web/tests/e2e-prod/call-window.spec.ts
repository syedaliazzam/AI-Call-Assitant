/**
 * Production end-to-end check for v1.0.4 (ADR-0040): the real desktop shell against the deployed app,
 * signed in as the test account, with real Claude answers. Covers: a call starts in the overlay; a
 * typed question gets a real answer with the clean question on the card; asking again adds no entry;
 * ⛶ brings the full call window forward and hides the overlay, on a solid background, with one card;
 * Back to compact returns; End closes the overlay.
 * Manual run only (never in CI). Paid: 2 answers on the fast model, plus warm-ups (well under $0.01).
 * Prints numbers only, and takes no screenshots: "Them" is this computer's real sound.
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
  createSession,
  isMode,
  report,
  sessionCard,
  signIn,
  testAccount,
} from './helpers';

/** apps/desktop: package.json "main" → dist/main.js. */
const DESKTOP_DIR = path.join(WEB_DIR, '..', 'desktop');

/** The Electron binary installed for apps/desktop (the `electron` package exports its path). */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/** A fresh profile folder for this run. */
const PROFILE_DIR = mkdtempSync(path.join(tmpdir(), 'kite-e2e-call-window-'));

/** The question asked twice (invented). */
const QUESTION = 'What is a good way to keep a voice agent fast?';

/**
 * Whether the overlay window is showing.
 *
 * @param app The app.
 * @returns True when it is.
 */
function overlayVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => new URL(win.webContents.getURL()).pathname.startsWith('/compact/'))
        ?.isVisible() ?? false,
  );
}

/**
 * Types a question into the overlay's Chat box and waits for the real answer to finish.
 *
 * @param call    The call window's page (it sends the request).
 * @param overlay The overlay's page.
 */
async function ask(call: Page, overlay: Page): Promise<void> {
  const response = call.waitForResponse((r) => isMode(r, 'chat'), { timeout: 60_000 });
  await overlay.getByRole('button', { name: /^Chat/ }).click();
  const box = overlay.getByLabel('Type a question');
  await box.fill(QUESTION);
  await box.press('Enter');
  await (await response).text();
  await expect(overlay.getByText('Answering…')).toHaveCount(0, { timeout: 30_000 });
}

test('v1.0.4: overlay, one entry per question, the full call window and back', async () => {
  // ELECTRON_RUN_AS_NODE would start Electron as plain Node.js (set by some editors' tools).
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  const app = await electron.launch({
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
  try {
    const call = await app.firstWindow();
    await signIn(call, testAccount(), true);
    const company = `E2E Call Window ${Date.now().toString(36)}`;
    await createSession(call, { company, keyTerms: ['Northwind'] });
    await sessionCard(call, company).getByRole('button', { name: 'Start session' }).click();
    await expect(call.getByText('Speech model ready')).toBeVisible({ timeout: 480_000 });
    await call.getByRole('button', { name: 'Connect' }).click();
    await expect(call.getByRole('button', { name: 'Go live' })).toBeVisible({ timeout: 30_000 });

    // Calls start in the overlay by default.
    const opened = app.waitForEvent('window');
    await call.getByRole('button', { name: 'Go live' }).click();
    const overlay = await opened;
    await overlay.waitForLoadState();
    await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
    report('call starts in the overlay', true);

    // A real answer: the card shows the question Claude cleaned, and an answer line.
    await ask(call, overlay);
    const question = overlay.getByLabel('Question', { exact: true });
    await expect(question).toContainText('?');
    const line = (await overlay.getByLabel('Answer line').textContent()) ?? '';
    report('real answer on the card', line.length > 0, { lineWords: line.split(/\s+/).length });
    expect(line.length).toBeGreaterThan(0);
    await expect(overlay.getByText('Press Answer when they ask something.')).toHaveCount(0);

    // The same question again: a second real answer, and still one entry.
    await ask(call, overlay);
    const counter = await overlay.getByText(/^\d+ of \d+$/).count();
    report('asking again adds no entry', counter === 0, { counter });
    expect(counter).toBe(0);

    // ⛶: the full call window; the overlay hides.
    await overlay.getByRole('button', { name: 'Open call window' }).click();
    await expect.poll(() => overlayVisible(app)).toBe(false);
    const state = await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(
        (win) => !new URL(win.webContents.getURL()).pathname.startsWith('/compact/'),
      )!;
      return {
        minimized: main.isMinimized(),
        visible: main.isVisible(),
        focused: main.isFocused(),
      };
    });
    report('expand opens the call window', state.visible && !state.minimized, {
      focused: state.focused ? 1 : 0,
    });
    expect(state).toMatchObject({ visible: true, minimized: false });
    await expect(call.getByRole('toolbar', { name: 'Call controls' })).toBeVisible();
    const cards = call.getByRole('article', { name: 'Answer' });
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('aria-current', 'true');
    await expect(call.locator('.k-glass')).toHaveCount(0);
    report('one card, expanded, on a solid window', true, { cards: await cards.count() });

    // Back: the overlay shows, and the window steps aside.
    await call.getByRole('button', { name: 'Back to compact' }).click();
    await expect.poll(() => overlayVisible(app)).toBe(true);
    report('back to compact', true);

    // End closes the overlay.
    const closed = overlay.waitForEvent('close', { timeout: 15_000 });
    await overlay.getByRole('button', { name: 'End', exact: true }).click();
    await closed;
    report('end closes the overlay', true);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
});
