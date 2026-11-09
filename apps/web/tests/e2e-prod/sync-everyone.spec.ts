/**
 * Production check that account sync is on for EVERY account (KITE_SYNC_USERS = "*", ADR-0049), not
 * only for the accounts listed by id. Signed in as the ADMIN test account, which is deliberately not
 * in the id list (unflagged.spec.ts relies on that): if GET /api/sync/status says enabled for it, the
 * switch is "*". Read-only: one GET, nothing is written. No Claude request. Prints the step only.
 * Needs the admin test account to be enabled (it was disabled on 9 Nov 2026; enabling it is a
 * production database write, ADR-0050, so this check does not do it).
 * Run: pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts sync-everyone.spec.ts
 */
import { expect, test } from '@playwright/test';
import { PRODUCTION_URL, report, signIn, testAccount } from './helpers';

test('account sync is on for an account that is not in the id list', async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, testAccount('admin'));
  await page.goto(PRODUCTION_URL);
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/sync/status');
    return { status: response.status, json: (await response.json()) as unknown };
  });
  expect(status).toEqual({ status: 200, json: { enabled: true } });
  report('sync on for an unlisted account (the switch is "*")', true);
  await page.close();
});
