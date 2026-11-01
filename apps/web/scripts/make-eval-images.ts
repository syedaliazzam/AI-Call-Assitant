/**
 * File: apps/web/scripts/make-eval-images.ts
 * Purpose: Draws the invented screenshots used by the answer evaluation's screenshot scenarios
 *          (tests/eval/scenarios/16–18) and saves them as JPEGs in tests/eval/images/: a slide
 *          with numbers, a code snippet with a bug, and a pricing table. Each is an invented HTML
 *          page rendered by Playwright's Chromium at 1,280 × 720 (under the 1,568 px limit), so
 *          the images are reproducible and contain no real company, person or customer.
 *          Usage: pnpm --filter web exec tsx scripts/make-eval-images.ts
 * Used by: a developer, once (the images are committed); tests/eval/scenarios/16–18 read them
 * Depends on: @playwright/test (chromium)
 * Architecture: docs/testing/answer-eval.md (screenshot scenarios); day-05-overlay-screenshots-notes.md
 *               Stage 2
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/** tests/eval/images. */
const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'eval',
  'images',
);

/** Shared page style: a large, plain slide. */
const STYLE = `<style>body{margin:0;font:28px/1.4 Arial,sans-serif;color:#0f172a;background:#fff}
.slide{padding:56px 72px}h1{font-size:44px;margin:0 0 28px}table{border-collapse:collapse;font-size:26px}
td,th{border:2px solid #cbd5e1;padding:14px 22px;text-align:left}th{background:#e2e8f0}
pre{font:24px/1.5 Consolas,monospace;background:#0f172a;color:#e2e8f0;padding:28px;border-radius:8px}
.note{color:#475569;font-size:22px;margin-top:24px}</style>`;

/** The three invented screens. */
const IMAGES: { name: string; html: string }[] = [
  {
    name: 'slide-numbers.jpg',
    html: `${STYLE}<div class="slide"><h1>Q3 renewal summary (invented)</h1>
<ul><li>Seats today: <b>128</b></li><li>Price: <b>52 dollars</b> per seat per month</li>
<li>Monthly total: <b>6,656 dollars</b></li><li>Renewal date: <b>1 December</b></li>
<li>Late deliveries: <b>down 33%</b> since the pilot</li></ul>
<p class="note">Harbor Lane Freight · invented figures for testing</p></div>`,
  },
  {
    name: 'code-bug.jpg',
    html: `${STYLE}<div class="slide"><h1>cart.ts (invented)</h1><pre>
export function cartTotal(items: { price: number }[]): number {
  let total = 0;
  for (let i = 0; i &lt;= items.length; i++) {
    total += items[i].price;
  }
  return total;
}</pre><p class="note">Reported: "cartTotal crashes on every cart"</p></div>`,
  },
  {
    name: 'pricing-table.jpg',
    html: `${STYLE}<div class="slide"><h1>Plans (invented)</h1><table>
<tr><th>Plan</th><th>Price</th><th>Seats</th><th>Single sign-on</th></tr>
<tr><td>Starter</td><td>18 dollars / seat / month</td><td>up to 10</td><td>No</td></tr>
<tr><td>Professional</td><td>52 dollars / seat / month</td><td>any</td><td>Yes</td></tr>
<tr><td>Enterprise</td><td>custom</td><td>200 or more</td><td>Yes</td></tr></table>
<p class="note">Billed yearly · onboarding 1,500 dollars one-time</p></div>`,
  },
];

/**
 * Renders and saves the images.
 *
 * @returns Nothing.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    for (const image of IMAGES) {
      await page.setContent(`<!doctype html><html><body>${image.html}</body></html>`);
      await page.screenshot({ path: path.join(OUT_DIR, image.name), type: 'jpeg', quality: 80 });
      console.log(`wrote ${image.name}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(`make-eval-images: failed (${error instanceof Error ? error.name : 'unknown'})`);
  process.exitCode = 1;
});
