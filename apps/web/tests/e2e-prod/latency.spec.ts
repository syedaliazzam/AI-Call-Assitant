/**
 * Production latency measurement (day-04-answers.md Stage 11), as the admin test account
 * (KITE_E2E_ADMIN_*): opens /dev/latency on https://kite-call-assistant.vercel.app in Chrome
 * (Playwright's Chromium) and in the desktop app (the real Electron shell, fresh profile), runs
 * the 20 answers there (the real client path), and prints p50/p95 for key press → request sent
 * → first word → headline → done, and the cache hits. Manual run only (never in CI); numbers
 * only. Run it alone with: pnpm --filter web test:e2e-prod latency.spec.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, chromium, expect, test, type Page } from '@playwright/test';
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
  await page.goto(`${PRODUCTION_URL}/dev/latency`);
  await page.getByRole('button', { name: 'Run 20 answers' }).click();
  await expect(page.getByText('Done: 20 answers.')).toBeVisible({ timeout: 300_000 });
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
    cacheHits: summary.cacheHits,
  });
  return summary;
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
  const app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [`--user-data-dir=${profile}`, DESKTOP_DIR],
    env: { ...parentEnv, KITE_URL: `${PRODUCTION_URL}/` },
  });
  try {
    const summary = await measure(await app.firstWindow(), 'desktop');
    expect(summary.count).toBe(20);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
