/**
 * Production check of the one-time upload (ADR-0049, Phase 4; privacy fix of 14 Nov 2026) on BOTH web
 * addresses, as the end-to-end TEST account (account sync is on for every account, ADR-0092). No Claude request. For each
 * address, a fresh Chrome profile signs in, then gets an invented session in the account's OWN local
 * database ('kite-l-<id>', what the account made on this device without account sync) and another in
 * the old shared 'kite' database (no owner recorded), seeded by harness/seed-legacy.ts. After a reload
 * the dashboard asks "This computer has 1 session from this account that isn't synced yet…" (the shared
 * database's session is never counted or shown), Add uploads it ("1 added, 0 were already there"), the
 * session shows on the dashboard, the shared session never does, and the question is not asked again
 * after a reload. Everything this run created in the account is deleted at the end through the sync
 * API. Prints step names only.
 * Run: pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts legacy-upload.spec.ts
 */
import path from 'node:path';
import { expect, test, type Browser } from '@playwright/test';
import { build } from 'esbuild';
import { closeUseNotice, signInOnce } from '../lib/sign-in';
import {
  CUSTOM_DOMAIN_URL,
  OLD_ADDRESS_URL,
  WEB_DIR,
  report,
  sessionCard,
  testAccount,
} from './helpers';

test.describe.configure({ mode: 'serial' });

/** The seeding script, bundled once. */
let seedScript = '';

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'e2e-prod', 'harness', 'seed-legacy.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  seedScript = result.outputFiles[0]!.text;
});

/**
 * Seeds, signs in, uploads and checks one address; then deletes what it made.
 *
 * @param browser The browser.
 * @param address The production address.
 * @param label   Its name for the report.
 */
async function checkAddress(browser: Browser, address: string, label: string): Promise<void> {
  const company = `E2E Upload ${label} ${Date.now().toString(36)}`;
  const sharedCompany = `E2E Shared ${label} ${Date.now().toString(36)}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  let sessionId = '';
  try {
    await signInOnce(page, { baseUrl: address, ...testAccount(), fresh: true });
    await closeUseNotice(page);
    await page.addScriptTag({ content: seedScript });
    sessionId = await page.evaluate(
      ([own, shared]) =>
        (
          window as unknown as {
            /** The seeding function (harness/seed-legacy.ts). */
            kiteSeedLegacy(ownCompany: string, sharedCompany: string): Promise<string>;
          }
        ).kiteSeedLegacy(own!, shared!),
      [company, sharedCompany],
    );
    await page.reload();
    await closeUseNotice(page);

    const card = page.getByRole('region', {
      name: "Add this account's unsynced data from this computer",
    });
    await expect(card).toContainText(
      "This computer has 1 session from this account that isn't synced yet.",
      {
        timeout: 30_000,
      },
    );
    await card.getByRole('button', { name: 'Add' }).click();
    await expect(card).toContainText('1 added, 0 were already there.', { timeout: 60_000 });
    await expect(sessionCard(page, company)).toBeVisible({ timeout: 30_000 });
    await expect(sessionCard(page, sharedCompany)).toHaveCount(0);
    report(`upload on ${label}: asked, added, shown; the shared database never offered`, true);

    await page.reload();
    await expect(sessionCard(page, company)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    await expect(card).toHaveCount(0);
    report(`upload on ${label}: not asked again`, true);
  } finally {
    // Delete only this run's session (and its document) from the account.
    if (sessionId) {
      await page
        .evaluate(async (id) => {
          await fetch('/api/sync/push', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ops: [{ op: 'delete', kind: 'session', id }] }),
          });
        }, sessionId)
        .catch(() => undefined);
    }
    await context.close();
  }
}

test('1. the custom domain', async ({ browser }) => {
  await checkAddress(browser, CUSTOM_DOMAIN_URL, 'custom domain');
});

test('2. the vercel.app address (the one installed desktop apps load)', async ({ browser }) => {
  await checkAddress(browser, OLD_ADDRESS_URL, 'vercel.app');
});
