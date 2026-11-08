/**
 * Production check of account sync across devices (ADR-0049), as the end-to-end TEST account (which
 * must be listed in KITE_SYNC_USERS). No Claude request: no live page is opened. Three "devices":
 * two Chrome profiles (separate browser storage) and the desktop shell (apps/desktop as built from this
 * checkout, the same code as release 1.2.0) with a fresh temporary profile. Covers: a session created
 * in one profile appears in the other and on the desktop home panel; deleted while offline in one
 * profile, it stays elsewhere until that profile is back online, then disappears everywhere. Invented
 * data under a unique company per run; anything left over is deleted at the end through the sync API.
 * Prints step names and counts only.
 * Run: pnpm --filter @kite/desktop build, then
 *      pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts sync-devices.spec.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  PRODUCTION_URL,
  WEB_DIR,
  createSession,
  report,
  sessionCard,
  signIn,
  testAccount,
} from './helpers';

/** apps/desktop (built before this run). */
const DESKTOP_DIR = path.join(WEB_DIR, '..', 'desktop');

/** The Electron binary installed for apps/desktop. */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/** A unique company for this run. */
const COMPANY = `E2E Sync Co ${Date.now().toString(36)}`;

/** A fresh desktop profile for this run. */
const PROFILE_DIR = mkdtempSync(path.join(tmpdir(), 'kite-e2e-sync-'));

test.describe.configure({ mode: 'serial' });

let contextA: BrowserContext;
let contextB: BrowserContext;
let pageA: Page;
let pageB: Page;
let app: ElectronApplication;
let panel: Page;

/**
 * Reloads a dashboard until a session card shows (or stops showing).
 *
 * @param page    The page.
 * @param present True to wait for the card, false to wait for it to go.
 */
async function waitForCard(page: Page, present: boolean): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(PRODUCTION_URL);
        await page.waitForTimeout(3_000);
        return (await sessionCard(page, COMPANY).count()) > 0;
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(present);
}

test.beforeAll(async ({ browser }) => {
  contextA = await browser.newContext();
  contextB = await browser.newContext();
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
  await signIn(pageA, testAccount());
  await signIn(pageB, testAccount(), true);
});

test.afterAll(async () => {
  // Clean up only what this run made: sessions with this run's company (and their children).
  await pageA
    ?.evaluate(async (company) => {
      const response = await fetch('/api/sync/pull?since=0');
      if (!response.ok) return;
      const page = (await response.json()) as {
        /** The pulled records (only the fields read here). */
        records: {
          /** The record's kind. */
          kind: string;
          /** Its id. */
          id: string;
          /** True for a tombstone. */
          deleted: boolean;
          /** The record, or null for a tombstone. */
          record: {
            /** A session's company. */
            company?: string;
          } | null;
        }[];
      };
      const ops = page.records
        .filter((r) => r.kind === 'session' && !r.deleted && r.record?.company === company)
        .map((r) => ({ op: 'delete', kind: 'session', id: r.id }));
      if (ops.length > 0) {
        await fetch('/api/sync/push', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ops }),
        });
      }
    }, COMPANY)
    .catch(() => undefined);
  await app?.close().catch(() => undefined);
  rmSync(PROFILE_DIR, { recursive: true, force: true });
  await contextA?.close();
  await contextB?.close();
});

test('1. a session created in one Chrome profile appears in the other', async () => {
  await createSession(pageA, { company: COMPANY, keyTerms: ['Northwind'] });
  await waitForCard(pageB, true);
  report('sync: profile A → profile B', true);
});

test('2. it appears on the desktop home panel (fresh profile, shell code as 1.2.0)', async () => {
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
  await expect(panel.getByRole('list', { name: 'Sessions' })).toContainText(COMPANY, {
    timeout: 60_000,
  });
  report('sync: profile A → desktop panel', true);
});

test('3. deleted offline in profile B: stays elsewhere until B is back online, then goes', async () => {
  await pageB.goto(PRODUCTION_URL);
  await expect(sessionCard(pageB, COMPANY)).toBeVisible({ timeout: 30_000 });
  await contextB.setOffline(true);
  const card = sessionCard(pageB, COMPANY);
  await card.getByRole('button', { name: /^More for / }).click();
  await card.getByRole('menuitem', { name: 'Delete' }).click();
  await pageB.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
  // Profile A still has it: the delete is waiting in B's outbox.
  await pageA.waitForTimeout(8_000);
  await pageA.goto(PRODUCTION_URL);
  await pageA.waitForTimeout(3_000);
  expect(await sessionCard(pageA, COMPANY).count()).toBe(1);
  report('sync: offline delete waits', true);

  await contextB.setOffline(false);
  await waitForCard(pageA, false);
  // The desktop panel pulls when its window gets focus.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.focus();
  });
  await expect
    .poll(
      async () => {
        await panel.evaluate(() => window.dispatchEvent(new Event('focus')));
        await panel.waitForTimeout(2_000);
        // No waiting: an empty panel has no list at all.
        return (await panel.getByRole('list', { name: 'Sessions' }).allTextContents()).join(' ');
      },
      { timeout: 60_000 },
    )
    .not.toContain(COMPANY);
  report('sync: back online, delete reaches profile A and the desktop', true);
});
