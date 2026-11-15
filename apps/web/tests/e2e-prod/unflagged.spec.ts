/**
 * Production check that accounts WITHOUT the accountSync switch see today's app (ADR-0049 rollout):
 * signed in as a disposable ADMIN test account (not listed in KITE_SYNC_USERS; created for the run), the
 * sync routes say off and refuse, the dashboard has no one-time upload question, /help has no
 * account-data section, Settings still offers "Delete all local data", and the desktop link code route
 * refuses. No Claude request; nothing is written. Prints step names only.
 * Since KITE_SYNC_USERS is "*" (account sync for everyone; sync-everyone.spec.ts checks it), no account
 * is without the switch: the test then skips and says so, and runs again if the switch goes back to a
 * list of ids.
 * Run: pnpm --filter web create-e2e-user --prod --admin, then
 *      pnpm --filter web exec playwright test -c tests/e2e-prod/playwright.config.ts unflagged.spec.ts,
 *      then pnpm --filter web delete-test-accounts --prod
 */
import { expect, test } from '@playwright/test';
import { PRODUCTION_URL, report, signIn, testAccount } from './helpers';

test('an account without the switch sees no change', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, testAccount('admin'), true);
    const everyone = await page.evaluate(
      async () =>
        ((await (await fetch('/api/sync/status')).json()) as { enabled: boolean }).enabled,
    );
    // An unlisted account has sync only when the switch is "*": nothing to check then.
    test.skip(
      everyone,
      'account sync is on for everyone (KITE_SYNC_USERS is "*"): no unflagged account',
    );
    const api = await page.evaluate(async () => ({
      status: (await (await fetch('/api/sync/status')).json()) as { enabled: boolean },
      pull: (await fetch('/api/sync/pull?since=0')).status,
      code: (
        await fetch('/api/desktop/link-code', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: '11111111-1111-4111-8111-111111111111' }),
        })
      ).status,
    }));
    expect(api).toEqual({ status: { enabled: false }, pull: 404, code: 404 });

    await page.goto(PRODUCTION_URL);
    await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeAttached();
    await page.waitForTimeout(3_000);
    await expect(
      page.getByRole('region', { name: "Add this account's unsynced data from this computer" }),
    ).toHaveCount(0);
    await page.goto(`${PRODUCTION_URL}/help`);
    await expect(page.getByRole('region', { name: 'Your account and your data' })).toHaveCount(0);
    await page.goto(`${PRODUCTION_URL}/settings`);
    await expect(page.getByRole('button', { name: 'Delete all local data' })).toBeVisible();
    report('unflagged account: unchanged app', true);
  } finally {
    await context.close();
  }
});
