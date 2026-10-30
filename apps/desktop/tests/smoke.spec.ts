/**
 * Smoke test for the Electron shell (apps/desktop/src/main.ts, preload.ts, security.ts).
 * Launches the built app (dist/) with KITE_URL pointing at a local test page and checks:
 * the window opens at 1280×820; window.kiteDesktop is exactly { version, os,
 * setHotkeysEnabled, onHotkey, captureScreenshot } and frozen; captureScreenshot() returns a
 * PNG scaled to ≤ 1,568 px for the Kite page, and a frame from another origin has no bridge; the hotkey path works: the page turns the global
 * shortcuts on and off, and a hotkey message sent from the main process reaches the page's
 * onHotkey handler (an invalid action never does);
 * the page has no Node.js (`require`, `process`); same-origin navigation works while
 * navigation to another origin is blocked; window.open never creates a window and only http(s)
 * links would reach the system browser; only the microphone permission is granted;
 * getDisplayMedia from the Kite page gets a system-audio track with no picker (Windows; macOS
 * needs the System Audio Recording permission and is checked by hand), and getDisplayMedia from
 * another origin (in a frame) is denied.
 *
 * The app runs with KITE_TEST_NO_EXTERNAL_OPEN=1, so this test never launches a real browser.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/** apps/desktop (the Electron app folder: package.json "main" → dist/main.js). */
const APP_DIR = path.join(__dirname, '..');

/** The fixture page served as the "Kite web app". */
const FIXTURE_HTML = readFileSync(path.join(__dirname, 'fixtures', 'index.html'));

/** A running local test server. */
interface TestServer {
  /** The Node HTTP server. */
  server: Server;
  /** Its origin, for example 'http://127.0.0.1:53211'. */
  origin: string;
  /** How many requests it has received so far. */
  requests: number;
}

/**
 * Starts a local HTTP server that answers every path with the fixture page and counts requests.
 *
 * @returns The running server.
 */
async function startServer(): Promise<TestServer> {
  const result = { requests: 0 } as TestServer;
  result.server = createServer((_request, response) => {
    result.requests += 1;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => result.server.listen(0, '127.0.0.1', resolve));
  const { port } = result.server.address() as AddressInfo;
  result.origin = `http://127.0.0.1:${port}`;
  return result;
}

let kite: TestServer;
let other: TestServer;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  kite = await startServer();
  // A second server on another port = another origin, which the shell must refuse.
  other = await startServer();
  // ELECTRON_RUN_AS_NODE makes Electron behave as plain Node.js. Tools that are themselves
  // Electron apps (VS Code extensions, for example) set it for their child processes, so it
  // must not be passed on to the app under test.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  app = await electron.launch({
    args: [APP_DIR],
    env: {
      ...parentEnv,
      KITE_URL: `${kite.origin}/`,
      KITE_TEST_NO_EXTERNAL_OPEN: '1',
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  kite?.server.close();
  other?.server.close();
});

test('opens one 1280×820 window on KITE_URL', async () => {
  expect(page.url()).toBe(`${kite.origin}/`);
  await expect(page.locator('#heading')).toHaveText('Kite smoke test page');
  const { sizes, workArea } = await app.evaluate(({ BrowserWindow, screen }) => ({
    sizes: BrowserWindow.getAllWindows().map((window) => window.getSize()),
    workArea: screen.getPrimaryDisplay().workAreaSize,
  }));
  // Electron shrinks a window to fit the screen's work area (for example 1280×720 on a
  // 1920×1080 laptop at 150% scaling), so compare against the size that fits.
  expect(sizes).toEqual([[Math.min(1280, workArea.width), Math.min(820, workArea.height)]]);
});

