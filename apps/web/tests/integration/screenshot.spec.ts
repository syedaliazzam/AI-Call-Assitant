/**
 * Harness test for browser screenshots (day-05-overlay-screenshots-notes.md Stage 1), no
 * sign-in, runs in CI. Chromium (full, new headless) shares a fake "meeting" tab, picked by its
 * title, that shows a large invented slide and plays a tone (a share needs sound). The real
 * browser adapter then grabs a frame from the share's video track and core/screenshot/prepare.ts
 * encodes it. Checks: before sharing, captureScreenshot() reports 'no-share'; after sharing,
 * the frame is a PNG and the result is a JPEG (first bytes FF D8 FF) with its longest side at
 * most 1,568 px and at most 1 MB; a second screenshot of the same share works; after the user
 * stops sharing, 'no-share' again. Prints numbers only.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { build } from 'esbuild';
import type { ScreenshotHarnessResult } from './harness/screenshot';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Title of the fake tab; Chromium auto-selects it when the page asks to share a tab. */
const TAB_TITLE = 'Kite Screenshot Harness Tab';

/** The fake meeting tab: an invented slide (large, so the frame has real content) and a tone. */
const TAB_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>${TAB_TITLE}</title>
<style>body{margin:0;background:#1e3a8a;color:#fff;font:64px sans-serif}div{padding:80px}</style></head>
<body><div><h1>Q3 pilot results (invented)</h1><p>Late deliveries −33%</p><p>Planning 40 → 18 min</p></div>
<script>
  // A quiet tone so the share has an audio track (getOtherSideStream requires sound).
  const context = new AudioContext();
  const tone = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0.05;
  tone.connect(gain).connect(context.destination);
  tone.start();
</script></body></html>`;

let bundleDir = '';
let server: Server | null = null;
let origin = '';
let context: BrowserContext | null = null;

test.beforeAll(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-screenshot-test-'));
  await build({
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'screenshot.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outfile: path.join(bundleDir, 'screenshot.js'),
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    logLevel: 'error',
  });
  server = createServer((req, res) => {
    if (req.url === '/harness/screenshot.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(readFileSync(path.join(bundleDir, 'screenshot.js')));
    } else if (req.url === '/tab') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(TAB_HTML);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Kite screenshot harness</title></head>' +
          '<body><script type="module" src="/harness/screenshot.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  context = await chromium.launchPersistentContext('', {
    // Full Chromium in new headless mode: tab capture is not available in the headless shell.
    channel: 'chromium',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      `--auto-select-tab-capture-source-by-title=${TAB_TITLE}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

test('a frame from the shared tab becomes a JPEG ≤ 1,568 px and ≤ 1 MB', async () => {
  const tab = await context!.newPage();
  await tab.setViewportSize({ width: 1920, height: 1080 });
  await tab.goto(`${origin}/tab`);
  const page = await context!.newPage();
  await page.goto(origin);
  await page.getByRole('button', { name: 'Share' }).click();
  await expect
    .poll(() => page.evaluate(() => window.kiteScreenshotHarness.result), { timeout: 30_000 })
    .not.toBeNull();
  const result = (await page.evaluate(
    () => window.kiteScreenshotHarness.result,
  )) as ScreenshotHarnessResult;
  console.log('[harness] screenshot', JSON.stringify(result));
  expect(result.ok, result.code).toBe(true);
  expect(result.jpegStart).toEqual([0xff, 0xd8, 0xff]);
  expect(Math.max(result.width!, result.height!)).toBeLessThanOrEqual(1568);
  expect(result.jpegBytes!).toBeLessThanOrEqual(1_000_000);
  expect(result.pngBytes!).toBeGreaterThan(1_000);

  // A second screenshot of the same share (no new share).
  const second = (await page.evaluate(() =>
    window.kiteScreenshotHarness.again(),
  )) as ScreenshotHarnessResult;
  console.log('[harness] screenshot again', JSON.stringify({ ok: second.ok, ms: second.ms }));
  expect(second.ok).toBe(true);

  // The user stops sharing: nothing to capture any more.
  await page.evaluate(() => window.kiteScreenshotHarness.stop());
  const after = (await page.evaluate(() =>
    window.kiteScreenshotHarness.again(),
  )) as ScreenshotHarnessResult;
  expect(after.code).toBe('no-share');
});
