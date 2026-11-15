/**
 * Production check of company suggestions and logos (ADR-0048), on both addresses, signed in as the
 * test account in a fresh browser each time. Covers: typing a real company shows Brandfetch's
 * suggestions; picking one and creating a session shows that company's real logo on its card; with
 * Settings → Privacy → Company suggestions off, nothing at all goes to Brandfetch, and the card shows
 * its letter again. Sessions live only in that fresh browser, which is thrown away. Prints PASS or
 * FAIL with counts only. No Claude requests, so this costs nothing; it does use Brandfetch's free
 * allowance (a few requests per address). It opens a windowed Chromium off-screen: Brandfetch refuses
 * logos to headless browsers.
 * Manual run only (never in CI): pnpm --filter web test:e2e-prod brandfetch.spec.ts
 */
import { chromium, expect, test } from '@playwright/test';
import { closeUseNotice, signInOnce } from '../lib/sign-in';
import { CUSTOM_DOMAIN_URL, OLD_ADDRESS_URL, report, testAccount } from './helpers';

test.describe.configure({ mode: 'serial' });

/** A well-known company, so that Brandfetch has it and has its logo. */
const COMPANY = 'Stripe';

/** Its domain. */
const DOMAIN = 'stripe.com';

/** Production limits sign-in attempts per computer, per address, in a short window. */
const RATE_LIMIT_WAIT_MS = 11_000;

for (const address of [CUSTOM_DOMAIN_URL, OLD_ADDRESS_URL]) {
  const host = new URL(address).host;

  test(`${host}: suggestions, a real logo on the card, and the off switch`, async () => {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
    // Brandfetch's logo service refuses headless browsers as automated traffic (it answers
    // x-bf-error automated_traffic), so this is a normal windowed Chromium, as a person's would be. The
    // window is placed off-screen, so nothing appears on the desktop of the computer running this.
    const browser = await chromium.launch({
      channel: 'chromium',
      headless: false,
      args: ['--window-position=-2400,-2400'],
    });
    try {
      const page = await browser.newPage();
      let toBrandfetch = 0;
      page.on('request', (request) => {
        if (new URL(request.url()).host.endsWith('brandfetch.io')) toBrandfetch += 1;
      });
      await signInOnce(page, { baseUrl: address, ...testAccount(), fresh: true });
      await closeUseNotice(page);

      // Suggestions from Brandfetch, with the company's domain.
      await page.goto(`${address}/sessions/new`);
      await page.getByRole('radio', { name: 'Regular' }).click();
      const field = page.getByRole('combobox', { name: 'Company' });
      await field.pressSequentially(COMPANY, { delay: 30 });
      const option = page.getByRole('option').filter({ hasText: DOMAIN }).first();
      await expect(option).toBeVisible({ timeout: 15_000 });
      report(`${host} suggestions appear`, true, {
        rows: await page.getByRole('option').count(),
      });
      // Each Brandfetch row shows its logo, drawn from the address the search gave.
      const rowLogo = option.locator('img');
      await expect(rowLogo).toBeVisible();
      await expect
        .poll(() => rowLogo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      const drawn = await page
        .getByRole('option')
        .locator('img')
        .evaluateAll(
          (images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length,
        );
      report(`${host} logos in the dropdown`, drawn > 0, { drawn });

      // Pick it and create the session: the card shows the real logo.
      await option.click();
      await expect(field).toHaveValue(/stripe/i);
      await page.getByLabel('Topic').fill('Logo check (invented)');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('button', { name: 'Create regular session' }).click();
      const card = page.getByRole('listitem').filter({ hasText: 'Logo check (invented)' });
      await expect(card).toBeVisible();
      // Soft: a refused logo is recorded, and the off switch below is still checked.
      const logo = card.locator('img');
      await expect.soft(logo).toBeVisible({ timeout: 15_000 });
      const width = (await logo.count())
        ? await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)
        : 0;
      report(`${host} real logo on the card`, width > 0, { width });

      // Off: no request of any kind goes to Brandfetch, and the card shows its letter.
      await page.goto(`${address}/settings`);
      const toggle = page.getByRole('switch', { name: 'Company suggestions' });
      await expect(toggle).toBeChecked();
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      toBrandfetch = 0;
      await page.goto(`${address}/`);
      await expect(card).toBeVisible();
      await expect(card.locator('img')).toHaveCount(0);
      await page.goto(`${address}/sessions/new`);
      await page.getByRole('radio', { name: 'Regular' }).click();
      await page
        .getByRole('combobox', { name: 'Company' })
        .pressSequentially(COMPANY, { delay: 30 });
      // The session just made is still suggested, from this device, with no logo.
      await expect(page.getByRole('option').filter({ hasText: DOMAIN })).toBeVisible();
      await expect(page.getByRole('option').locator('img')).toHaveCount(0);
      await page.waitForTimeout(1_500);
      expect(toBrandfetch).toBe(0);
      report(`${host} off sends nothing to Brandfetch`, true, { requests: toBrandfetch });

      // Leave the account as it was: with account sync the setting and the session follow the
      // account, so the next address's fresh browser would otherwise start with suggestions off
      // (found 15 Nov 2026: no logo there, as designed for "off").
      await page.goto(`${address}/settings`);
      await page.getByRole('switch', { name: 'Company suggestions' }).click();
      await expect(page.getByRole('switch', { name: 'Company suggestions' })).toBeChecked();
      await page.goto(`${address}/`);
      await card.getByRole('button', { name: /^More for / }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
      await expect(card).toHaveCount(0);
    } finally {
      await browser.close();
    }
  });
}