test('exposes window.kiteDesktop as exactly { version, os, setHotkeysEnabled, onHotkey, captureScreenshot }, frozen', async () => {
  const bridge = await page.evaluate(() => ({
    keys: Object.keys(window.kiteDesktop ?? {}).sort(),
    methods: [
      typeof window.kiteDesktop?.setHotkeysEnabled,
      typeof window.kiteDesktop?.onHotkey,
      typeof window.kiteDesktop?.captureScreenshot,
    ],
    version: window.kiteDesktop?.version,
    os: window.kiteDesktop?.os,
    frozen: Object.isFrozen(window.kiteDesktop),
  }));
  const appVersion = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  const expectedOs = { darwin: 'mac', win32: 'windows' }[process.platform as string] ?? 'linux';

  expect(bridge.keys).toEqual([
    'captureScreenshot',
    'onHotkey',
    'os',
    'setHotkeysEnabled',
    'version',
  ]);
  expect(bridge.methods).toEqual(['function', 'function', 'function']);
  expect(bridge.version).toBe(appVersion);
  expect(bridge.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(bridge.os).toBe(expectedOs);
  expect(bridge.frozen).toBe(true);
});

test('hotkeys: the page turns them on and off, and a hotkey from the main process reaches it', async () => {
  const statuses = await page.evaluate(async () => {
    const seen: string[] = [];
    (window as unknown as { __hotkeys: string[] }).__hotkeys = seen;
    window.kiteDesktop!.onHotkey!((action) => seen.push(action));
    return window.kiteDesktop!.setHotkeysEnabled!(true);
  });
  expect(statuses.map((status) => status.action)).toEqual([
    'answer',
    'screenshot',
    'clear',
    'prev',
    'next',
  ]);
  /**
   * Whether the main process holds a shortcut now.
   *
   * @param accelerator The Electron accelerator.
   * @returns True when registered by this app.
   */
  const isRegistered = (accelerator: string) =>
    app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), accelerator);
  // A shortcut another app on this machine already holds is reported as not registered.
  const answer = statuses.find((status) => status.action === 'answer')!;
  expect(await isRegistered('CommandOrControl+Enter')).toBe(answer.registered);

  // What the shell does when a global shortcut is pressed (simulated from the main process).
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    contents.send('kite:hotkey', 'answer');
    contents.send('kite:hotkey', 'not-an-action');
    contents.send('kite:hotkey', 'next');
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __hotkeys: string[] }).__hotkeys))
    .toEqual(['answer', 'next']);

  await page.evaluate(() => window.kiteDesktop!.setHotkeysEnabled!(false));
  expect(await isRegistered('CommandOrControl+Enter')).toBe(false);
});

test('screenshot: the Kite page gets a scaled PNG; another origin has no bridge to ask', async () => {
  const shot = await page.evaluate(async () => {
    const result = await window.kiteDesktop!.captureScreenshot!();
    if (!result.ok) return { ok: false, code: result.code };
    const png = result.png;
    return {
      ok: true,
      // The PNG signature: 89 50 4E 47.
      signature: Array.from(png.slice(0, 4)),
      bytes: png.byteLength,
      width: result.width,
      height: result.height,
      ms: result.ms,
    };
  });
  // Numbers only (the image itself is never printed or saved).
  console.log('[smoke] screenshot', JSON.stringify({ ...shot, signature: undefined }));
  expect(shot.ok).toBe(true);
  expect(shot.signature).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(Math.max(shot.width!, shot.height!)).toBeLessThanOrEqual(1568);

  // A frame from another origin: the preload runs only in the Kite main frame, so there is no
  // bridge there to ask (and the shell would refuse the sender anyway: unit-tested).
  await page.evaluate((url) => {
    const frame = document.createElement('iframe');
    frame.id = 'other-shot';
    frame.src = url;
    document.body.append(frame);
  }, `${other.origin}/frame`);
  const frame = await expect
    .poll(() => page.frames().find((f) => f.url().startsWith(other.origin)))
    .toBeTruthy()
    .then(() => page.frames().find((f) => f.url().startsWith(other.origin))!);
  await frame.waitForSelector('#capture');
  expect(await frame.evaluate(() => typeof window.kiteDesktop)).toBe('undefined');
  await page.evaluate(() => document.getElementById('other-shot')?.remove());
});

test('gives the page no Node.js access', async () => {
  const globals = await page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    module: typeof (globalThis as { module?: unknown }).module,
  }));
  expect(globals).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' });
});

