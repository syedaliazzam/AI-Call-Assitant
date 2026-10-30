/**
 * Production end-to-end suite, desktop app: the real Electron shell (apps/desktop, built to
 * dist/) opening https://kite-call-assistant.vercel.app with a fresh, empty profile, signed in
 * as the test account. Covers, in order: sign in; the dashboard is empty (the desktop app keeps
 * its own data, separate from Chrome); create a session; Open goes straight to Connect (no
 * Choose platform dialog); Connect needs no picker (system audio + Chromium's fake microphone
 * playing the official recording 0.wav); Go live shows final lines; End; Settings → Delete all
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
  await signIn(page, testAccount());
  report('desktop sign in', true);
  await expect(page.getByText('No sessions yet')).toBeVisible();
  report('desktop dashboard empty', true, {
    sessions: await page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'Open' }) })
      .count(),
  });
});

test('2. create a session; Open goes straight to Connect', async () => {
  await createSession(page, { company: COMPANY, keyTerms: ['Bluefin Route', 'Northwind'] });
  report('desktop create session', true);
  await sessionCard(page, COMPANY).getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/live\//);
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
  const dialogs = await page.getByRole('dialog').count();
  report('desktop open without dialog', dialogs === 0, { dialogs });
  expect(dialogs).toBe(0);
});

test('3. Connect needs no picker; Go live shows lines; End', async () => {
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
  // Final lines are drawn in dark text (TranscriptStrip: text-slate-900).
  const finals = lines.filter({ has: page.locator('span.text-slate-900') });
  await expect(finals.first()).toBeVisible({ timeout: 120_000 });
  const counts = {
    final: await finals.count(),
    finalYou: await finals.filter({ hasText: /^\s*You/ }).count(),
    finalThem: await finals.filter({ hasText: /^\s*Them/ }).count(),
  };
  report('desktop live lines appear', counts.final > 0, counts);

  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
  report('desktop end', true);
});

test('4. Settings → Delete all local data → empty dashboard', async () => {
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
