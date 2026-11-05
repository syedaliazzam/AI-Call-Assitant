/**
 * Production check of the app's two addresses (ADR-0046): the new one people open in a browser, and
 * the old one every installed 1.1.0 and 1.2.0 desktop app loads and is locked to. Covers, on each:
 * opening it never leads to another address, sign-in and sign-out work, the sign-in cookie stays on
 * that address, and a sign-in form from an unknown site is refused while the other address is
 * trusted. With KITE_E2E_ADMIN_ON=1 (the admin test account enabled for the run) it also opens the
 * admin page on the new address. Prints PASS or FAIL only; no Claude requests, so this costs nothing.
 * Manual run only (never in CI): pnpm --filter web test:e2e-prod domain.spec.ts
 */
import { chromium, expect, request as apiRequest, test, type Page } from '@playwright/test';
import { closeUseNotice, signInOnce } from '../lib/sign-in';
import { CUSTOM_DOMAIN_URL, OLD_ADDRESS_URL, report, testAccount } from './helpers';

test.describe.configure({ mode: 'serial' });

/** An address no account uses, so the refused-form checks cannot count against a real account. */
const NOBODY = { email: 'nobody@example.invalid', password: 'not-a-real-password' };

/** Production limits sign-in attempts per computer, per address, in a short window. */
const RATE_LIMIT_WAIT_MS = 11_000;

/**
 * Waits long enough for the sign-in rate limit to have passed.
 *
 * @returns Nothing.
 */
const waitOutRateLimit = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));

/**
 * Logs out from the account menu and checks the session really ended.
 *
 * @param page    The signed-in page.
 * @param address The address it is on.
 * @returns Nothing.
 */
async function logOut(page: Page, address: string): Promise<void> {
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.waitForURL(`${address}/login`);
  await page.goto(`${address}/`);
  await page.waitForURL(`${address}/login`);
}

for (const address of [CUSTOM_DOMAIN_URL, OLD_ADDRESS_URL]) {
  const host = new URL(address).host;

  test(`${host}: opening it stays on this address`, async () => {
    const http = await apiRequest.newContext();
    const response = await http.get(`${address}/`, { maxRedirects: 0 });
    // Installed desktop apps block any other address, so a redirect away would leave them stuck.
    const target = response.headers().location ?? '';
    const stays = target === '' || new URL(target, address).host === host;
    report(`${host} stays on this address`, stays);
    expect(stays).toBe(true);
    await http.dispose();
  });

  test(`${host}: sign in, cookie on this address only, log out`, async () => {
    await waitOutRateLimit();
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
      const page = await browser.newPage();
      await signInOnce(page, { baseUrl: address, ...testAccount(), fresh: true });
      await closeUseNotice(page);
      expect(new URL(page.url()).host).toBe(host);
      const domains = (await page.context().cookies()).map((cookie) => cookie.domain);
      expect(domains.length).toBeGreaterThan(0);
      expect(domains.every((domain) => domain === host)).toBe(true);
      report(`${host} sign in`, true);
      // The in-app guide names the new address, wherever it is read.
      await page.goto(`${address}/help`);
      await expect(page.getByText('call.paramountintelligence.co').first()).toBeVisible();
      report(`${host} guide names the new address`, true);
      // Its links are real links, and no Markdown is left showing.
      const releases = page.getByRole('link', { name: 'Paramount AI releases' });
      await expect(releases).toHaveAttribute(
        'href',
        'https://github.com/Zainpak123/kite-releases/releases/latest',
      );
      await expect(releases).toHaveAttribute('target', '_blank');
      await expect(page.getByText('](')).toHaveCount(0);
      report(`${host} guide shows its link as a link`, true);
      await expect(page.getByText('Windows protected your PC')).toBeVisible();
      await expect(page.getByText('If Smart App Control blocks it')).toBeVisible();
      await expect(page.getByRole('link', { name: CUSTOM_DOMAIN_URL })).toHaveAttribute(
        'href',
        CUSTOM_DOMAIN_URL,
      );
      report(`${host} guide has the Windows warning steps`, true);
      await logOut(page, address);
      report(`${host} log out`, true);
    } finally {
      await browser.close();
    }
  });

  test(`${host}: a form from another site is refused, the other address is trusted`, async () => {
    const other = address === CUSTOM_DOMAIN_URL ? OLD_ADDRESS_URL : CUSTOM_DOMAIN_URL;
    const http = await apiRequest.newContext();
    /**
     * Sends a sign-in form that cannot succeed, as if from the given site, after waiting out the
     * rate limit so that the answer is about the site.
     *
     * @param origin The site it claims to come from.
     * @returns The status.
     */
    const statusFrom = async (origin: string): Promise<number> => {
      await waitOutRateLimit();
      const response = await http.post(`${address}/api/auth/sign-in/email`, {
        headers: { origin },
        data: NOBODY,
      });
      return response.status();
    };
    expect(await statusFrom('https://example.invalid')).toBe(403);
    // Wrong details (401), not a refused site (403): the origin itself was accepted.
    expect(await statusFrom(other)).toBe(401);
    report(`${host} refuses other sites, trusts the other address`, true);
    await http.dispose();
  });
}

test('admin page on the new address (only with the admin test account enabled)', async () => {
  test.skip(process.env.KITE_E2E_ADMIN_ON !== '1', 'needs the admin test account enabled');
  await waitOutRateLimit();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage();
    await signInOnce(page, { baseUrl: CUSTOM_DOMAIN_URL, ...testAccount('admin'), fresh: true });
    await closeUseNotice(page);
    await page.goto(`${CUSTOM_DOMAIN_URL}/admin/users`);
    // A signed-in person who is not an admin is sent away from this page.
    await expect(page).toHaveURL(`${CUSTOM_DOMAIN_URL}/admin/users`);
    report('admin page on the new address', true);
    await logOut(page, CUSTOM_DOMAIN_URL);
  } finally {
    await browser.close();
  }
});
