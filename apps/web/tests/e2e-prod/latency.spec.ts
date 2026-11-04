/**
 * Production latency measurement (day-04-answers.md Stage 11), as the admin test account
 * (KITE_E2E_ADMIN_*): opens /dev/latency on https://kite-call-assistant.vercel.app in Chrome
 * (Playwright's Chromium) and in the desktop app (the real Electron shell, fresh profile, with
 * the page in the main window: the home panel keeps to its own pages since v1.1.0), runs
 * the 20 answers there (the real client path), and prints p50/p95 for key press → request sent
 * → first word → headline → done, and the cache hits. Manual run only (never in CI); numbers
 * only. Run it alone with: pnpm --filter web test:e2e-prod latency.spec.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, chromium, expect, test, type Page } from '@playwright/test';
import { closeUseNotice } from '../lib/sign-in';
import { PRODUCTION_URL, WEB_DIR, report, signIn, testAccount } from './helpers';

/** apps/desktop (built by the test:e2e-prod script). */
const DESKTOP_DIR = path.join(WEB_DIR, '..', 'desktop');

/** The Electron binary installed for apps/desktop. */
const ELECTRON_PATH = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;

/** One timing's p50 and p95. */
interface Spread {
  /** Median, ms. */
  p50: number;
  /** 95th percentile, ms. */
  p95: number;
}

/** The summary /dev/latency shows (core/answer/latency.ts LatencySummary). */
interface Summary {
  /** Answers measured. */
  count: number;
  /** Key press → request sent. */
  toSent: Spread;
  /** Key press → first word. */
  toFirstWord: Spread;
  /** Key press → headline complete. */
  toHeadline: Spread;
  /** Key press → done. */
  toDone: Spread;
  /** Server: request received → first text sent. */
  serverToFirstText: Spread;
  /** Answers that read the cache. */
  cacheHits: number;
}

/**
 * Signs in as the admin test account, runs /dev/latency and reads its summary.
 *
 * @param page  A fresh page (browser or desktop window).
 * @param label 'chrome' or 'desktop', for the report.
 * @returns The summary.
 */
async function measure(page: Page, label: string): Promise<Summary> {
  await signIn(page, testAccount('admin'));
  await runLatencyPage(page);
  return summarise(page, label);
}

/**
 * Starts the 20 answers.
 *
 * @param page A signed-in page in a normal window.
 * @returns When they are done.
 */
async function runLatencyPage(page: Page): Promise<void> {
  await page.goto(`${PRODUCTION_URL}/dev/latency`);
  await page.getByRole('button', { name: 'Run 20 answers' }).click();
  await expect(page.getByText('Done: 20 answers.')).toBeVisible({ timeout: 300_000 });
}

/**
 * Reads and reports the summary.
 *
 * @param page  The page that ran them.
 * @param label 'chrome' or 'desktop', for the report.
 * @returns The summary.
 */
async function summarise(page: Page, label: string): Promise<Summary> {
  const text = (await page.getByLabel('Latency results').textContent()) ?? '';
  const { summary } = JSON.parse(text) as { summary: Summary };
  report(`${label} latency (20 answers)`, summary.count === 20, {
    sentP50: summary.toSent.p50,
    sentP95: summary.toSent.p95,
    firstWordP50: summary.toFirstWord.p50,
    firstWordP95: summary.toFirstWord.p95,
    headlineP50: summary.toHeadline.p50,
    headlineP95: summary.toHeadline.p95,
    doneP50: summary.toDone.p50,
    doneP95: summary.toDone.p95,
    serverFirstTextP50: summary.serverToFirstText.p50,
    serverFirstTextP95: summary.serverToFirstText.p95,
    cacheHits: summary.cacheHits,
  });
  return summary;
}

/**
 * In the page: whether the shell has the home panel (1.1.0 or later).
 *
 * @returns True when it has.
 */
function shellHasPanel(): boolean {
  return 'openPagesWindow' in ((window as unknown as { kiteDesktop?: object }).kiteDesktop ?? {});
}

/**
 * In the page: opens the main window through the shell.
 *
 * @returns Nothing.
 */
function openMainWindow(): void {
  (
    window as unknown as {
      /** The desktop bridge. */
      kiteDesktop: {
        /** Opens a page in the main window. */
        openPagesWindow: (path: string) => void;
      };
    }
  ).kiteDesktop.openPagesWindow('/');
}

test('Chrome: 20 answers on /dev/latency', async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const summary = await measure(await browser.newPage(), 'chrome');
    expect(summary.count).toBe(20);
  } finally {
    await browser.close();
  }
});

test('Desktop app: 20 answers on /dev/latency', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'kite-e2e-latency-'));
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  // KITE_INSTALLED_EXE: an installed Kite.exe, to measure a release as its users have it.
  const installed = process.env.KITE_INSTALLED_EXE;
  const app = await electron.launch({
    executablePath: installed ?? ELECTRON_PATH,
    args: installed ? [`--user-data-dir=${profile}`] : [`--user-data-dir=${profile}`, DESKTOP_DIR],
    env: { ...parentEnv, KITE_URL: `${PRODUCTION_URL}/`, KITE_NO_UPDATE_CHECK: '1' },
  });
  try {
    // v1.1.0: the app starts on the home panel, which keeps to its own pages, so the answers run in
    // the main window, as a call does. A shell before 1.1.0 opens the main window first.
    const first = await app.firstWindow();
    await first.waitForLoadState();
    const hasPanel = await first.evaluate(shellHasPanel);
    let page = first;
    if (hasPanel) {
      await signIn(first, testAccount('admin'), true, true);
      // The one-time notice, here on the panel, so the main window does not show it too.
      await closeUseNotice(first);
      const opened = app.waitForEvent('window');
      await first.evaluate(openMainWindow);
      page = await opened;
      await page.waitForLoadState();
    } else {
      await signIn(first, testAccount('admin'));
    }
    await runLatencyPage(page);
    const summary = await summarise(page, 'desktop');
    expect(summary.count).toBe(20);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
