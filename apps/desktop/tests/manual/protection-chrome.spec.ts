/**
 * Manual check (Day 5 Stage 3): screen-share protection seen through Google Chrome's own
 * screen sharing, the path Google Meet uses in Chrome. The Kite shell (built from this branch)
 * opens its compact window, which on the local test page is pure magenta. The installed Google
 * Chrome (channel 'chrome', a visible window) then shares the entire screen with
 * getDisplayMedia, picked automatically by its flags with no picker shown. The test draws a frame of that
 * share and counts magenta pixels where the compact window is: none with protection on, almost
 * all with it off. Windows only; needs a real desktop and Google Chrome installed, so it is
 * never run in CI. Prints numbers only. The meeting itself (a real call in Meet, Teams or Zoom
 * with someone on the other side) remains a human check.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import {
  _electron as electron,
  chromium,
  expect,
  test,
  type Browser,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/** apps/desktop. */
const APP_DIR = path.join(__dirname, '..', '..');

/** The smoke test's fixture page (magenta at /compact/...). */
const FIXTURE_HTML = readFileSync(path.join(__dirname, '..', 'fixtures', 'index.html'));

/** Where the compact window is placed (DIPs on the primary screen). */
const WINDOW = { x: 160, y: 160, width: 360, height: 260 };

/**
 * Where the window created later is placed (v1.3.0, ADR-0055): clear of the compact window, which is at
 * least 560 wide (its minimum) and is left unprotected by the first test.
 */
const LATER = { x: 820, y: 160, width: 360, height: 260 };

/** The shell's temporary profile (never the developer's own). */
let profile = '';

let server: Server;
let origin = '';
let app: ElectronApplication;
let browser: Browser;
let viewer: Page;

test.beforeAll(async () => {
  test.skip(process.platform !== 'win32', 'Windows only');
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  profile = mkdtempSync(path.join(tmpdir(), 'kite-protection-'));
  app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${profile}`],
    env: { ...parentEnv, KITE_URL: `${origin}/`, KITE_TEST_NO_EXTERNAL_OPEN: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState();
  const opened = app.waitForEvent('window');
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(true));
  await page.evaluate(() => window.kiteDesktop!.openCompactView!('manual-protection'));
  await (await opened).waitForLoadState();
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Kite compact (smoke)')!;
    w.setBounds(bounds);
  }, WINDOW);

  // Google Chrome as installed on this computer, sharing the entire screen without a picker.
  browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--auto-select-desktop-capture-source=Entire screen', '--use-fake-ui-for-media-stream'],
  });
  viewer = await browser.newPage({ viewport: { width: 400, height: 300 } });
  // Off to the side, so Chrome's own window does not cover the compact window.
  await viewer.goto(`${origin}/viewer`);
  await viewer.evaluate(async () => {
    // Full size, as a meeting app would ask for (the default follows the small viewer window).
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    (window as unknown as { __share: HTMLVideoElement }).__share = video;
  });
});

test.afterAll(async () => {
  await browser?.close();
  await app?.close();
  server?.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

/**
 * Draws the current frame of Chrome's screen share and counts magenta pixels inside the compact
 * window's area (scaled from DIPs to the shared frame's pixels).
 *
 * @param scale  The primary display's DIP → frame scale (frame width ÷ display width).
 * @param bounds The window's area (DIPs; default the compact window's).
 * @returns How many sampled pixels there were and how many were magenta.
 */
async function magentaInShare(scale: number, bounds = WINDOW) {
  return viewer.evaluate(
    ({ bounds, scale: s }) => {
      const video = (window as unknown as { __share: HTMLVideoElement }).__share;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(video, 0, 0);
      const x0 = Math.round((bounds.x + bounds.width * 0.2) * s);
      const y0 = Math.round((bounds.y + bounds.height * 0.2) * s);
      const w = Math.round(bounds.width * 0.6 * s);
      const h = Math.round(bounds.height * 0.6 * s);
      const pixels = context.getImageData(x0, y0, w, h).data;
      let magenta = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! > 230 && pixels[i + 1]! < 40 && pixels[i + 2]! > 230) magenta += 1;
      }
      return { total: pixels.length / 4, magenta, frame: [video.videoWidth, video.videoHeight] };
    },
    { bounds, scale },
  );
}

test('Google Chrome screen share leaves the protected compact window out', async () => {
  const chromeVersion = browser.version();
  const display = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().size.width);
  const frameWidth = await viewer.evaluate(
    () => (window as unknown as { __share: HTMLVideoElement }).__share.videoWidth,
  );
  const scale = frameWidth / display;

  // Protection on (the default): the share must not show the window.
  await viewer.waitForTimeout(1_000);
  const hidden = await magentaInShare(scale);

  // Off: now the share must show it.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Kite compact (smoke)')!;
    w.setContentProtection(false);
  });
  await viewer.waitForTimeout(1_000);
  const shown = await magentaInShare(scale);

  console.log('[manual] chrome share', JSON.stringify({ chromeVersion, hidden, shown }));
  expect(hidden.magenta).toBe(0);
  expect(shown.magenta / shown.total).toBeGreaterThan(0.9);
});

test('a window created after Private was turned on is left out too (v1.3.0, ADR-0055)', async () => {
  const display = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().size.width);
  const frameWidth = await viewer.evaluate(
    () => (window as unknown as { __share: HTMLVideoElement }).__share.videoWidth,
  );
  const scale = frameWidth / display;
  // A plain new window, made the way any future code would make one: nothing protects it by hand.
  await app.evaluate(
    async ({ BrowserWindow }, { bounds, url }) => {
      const later = new BrowserWindow({ ...bounds, frame: false, show: true });
      later.setAlwaysOnTop(true, 'floating');
      await later.loadURL(url);
      (globalThis as unknown as { later: Electron.BrowserWindow }).later = later;
    },
    { bounds: LATER, url: `${origin}/compact/later` },
  );
  await viewer.waitForTimeout(1_200);
  const hidden = await magentaInShare(scale, LATER);
  // The control: with its protection off, the same window shows.
  await app.evaluate(() =>
    (globalThis as unknown as { later: Electron.BrowserWindow }).later.setContentProtection(false),
  );
  await viewer.waitForTimeout(1_000);
  const shown = await magentaInShare(scale, LATER);
  console.log('[manual] window created later', JSON.stringify({ hidden, shown }));
  expect(hidden.magenta).toBe(0);
  expect(shown.magenta / shown.total).toBeGreaterThan(0.9);
});