test('allows navigation on the Kite origin', async () => {
  await page.evaluate((url) => {
    window.location.href = url;
  }, `${kite.origin}/second-page`);
  await page.waitForURL(`${kite.origin}/second-page`);
  expect(page.url()).toBe(`${kite.origin}/second-page`);
});

test('blocks navigation to another origin', async () => {
  const before = page.url();
  const requestsBefore = other.requests;
  await page.evaluate((url) => {
    window.location.href = url;
  }, `${other.origin}/`);
  // Give a (wrongly) allowed navigation time to happen before checking.
  await page.waitForTimeout(1_000);

  // The other origin never even received a request, and the Kite page is still there.
  expect(other.requests).toBe(requestsBefore);
  // Read the page with evaluate(): Playwright's locators wait for the cancelled navigation
  // to "finish", which never happens because the shell cancelled it.
  const state = await page.evaluate(() => ({
    href: window.location.href,
    heading: document.querySelector('#heading')?.textContent,
  }));
  expect(state).toEqual({ href: before, heading: 'Kite smoke test page' });
});

test('window.open never opens a window; only http(s) would go to the system browser', async () => {
  await page.evaluate(() => {
    window.open('https://example.com/help', '_blank');
    window.open('file:///C:/Windows/System32/calc.exe', '_blank');
    window.open('ms-settings:privacy', '_blank');
  });
  await page.waitForTimeout(500);

  const windowCount = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
  );
  expect(windowCount).toBe(1);

  // Test mode records instead of calling shell.openExternal, so no real browser opens.
  const recorded = await app.evaluate(
    () => (globalThis as { __kiteExternalOpens?: string[] }).__kiteExternalOpens ?? [],
  );
  expect(recorded).toEqual(['https://example.com/help']);
});

test('grants the microphone and denies the camera and notifications', async () => {
  const states = await page.evaluate(async () => {
    const query = async (name: string) =>
      (await navigator.permissions.query({ name: name as PermissionName })).state;
    return {
      microphone: await query('microphone'),
      camera: await query('camera'),
      notifications: await query('notifications'),
    };
  });
  expect(states).toEqual({ microphone: 'granted', camera: 'denied', notifications: 'denied' });
});

/**
 * Clicks "Capture" in a page or frame of the test page and waits for its result.
 *
 * @param target The page, or a frame inside it (to test a cross-origin frame).
 * @returns What the test page stored in window.__capture: the tracks it got, or the error.
 */
async function capture(target: Page | import('@playwright/test').Frame) {
  await target.evaluate(() => {
    (window as { __capture?: unknown }).__capture = null;
  });
  await target.click('#capture');
  await target.waitForFunction(() => (window as { __capture?: unknown }).__capture !== null, null, {
    timeout: 15_000,
  });
  return target.evaluate(() => (window as { __capture?: unknown }).__capture);
}

test('getDisplayMedia from the Kite page gets system audio with no picker', async () => {
  // macOS: Apple's System Audio Recording permission (and the packaged app's Info.plist key)
  // decide this; it is checked by hand, not on CI runners (see apps/desktop/src/media.ts).
  test.skip(process.platform === 'darwin', 'macOS loopback is verified by hand');
  await page.goto(`${kite.origin}/`);
  const result = await capture(page);
  // One audio track that is still live after the video track was stopped, and no picker
  // (the click resolved on its own; a picker would have left __capture null until timeout).
  expect(result).toEqual({ audioTracks: 1, videoTracks: 1, audioState: 'live' });
});

test('denies getDisplayMedia to another origin, even inside the Kite page', async () => {
  await page.goto(`${kite.origin}/`);
  await page.evaluate((src) => {
    const frame = document.createElement('iframe');
    frame.src = src;
    // Let the frame ask at all; the shell must still say no.
    frame.allow = 'display-capture';
    document.body.append(frame);
  }, `${other.origin}/framed`);
  const frame = await expect
    .poll(() => page.frames().find((f) => f.url().startsWith(other.origin)) ?? null)
    .not.toBeNull()
    .then(() => page.frames().find((f) => f.url().startsWith(other.origin))!);
  await frame.waitForSelector('#capture');
  const result = (await capture(frame)) as { error?: string };
  expect(result.error).toMatch(/^(AbortError|NotAllowedError)$/);
});
