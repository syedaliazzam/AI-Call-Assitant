/**
 * Screenshots of the UI gallery /dev/ui (UI theme stage U1) at 1440, 900 and 390 px (the 390 px
 * run as a touch phone), signed in as the admin test account (the gallery is admin-only; the
 * account stays disabled except during this run). Each width checks: the gallery rendered, with
 * Montserrat and IBM Plex Mono; no sideways scroll; touch targets ≥ 44 px on the phone; no
 * console errors. Saves the screenshots in KITE_SCREENSHOT_DIR. Runs against KITE_UI_URL
 * (default http://localhost:3000, `pnpm dev`). No Claude call: the gallery makes none.
 */
import { chromium, expect, test, type Browser } from '@playwright/test';
import { BASE_URL, WIDTHS, check, openAt, signIn } from './shots';

let browser: Browser | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
});

for (const size of WIDTHS) {
  test(`/dev/ui at ${size.width} px`, async () => {
    const watched = await openAt(browser!, size);
    const { page } = watched;
    await signIn(page);
    await page.goto(`${BASE_URL}/dev/ui`);
    await expect(page.getByRole('heading', { name: 'UI components' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Grey band' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
      heading: getComputedStyle(document.querySelector('h1')!).fontFamily,
      mono: getComputedStyle(document.querySelector('.font-mono')!).fontFamily,
    }));
    expect(fonts.heading).toMatch(/Montserrat/i);
    expect(fonts.mono).toMatch(/IBM Plex Mono/i);
    await check(watched, size, 'dev-ui');
    await watched.context.close();
  });
}
