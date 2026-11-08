/**
 * Production check of the desktop launcher (ADR-0051, Phase 5) in the desktop shell built from this
 * checkout (the same shell code as release 1.2.0) against the new web app, with a fresh temporary
 * profile, as the end-to-end TEST account (listed in KITE_SYNC_USERS). No Claude request. Two invented
 * sessions are put into the account through the sync API: one ready, one whose call just ended. The
 * home panel is then a launcher: no search and no Create session; the ready session with Start; "Call
 * ended · … View notes"; Open dashboard. Links open the web app in the system browser: here
 * window.open is replaced inside the panel, so nothing opens on this computer and the addresses are
 * checked instead. Start shows the start card. Both sessions are deleted at the end. Prints step
 * names only.
 * Run: pnpm --filter @kite/desktop build, then
 *      pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts launcher.spec.ts
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
import { PRODUCTION_URL, WEB_DIR, report, signIn, testAccount } from './helpers';

/** apps/desktop (built before this run). */
const DESKTOP_DIR = path.join(WEB_DIR, '..', 'desktop');

/** The Electron binary installed for apps/desktop. */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/** A fresh desktop profile for this run. */
const PROFILE_DIR = mkdtempSync(path.join(tmpdir(), 'kite-e2e-launcher-'));

/** This run's invented sessions. */
const RUN = Date.now().toString(36);
const READY = { id: randomUUID(), company: `E2E Launcher Ready ${RUN}` };
const ENDED = { id: randomUUID(), company: `E2E Launcher Ended ${RUN}` };

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let panel: Page;

/**
 * A complete invented session record, as the app stores it.
 *
 * @param id      Its id.
 * @param company Its company.
 * @param ended   True for a session whose call just ended.
 * @returns The record.
 */
function sessionRecord(id: string, company: string, ended: boolean) {
  const now = Date.now();
  return {
    id,
    type: 'regular',
    company,
    role: 'Pilot review',
    description: 'Invented session for the launcher check.',
    preferences: {
      language: 'en',
      model: 'fast',
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      keyTerms: '',
    },
    instructions: '',
    saveTranscript: false,
    autoAnswer: false,
    createdAt: now - 60_000,
    status: ended ? 'ended' : 'not-started',
    lastActiveAt: ended ? now : null,
    ...(ended ? { lastCallMs: 300_000 } : {}),
  };
}

/**
 * Sends sync operations from the signed-in panel.
 *
 * @param ops The operations.
 * @returns The HTTP status.
 */
function push(ops: unknown[]): Promise<number> {
  return panel.evaluate(async (body) => {
    const response = await fetch('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: body }),
    });
    return response.status;
  }, ops);
}

/**
 * The address the panel last tried to open in the browser (window.open is replaced in the panel).
 *
 * @returns The address, or null.
 */
function lastOpened(): Promise<string | null> {
  return panel.evaluate(() => (window as unknown as { kiteOpened?: string }).kiteOpened ?? null);
}

test.beforeAll(async () => {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [`--user-data-dir=${PROFILE_DIR}`, DESKTOP_DIR],
    // This checkout's shell opens production's address, as the desktop suite does.
    env: { ...env, KITE_URL: `${PRODUCTION_URL}/` },
  });
  panel = await app.firstWindow();
  await signIn(panel, testAccount(), true, true);
  await panel
    .getByRole('dialog', { name: 'Using Paramount AI' })
    .getByRole('button', { name: 'Got it' })
    .click({ timeout: 10_000 })
    .catch(() => undefined);
});

test.afterAll(async () => {
  await push([
    { op: 'delete', kind: 'session', id: READY.id },
    { op: 'delete', kind: 'session', id: ENDED.id },
  ]).catch(() => undefined);
  await app?.close().catch(() => undefined);
  rmSync(PROFILE_DIR, { recursive: true, force: true });
});

test('1. the panel is a launcher: ready sessions, the last call, Open dashboard', async () => {
  expect(
    await push([
      {
        op: 'put',
        kind: 'session',
        id: READY.id,
        baseRev: null,
        record: sessionRecord(READY.id, READY.company, false),
      },
      {
        op: 'put',
        kind: 'session',
        id: ENDED.id,
        baseRev: null,
        record: sessionRecord(ENDED.id, ENDED.company, true),
      },
    ]),
  ).toBe(200);
  // The panel pulls when its window gets focus.
  await expect
    .poll(
      async () => {
        await panel.evaluate(() => window.dispatchEvent(new Event('focus')));
        await panel.waitForTimeout(1_500);
        return (await panel.getByRole('list', { name: 'Sessions' }).allTextContents()).join(' ');
      },
      { timeout: 60_000 },
    )
    .toContain(READY.company);
  const list = panel.getByRole('list', { name: 'Sessions' });
  await expect(list).not.toContainText(ENDED.company);
  await expect(panel.getByRole('status').filter({ hasText: 'Call ended' })).toContainText(
    ENDED.company,
  );
  await expect(panel.getByRole('textbox', { name: 'Search sessions' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Create session/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /Open dashboard/ })).toBeVisible();
  report('launcher: ready list, last call, no search or create', true);
});

test('2. Open dashboard, View notes and the menu open the web app in the browser', async () => {
  await panel.evaluate(() => {
    // Nothing opens on this computer: the address is kept for the check.
    window.open = (url?: string | URL) => {
      (window as unknown as { kiteOpened?: string }).kiteOpened = String(url);
      return null;
    };
  });
  await panel.getByRole('button', { name: /Open dashboard/ }).click();
  expect(await lastOpened()).toBe(`${PRODUCTION_URL}/`);
  await panel.getByRole('button', { name: 'View notes' }).click();
  expect(await lastOpened()).toBe(`${PRODUCTION_URL}/sessions/${ENDED.id}`);
  await panel.getByRole('button', { name: 'Menu' }).click();
  await panel.getByRole('group', { name: 'Home panel menu' }).getByText('Get help').click();
  expect(await lastOpened()).toBe(`${PRODUCTION_URL}/help`);
  report('launcher: links open the web app', true);
});

test('3. Start shows the start card', async () => {
  await panel.keyboard.press('Escape');
  await panel
    .getByRole('list', { name: 'Sessions' })
    .getByRole('listitem')
    .filter({ hasText: READY.company })
    .getByRole('button', { name: 'Start' })
    .click();
  await expect(panel.getByRole('heading', { name: 'Start your session' })).toBeVisible();
  report('launcher: Start shows the start card', true);
});
