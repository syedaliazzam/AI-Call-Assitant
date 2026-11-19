/**
 * File: apps/web/scripts/make-eval-images.ts
 * Purpose: Draws the invented screenshots used by the answer evaluation's screenshot scenarios
 *          (tests/eval/scenarios/16–18, and v1.1.0's screenshot-types group) and saves them as JPEGs in
 *          tests/eval/images/: a slide with numbers, a code snippet with a bug, a pricing table, a
 *          coding problem, a Python error, a chart, a document, a web page and an unreadable screen.
 *          Each is an invented HTML
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
  // v1.1.0 (ADR-0043): the screenshot-types group.
  {
    name: 'coding-problem.jpg',
    html: `${STYLE}<div class="slide"><h1>Practice problem: Count Vowels</h1>
<p>Write a function <b>count_vowels(text)</b> that returns how many vowels (a, e, i, o, u, in either
case) a string has.</p><pre>count_vowels("Harbor")  # 2
count_vowels("sky")     # 0
count_vowels("AEIOU")   # 5</pre><p class="note">Easy · strings</p></div>`,
  },
  {
    name: 'code-error.jpg',
    html: `${STYLE}<div class="slide"><h1>report.py</h1><pre>
def average(values):
    return sum(values) / len(values)

print(average([]))</pre><pre style="background:#450a0a">Traceback (most recent call last):
  File "report.py", line 4, in &lt;module&gt;
ZeroDivisionError: division by zero</pre></div>`,
  },
  {
    name: 'chart-bars.jpg',
    html: `${STYLE}<div class="slide"><h1>Support tickets per week</h1>
<div style="display:flex;gap:48px;align-items:flex-end;height:330px;font-size:24px">
<div style="text-align:center">420<div style="background:#2563eb;width:110px;height:252px"></div>Week 1</div>
<div style="text-align:center">310<div style="background:#2563eb;width:110px;height:186px"></div>Week 2</div>
<div style="text-align:center">180<div style="background:#2563eb;width:110px;height:108px"></div>Week 3</div>
<div style="text-align:center">95<div style="background:#2563eb;width:110px;height:57px"></div>Week 4</div>
</div></div>`,
  },
  {
    name: 'document-terms.jpg',
    html: `${STYLE}<div class="slide"><h1>Service agreement, section 4</h1>
<p><b>4.1 Notice.</b> Either side may end this agreement with 60 days' written notice.</p>
<p><b>4.2 Refunds.</b> Fees paid in advance are refunded for any full months left after the notice ends.</p>
<p><b>4.3 Data.</b> Customer data is deleted within 30 days after the agreement ends.</p></div>`,
  },
  {
    name: 'web-page.jpg',
    html: `${STYLE}<div style="background:#e2e8f0;padding:10px 24px;font-size:20px">https://status.example/route-planning</div>
<div class="slide"><h1>Route planning service status</h1>
<p style="color:#b91c1c"><b>Partial outage:</b> route planning is delayed in the EU region.</p>
<p>Started 09:40 UTC. Live tracking and billing are not affected. Next update at 11:00 UTC.</p></div>`,
  },
  {
    name: 'unreadable.jpg',
    html: `${STYLE}<div class="slide" style="filter:blur(26px)"><h1>Quarterly numbers</h1>
<ul><li>First figure 1,284</li><li>Second figure 937</li><li>Third figure 2,410</li></ul></div>`,
  },
  // ADR-0107: the screen-only group (Ctrl+Shift+Enter answers the screen alone).
  {
    name: 'screen-coding-slots.jpg',
    html: `${STYLE}<div style="display:flex;height:720px;font-size:22px"><div style="width:52%;padding:32px">
<h1 style="font-size:34px">Merge Overlapping Meeting Slots</h1><p>Given a list of meeting slots, each
<code>[start, end]</code> in minutes, merge every pair of slots that overlap or touch and return the merged
slots sorted by start time.</p><pre style="font-size:20px">slots = [[30,60],[0,15],[10,20],[55,90]]
# returns [[0,20],[30,90]]
slots = [[1,4],[4,5]]
# returns [[1,5]]</pre></div><pre style="flex:1;margin:0;border-radius:0;font-size:20px">Python 3

def merge_slots(slots):
    # write your solution here
    pass</pre></div>`,
  },
  {
    name: 'screen-multiple-choice.jpg',
    html: `${STYLE}<div class="slide"><p class="note" style="margin:0">Skill check (invented) · Question 7 of 20</p>
<h1 style="font-size:36px">What does this code print?</h1><pre style="font-size:22px">console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve().then(() => console.log('C'));
console.log('D');</pre><div style="font-size:24px">○ A) A B C D &nbsp;&nbsp; ○ B) A D C B &nbsp;&nbsp; ○ C) A D B C &nbsp;&nbsp; ○ D) A C D B</div></div>`,
  },
  {
    name: 'screen-chat-question.jpg',
    html: `${STYLE}<div style="display:flex;height:720px;font-size:22px"><div style="width:230px;background:#3b1f3f;color:#e8dce9;padding:20px">
<b>Northwind Labs (invented)</b><p># general</p><p>● Dana Ortiz</p></div><div style="flex:1">
<div style="border-bottom:2px solid #e2e8f0;padding:18px 24px;font-weight:bold">Dana Ortiz</div>
<p style="padding:0 24px"><b>Dana Ortiz</b> 10:42<br>Thanks again for the chat yesterday.</p>
<p style="padding:0 24px"><b>Dana Ortiz</b> 10:43<br>Quick one before the panel: how would you stop one noisy customer from
overloading our public API? Just a few lines on the approach you'd take.</p></div></div>`,
  },
  {
    name: 'screen-before-after.jpg',
    html: `${STYLE}<div class="slide" style="padding:36px 56px"><h1 style="font-size:34px">Sessions screen: before 1.6.3 and after 1.6.4 (invented)</h1>
<div style="display:flex;gap:28px;font-size:20px"><div style="flex:1;border:2px solid #cbd5e1;padding:16px">
<b>BEFORE (1.6.3)</b><div style="display:flex;justify-content:space-between;background:#f1f5f9;padding:10px;margin:10px 0">
<span>Sessions</span><span><button>Buy credits</button> <button>New session</button></span></div><p>Call list · filters</p></div>
<div style="flex:1;border:2px solid #cbd5e1;padding:16px"><b>AFTER (1.6.4)</b>
<div style="display:flex;justify-content:space-between;background:#f1f5f9;padding:10px;margin:10px 0">
<span>Sessions</span><span><button>New session</button></span></div><p>Call list · filters</p></div></div>
<h2 style="font-size:28px">No Buy credits button in the header</h2>
<p style="font-size:22px">Credits moved to Settings → Billing in 1.6.4. Everything else in the header is unchanged.</p></div>`,
  },
  {
    name: 'screen-dashboard.jpg',
    html: `${STYLE}<div style="background:#f6f7f9;height:720px;font-size:20px"><div style="background:#fff;padding:14px 24px;border-bottom:2px solid #e2e8f0">
<b>SiteLens Web Analytics (invented)</b> · example-shop.test · last 7 days vs the 7 days before</div>
<div style="display:flex;gap:16px;padding:20px"><div style="flex:1;background:#fff;padding:14px">Visits<div style="font-size:34px"><b>48,210</b></div>up 12%</div>
<div style="flex:1;background:#fff;padding:14px">Page views<div style="font-size:34px"><b>131,904</b></div>up 8%</div>
<div style="flex:1;background:#fff;padding:14px">Load time<div style="font-size:34px"><b>4.8 s</b></div>up from 1.9 s</div>
<div style="flex:1;background:#fff;padding:14px">Checkout conversions<div style="font-size:34px"><b>1.1%</b></div>down from 2.6%</div></div>
<div style="margin:0 20px;background:#fff;padding:14px"><b>Slowest pages</b><br>/checkout 7.9 s · /pricing 3.1 s · / 1.4 s</div></div>`,
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
    // ADR-0107: --only=<prefix> draws only the images whose name starts with it (the others stay as committed).
    const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
    for (const image of IMAGES.filter((candidate) => !only || candidate.name.startsWith(only))) {
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
