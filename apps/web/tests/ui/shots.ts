/**
 * File: apps/web/tests/ui/shots.ts
 * Purpose: Shared steps of the UI screenshot runs (UI theme stages U1–U3): the widths, signing
 *          in as the admin test account, the checks made on every page (no sideways scroll; on
 *          a touch screen every tappable control at least 44 px tall; no console errors) and
 *          the screenshot itself.
 * Used by: tests/ui/dev-ui.spec.ts, tests/ui/pages.spec.ts
 * Depends on: @playwright/test, tests/e2e-prod/helpers.ts (testAccount)
 * Architecture: docs/design/kite-ui-theme.md §9 (gates)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { testAccount } from '../e2e-prod/helpers';
import { signInOnce } from '../lib/sign-in';

/** The Kite to screenshot (default the local `pnpm dev`). */
export const BASE_URL = (process.env.KITE_UI_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Where the screenshots go (required: they are for the report, not the repository). */
export const SHOT_DIR = process.env.KITE_SCREENSHOT_DIR ?? '';

/** One screenshot width. */
export interface Width {
  /** Viewport width, px. */
  width: number;
  /** Viewport height, px. */
  height: number;
  /** True to emulate a phone: touch, coarse pointer (the 44 px rule applies). */
  touch: boolean;
}

/**
 * The widths from UI stage U2 on: wide desktop, Kite docked beside a meeting, and a phone.
 */
export const WIDTHS: readonly Width[] = [
  { width: 1440, height: 900, touch: false },
  { width: 900, height: 900, touch: false },
  { width: 390, height: 844, touch: true },
];

/** A page with the console problems seen on it. */
export interface WatchedPage {
  /** The page. */
  page: Page;
  /** Its context. */
  context: BrowserContext;
  /** Console errors and warnings, and page errors (cleared by check()). */
  problems: string[];
}

/**
 * Opens a context at a width and watches its console.
 *
 * @param browser The browser.
 * @param size    The width.
 * @returns The page and its problem list.
 * Called from: dev-ui.spec.ts, pages.spec.ts
 */
export async function openAt(browser: Browser, size: Width): Promise<WatchedPage> {
  expect(SHOT_DIR, 'set KITE_SCREENSHOT_DIR').not.toBe('');
  mkdirSync(SHOT_DIR, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    ...(size.touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(
        `${new URL(page.url()).pathname} ${message.type()}: ${message.text().slice(0, 600)}`,
      );
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 600)}`));
  return { page, context, problems };
}

/**
 * Signs in as the admin test account (enabled only for the run), once per run: later pages
 * reuse the session (tests/lib/sign-in.ts), so production's sign-in rate limit cannot fail
 * the checks, and a failed sign-in leaves no password on the page.
 *
 * @param page The page.
 * @returns Nothing.
 * Called from: dev-ui.spec.ts, pages.spec.ts
 */
export async function signIn(page: Page): Promise<void> {
  await signInOnce(page, { baseUrl: BASE_URL, ...testAccount('admin') });
}

/**
 * Checks the current page and saves its screenshot as `<name>-<width>.png`.
 * - No sideways scrolling.
 * - On a touch screen: every visible button, switch, navigation link, button-looking link,
 *   field and select is at least 44 px tall.
 * - No console errors or warnings since the last check.
 *
 * @param watched The page.
 * @param size    Its width.
 * @param name    The screenshot's name.
 * Called from: dev-ui.spec.ts, pages.spec.ts
 */
export async function check(watched: WatchedPage, size: Width, name: string): Promise<void> {
  const { page } = watched;
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) {
    // Name the elements that stick out past the window's right edge (deepest last).
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => {
          if (element.getBoundingClientRect().right <= document.documentElement.clientWidth) {
            return false;
          }
          // Content inside a scrolling or clipping box cannot widen the page.
          for (let up = element.parentElement; up && up !== document.body; up = up.parentElement) {
            if (getComputedStyle(up).overflowX !== 'visible') return false;
          }
          return true;
        })
        .slice(-5)
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 80)} right=${element.getBoundingClientRect().right.toFixed(2)}`,
        ),
    );
    // Always fails here: the list only explains where the extra width comes from.
    expect({ overflow, wide }, `${name}: sideways scroll`).toEqual({ overflow: 0, wide: [] });
  }
  if (size.touch) {
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'button, [role="switch"], nav a, .k-btn, input:not([type="file"]):not([type="hidden"]), select',
        ),
      ]
        .filter((element) => element.offsetParent !== null && !element.closest('nextjs-portal'))
        .map((element) => ({
          what: `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)}"`,
          height: Math.round(element.getBoundingClientRect().height),
        }))
        .filter((target) => target.height < 44),
    );
    expect(small, `${name}: touch targets under 44 px`).toEqual([]);
  }
  // The Next.js dev-tools button is a development overlay, not part of the page. caret
  // 'initial': Playwright's default hides the text cursor by adding a style to every input,
  // which React reports as a hydration mismatch if hydration is still running.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}-${size.width}.png`),
    fullPage: true,
    caret: 'initial',
  });
  expect(watched.problems, `${name}: console problems`).toEqual([]);
  watched.problems.length = 0;
}
