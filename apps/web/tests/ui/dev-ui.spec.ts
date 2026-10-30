/**
 * Screenshots of the UI gallery /dev/ui (UI theme stage U1) at 1440 px and 390 px wide, signed
 * in as the admin test account (the gallery is admin-only; the account stays disabled except
 * during this run). Checks before each screenshot: the gallery rendered, Montserrat and IBM
 * Plex Mono are the fonts in use, nothing scrolls sideways, and the page logs no error or
 * warning. Saves the screenshots in
 * KITE_SCREENSHOT_DIR. Runs against KITE_UI_URL (default http://localhost:3000, `pnpm dev`).
 * No Claude call: the gallery makes none.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { testAccount } from '../e2e-prod/helpers';

/** The Kite to screenshot. */
const BASE_URL = (process.env.KITE_UI_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Where the screenshots go (required: they are for the report, not the repository). */
const SHOT_DIR = process.env.KITE_SCREENSHOT_DIR ?? '';

let browser: Browser | null = null;
let page: Page;
/** Console errors and warnings seen on /dev/ui (the gallery must render without any). */
const problems: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  expect(SHOT_DIR, 'set KITE_SCREENSHOT_DIR').not.toBe('');
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await chromium.launch();
  page = await (await browser.newContext()).newPage();
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()) && page.url().includes('/dev/ui')) {
      problems.push(`${message.type()}: ${message.text().slice(0, 4000)}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 300)}`));
  const account = testAccount('admin');
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeVisible();
});

test.afterAll(async () => {
  await browser?.close();
});

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`/dev/ui at ${width} px`, async () => {
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE_URL}/dev/ui`);
    await expect(page.getByRole('heading', { name: 'UI components' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dark surface' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
      heading: getComputedStyle(document.querySelector('h1')!).fontFamily,
      mono: getComputedStyle(document.querySelector('.font-mono')!).fontFamily,
    }));
    expect(fonts.heading).toMatch(/Montserrat/i);
    expect(fonts.mono).toMatch(/IBM Plex Mono/i);
    // No sideways scrolling at either width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // The Next.js dev-tools button is a development overlay, not part of the page.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    // caret 'initial': Playwright's default hides the text cursor by adding a style to every
    // input, which React then reports as a hydration mismatch if hydration is still running.
    await page.screenshot({
      path: path.join(SHOT_DIR, `dev-ui-${width}.png`),
      fullPage: true,
      caret: 'initial',
    });
    expect(problems).toEqual([]);
  });
}
