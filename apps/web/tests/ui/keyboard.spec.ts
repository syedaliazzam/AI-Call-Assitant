/**
 * Keyboard-only pass (UI theme stage U4): sign in, reach the dashboard and create a session
 * with only Tab, typing and Enter, in a running Kite (KITE_UI_URL, default the local
 * `pnpm dev`). At every Tab stop the focused element must show the accent focus ring (an
 * outline or the box-shadow ring in the accent blue). Signed in as the admin test account,
 * enabled only for the run. Invented session data; no Claude call (never opens /live).
 */
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { testAccount } from '../e2e-prod/helpers';
import { clearPasswordOnFailure } from '../lib/sign-in';
import { BASE_URL } from './shots';

let browser: Browser | null = null;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
});

/** What the test reads from the focused element. */
interface Focused {
  /** Tag and accessible name, for messages. */
  what: string;
  /** True when it shows the accent ring. */
  ring: boolean;
}

/**
 * Describes the focused element and whether it shows the accent focus ring.
 *
 * @param page The page.
 * @returns The focused element's description.
 */
async function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    // Not Kite's: the browser's own stop between the page's end and start, and the Next.js
    // dev-tools button (development only).
    if (!el || el === document.body || el.tagName === 'NEXTJS-PORTAL') {
      return { what: 'outside the page', ring: true };
    }
    const cs = getComputedStyle(el);
    const accent = '37, 99, 235';
    const ring =
      (cs.outlineStyle !== 'none' &&
        parseFloat(cs.outlineWidth) > 0 &&
        cs.outlineColor.includes(accent)) ||
      cs.boxShadow.includes(accent);
    const input = el as HTMLInputElement;
    const name =
      el.getAttribute('aria-label') ?? input.labels?.[0]?.textContent ?? el.textContent ?? '';
    return { what: `${el.tagName.toLowerCase()} "${name.trim().slice(0, 40)}"`, ring };
  });
}

/**
 * Presses Tab until the focused element's description contains `target`, checking the ring
 * at every stop.
 *
 * @param page    The page.
 * @param target  Text the focused element's description must contain.
 * @param missing Collects stops without a ring.
 * @param max     Most Tab presses.
 */
async function tabTo(page: Page, target: string, missing: string[], max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const now = await focused(page);
    if (!now.ring) missing.push(now.what);
    if (now.what.includes(target)) return;
  }
  throw new Error(`Tab never reached "${target}"`);
}

test('sign-in → dashboard → new session with the keyboard only, every stop with the accent ring', async () => {
  const page = await (
    await browser!.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const missing: string[] = [];
  const account = testAccount('admin');

  await page.goto(`${BASE_URL}/login`);
  await tabTo(page, 'Email', missing);
  await page.keyboard.type(account.email);
  await tabTo(page, 'Password', missing);
  // This test types the password itself (keyboard only); on a failure the field is emptied
  // first, so the failure snapshot shows no password (tests/lib/sign-in.ts).
  await clearPasswordOnFailure(page, account.email, async () => {
    await page.keyboard.type(account.password);
    await tabTo(page, 'Sign in', missing);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeVisible({
      timeout: 60_000,
    });
  });

  // A fresh browser sees the acceptable-use notice once (v1.1.0), which a key can close.
  await expect(page.getByRole('dialog', { name: 'Using Kite' })).toBeVisible();
  await tabTo(page, 'Got it', missing);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Using Kite' })).toHaveCount(0);

  // A fresh browser has no sessions: the empty state's button is the way in.
  await tabTo(page, 'Start your first session', missing);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Create session' })).toBeVisible();

  await tabTo(page, 'Company', missing);
  await page.keyboard.type('Keyboard Test Ltd (invented)');
  // The next field (its label depends on the session type: Role, Topic, …).
  await page.keyboard.press('Tab');
  const next = await focused(page);
  if (!next.ring) missing.push(next.what);
  await page.keyboard.type('Keyboard pass');
  await tabTo(page, 'Next', missing);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Key terms (optional)')).toBeVisible();
  // The button, not the sidebar's link of the same name.
  await tabTo(page, 'button "Create session"', missing);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Keyboard Test Ltd (invented)' })).toBeVisible();

  expect(missing, 'Tab stops without the accent focus ring').toEqual([]);
});
