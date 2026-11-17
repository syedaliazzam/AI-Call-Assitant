/**
 * Production latency measurement (day-04-answers.md Stage 11), as the admin test account
 * (KITE_E2E_ADMIN_*): opens /dev/latency on https://call.paramountintelligence.co in Chrome
 * (Playwright's Chromium) and in the desktop app (the real Electron shell, fresh profile, with
 * the page in the main window: the home panel keeps to its own pages since v1.1.0), runs
 * the 20 answers there (the real client path), and prints p50/p95 for key press → request sent
 * → first word → headline → done, and the cache hits. Manual run only (never in CI); numbers
 * only. Run it alone with: pnpm --filter web test:e2e-prod latency.spec.ts
 * ADR-0099: KITE_LATENCY_MODEL (an answer model, for example gemini-lite) and KITE_LATENCY_SESSION=cv choose
 * what /dev/latency measures (the page reads them from its address); unset, it measures as before.
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
  /** ADR-0099: answers that moved to Claude Haiku. */
  fallbacks?: number;
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
  // ADR-0099: the model and session to measure, when given.
  const query = new URLSearchParams({
    ...(process.env.KITE_LATENCY_MODEL ? { model: process.env.KITE_LATENCY_MODEL } : {}),
    ...(process.env.KITE_LATENCY_SESSION ? { session: process.env.KITE_LATENCY_SESSION } : {}),
    // ADR-0099: KITE_LATENCY_TIER=priority asks OpenAI for priority processing (a GPT model).
    ...(process.env.KITE_LATENCY_TIER ? { tier: process.env.KITE_LATENCY_TIER } : {}),
  }).toString();
  await page.goto(`${PRODUCTION_URL}/dev/latency${query ? `?${query}` : ''}`);
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
  report(
    `${label} latency (20 answers, ${process.env.KITE_LATENCY_MODEL ?? 'fast'})`,
    summary.count === 20,
    {
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
      fallbacks: summary.fallbacks ?? 0,
    },
  );
  // ADR-0099: the same timings over only the answers the asked model gave itself (a fallback is Claude
  // Haiku's), so a rate-limited provider's numbers are not mixed with Haiku's.
  const { samples = [] } = JSON.parse(text) as { samples?: OwnSample[] };
  const own = samples.filter((sample) => sample.fallback === null || sample.fallback === undefined);
  if (own.length !== samples.length) {
    report(`${label} latency, the model's own answers only`, own.length > 0, {
      answers: own.length,
      firstWordP50: nearestRank(
        own.map((sample) => sample.toFirstWord),
        50,
      ),
      firstWordP95: nearestRank(
        own.map((sample) => sample.toFirstWord),
        95,
      ),
      doneP50: nearestRank(
        own.map((sample) => sample.toDone),
        50,
      ),
      doneP95: nearestRank(
        own.map((sample) => sample.toDone),
        95,
      ),
      serverFirstTextP50: nearestRank(
        own.map((sample) => sample.serverToFirstText),
        50,
      ),
      cacheHits: own.filter((sample) => sample.cacheRead > 0).length,
    });
  }
  // ADR-0099: tokens per answer (averages over the 20), so the cost per answer can be worked out.
  const mean = (pick: (sample: OwnSample) => number) =>
    Math.round(
      samples.reduce((sum, sample) => sum + pick(sample), 0) / Math.max(1, samples.length),
    );
  report(`${label} tokens per answer`, samples.length > 0, {
    uncachedInput: mean((sample) => sample.input),
    cacheRead: mean((sample) => sample.cacheRead),
    output: mean((sample) => sample.output),
  });
  return summary;
}

/** ADR-0099: the per-answer numbers the page publishes (core/answer/latency.ts LatencySample). */
interface OwnSample {
  /** Key press → first word, ms. */
  toFirstWord: number;
  /** Key press → done, ms. */
  toDone: number;
  /** Server: request received → first text, ms. */
  serverToFirstText: number;
  /** Cache tokens read. */
  cacheRead: number;
  /** Uncached input tokens. */
  input: number;
  /** Output tokens. */
  output: number;
  /** Why the answer moved to Claude Haiku, or null. */
  fallback?: string | null;
}

/**
 * Nearest-rank percentile (as core/stt/metrics.ts percentile()).
 *
 * @param values The numbers.
 * @param p      The percentile, 0–100.
 * @returns The value, or 0 for none.
 */
function nearestRank(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  ]!;
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
  // KITE_INSTALLED_EXE: an installed Paramount AI.exe, to measure a release as its users have it.
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
      // With account sync a desktop window keeps only the call page and /dev/latency (ADR-0055,
      // desktopPages.ts): the dashboard ("/") opens in the browser and its window closes. The shell
      // opens only its own list of pages, so the main window's "/" is redirected to /dev/latency here.
      const dashboard = `${PRODUCTION_URL}/`;
      await app
        .context()
        .route(dashboard, (route) =>
          route.fulfill({ status: 302, headers: { location: `${PRODUCTION_URL}/dev/latency` } }),
        );
      const opened = app.waitForEvent('window');
      await first.evaluate(openMainWindow);
      page = await opened;
      await page.waitForLoadState();
      await app.context().unroute(dashboard);
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
