/**
 * Smoke test for the Electron shell (apps/desktop/src/main.ts, preload.ts, security.ts).
 * Launches the built app (dist/), or the installed app when KITE_INSTALLED_EXE names its
 * Kite.exe (Day 6 Stage 3), with KITE_URL pointing at a local test page and checks:
 * the window opens at 1280×820; window.kiteDesktop is exactly { version, os,
 * setHotkeysEnabled, onHotkey, captureScreenshot } and frozen; captureScreenshot() returns a
 * PNG scaled to ≤ 1,568 px for the Kite page, and a frame from another origin has no bridge;
 * the compact window opens at /compact/[id] always on top and unfocused, unprotected by default
 * and protected once the user turns it on, refuses a
 * bad id and closes on request; on Windows, a real desktopCapturer screen capture leaves the
 * protected compact window out, and shows it once protection is off (Day 5); the hotkey path works: the page turns the global
 * shortcuts on and off, and a hotkey message sent from the main process reaches the page's
 * onHotkey handler (an invalid action never does);
 * the page has no Node.js (`require`, `process`); same-origin navigation works while
 * navigation to another origin is blocked; window.open never creates a window and only http(s)
 * links would reach the system browser; only the microphone permission is granted;
 * getDisplayMedia from the Kite page gets a system-audio track with no picker (Windows; macOS
 * needs the System Audio Recording permission and is checked by hand), and getDisplayMedia from
 * another origin (in a frame) is denied. UI U4: on Windows, the icon Windows shows for the Kite
 * window (title bar and taskbar) is the company logo mark (saved when KITE_SCREENSHOT_DIR is set).
 *
 * The app runs with KITE_TEST_NO_EXTERNAL_OPEN=1, so this test never launches a real browser.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  // KITE_INSTALLED_EXE (Day 6 Stage 3): test the installed app (Kite.exe from the installer)
  // instead of the development build, with the same checks.
  const installed = process.env.KITE_INSTALLED_EXE;
  app = await electron.launch({
    ...(installed ? { executablePath: installed, args: [] } : { args: [APP_DIR] }),
    env: {
      ...parentEnv,
      KITE_URL: `${kite.origin}/`,
      KITE_TEST_NO_EXTERNAL_OPEN: '1',
      // The installed app would otherwise check the releases repository for updates.
      KITE_NO_UPDATE_CHECK: '1',
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
  // 1920×1080 laptop at 150% scaling), so compare against the size that fits. A shrunk side may
  // come out a few pixels smaller (macOS on a 1024×768 runner: 674 for a 677 px work area).
  expect(sizes).toHaveLength(1);
  const [width = 0, height = 0] = sizes[0]!;
  /**
   * Checks one side: exactly the wanted size when it fits, else within 8 px of the space.
   *
   * @param wanted    The window's designed size.
   * @param available The work area's size.
   * @param actual    The window's size.
   */
  const fit = (wanted: number, available: number, actual: number) => {
    if (wanted <= available) {
      expect(actual).toBe(wanted);
    } else {
      expect(actual).toBeGreaterThanOrEqual(available - 8);
      expect(actual).toBeLessThanOrEqual(available);
    }
  };
  fit(1280, workArea.width, width);
  fit(820, workArea.height, height);
});

test('exposes window.kiteDesktop with exactly its bridge methods, frozen', async () => {
  const bridge = await page.evaluate(() => ({
    keys: Object.keys(window.kiteDesktop ?? {}).sort(),
    methods: [
      typeof window.kiteDesktop?.setHotkeysEnabled,
      typeof window.kiteDesktop?.onHotkey,
      typeof window.kiteDesktop?.captureScreenshot,
      typeof window.kiteDesktop?.openCompactView,
      typeof window.kiteDesktop?.closeCompactView,
      typeof window.kiteDesktop?.setShareProtection,
      typeof window.kiteDesktop?.getShareProtection,
      typeof window.kiteDesktop?.setCallActive,
    ],
    version: window.kiteDesktop?.version,
    os: window.kiteDesktop?.os,
    frozen: Object.isFrozen(window.kiteDesktop),
  }));
  const appVersion = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  const expectedOs = { darwin: 'mac', win32: 'windows' }[process.platform as string] ?? 'linux';

  expect(bridge.keys).toEqual([
    'captureScreenshot',
    'closeCompactView',
    'getShareProtection',
    'onHotkey',
    'openCompactView',
    'os',
    'setCallActive',
    'setHotkeysEnabled',
    'setShareProtection',
    'version',
  ]);
  expect(bridge.methods).toEqual(Array(8).fill('function'));
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

test('compact window: opens on top without focus at /compact/[id], and closes on request', async () => {
  // The default (nothing remembered yet on this test profile is not guaranteed, so set it).
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(false));
  const windowPromise = app.waitForEvent('window');
  await page.evaluate(() => window.kiteDesktop!.openCompactView!('smoke-session'));
  const compactPage = await windowPromise;
  await compactPage.waitForLoadState();
  expect(new URL(compactPage.url()).pathname).toBe('/compact/smoke-session');
  // Wait for it to be shown (showInactive after ready-to-show).
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.getTitle() === 'Kite compact (smoke)' && w.isVisible(),
        ),
      ),
    )
    .toBe(true);
  const state = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Kite compact (smoke)')!;
    return {
      onTop: w.isAlwaysOnTop(),
      focused: w.isFocused(),
      protected: w.isContentProtected(),
      skipTaskbar: false,
    };
  });
  expect(state).toMatchObject({ onTop: true, focused: false, protected: false });
  // The user turns protection on: applied to the open window at once.
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(true));
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((x) => x.getTitle() === 'Kite compact (smoke)')!
        .isContentProtected(),
    ),
  ).toBe(true);

  // A bad id is refused by the shell.
  expect(
    await page.evaluate(() =>
      window.kiteDesktop!.openCompactView!('../admin').then(
        () => 'opened',
        () => 'refused',
      ),
    ),
  ).toBe('refused');

  await page.evaluate(() => window.kiteDesktop!.closeCompactView!());
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1);
});

test('protection (Windows): the compact window is left out of a screen capture, and shows when off', async () => {
  test.skip(process.platform !== 'win32', 'Windows only; macOS is checked by hand (Day 6)');
  /**
   * Captures the primary screen in the main process and counts magenta pixels (the compact
   * fixture's colour) inside the compact window's area. Numbers only.
   *
   * @returns The window's on-screen size and how many of its pixels are magenta.
   */
  const magentaInWindow = () =>
    app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Kite compact (smoke)')!;
      const display = screen.getPrimaryDisplay();
      const scale = display.scaleFactor;
      const size = {
        width: Math.round(display.size.width * scale),
        height: Math.round(display.size.height * scale),
      };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find((x) => x.display_id === String(display.id)) ?? sources[0]!;
      const image = source.thumbnail;
      const actual = image.getSize();
      const bitmap = image.toBitmap(); // BGRA
      const b = w.getBounds();
      const fx = actual.width / display.size.width;
      const fy = actual.height / display.size.height;
      let magenta = 0;
      let total = 0;
      // Inner 60% of the window, to stay clear of any border or shadow.
      for (
        let y = Math.round((b.y + b.height * 0.2) * fy);
        y < (b.y + b.height * 0.8) * fy;
        y += 2
      ) {
        for (
          let x = Math.round((b.x + b.width * 0.2) * fx);
          x < (b.x + b.width * 0.8) * fx;
          x += 2
        ) {
          const i = (y * actual.width + x) * 4;
          total += 1;
          if (bitmap[i + 2]! > 230 && bitmap[i + 1]! < 40 && bitmap[i]! > 230) magenta += 1;
        }
      }
      return { total, magenta };
    });

  const windowPromise = app.waitForEvent('window');
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(true));
  await page.evaluate(() => window.kiteDesktop!.openCompactView!('smoke-protection'));
  const compactPage = await windowPromise;
  await compactPage.waitForLoadState();
  // Put it where the capture looks, fully on the primary screen.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Kite compact (smoke)')!;
    w.setBounds({ x: 120, y: 120, width: 360, height: 260 });
  });
  // The OS applies the change with the next desktop composition (Electron docs): wait a moment.
  await compactPage.waitForTimeout(800);
  const hidden = await magentaInWindow();

  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(false));
  await compactPage.waitForTimeout(800);
  const shown = await magentaInWindow();

  console.log('[smoke] protection', JSON.stringify({ hidden, shown }));
  // Protection on: none of the window's own colour in the capture. Off: almost all of it.
  expect(hidden.magenta).toBe(0);
  expect(shown.magenta / shown.total).toBeGreaterThan(0.9);

  // Back to the default (off) and closed.
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(false));
  await page.evaluate(() => window.kiteDesktop!.closeCompactView!());
});

test('window icon (Windows): the taskbar icon is the company logo mark (UI U4)', async () => {
  test.skip(process.platform !== 'win32', 'window icons are read through Windows');
  // The icon Windows itself shows for the Kite window (title bar and taskbar).
  const result = await app.evaluate(
    async ({ BrowserWindow, desktopCapturer, nativeImage }, iconFile) => {
      /**
       * Counts the mark's blue ribbon pixels: clearly more blue than red and green, and opaque.
       *
       * @param image An icon image.
       * @returns The number of blue mark pixels.
       */
      const bluePixels = (image: Electron.NativeImage) => {
        const bitmap = image.toBitmap(); // BGRA
        let blue = 0;
        for (let i = 0; i < bitmap.length; i += 4) {
          const [b, g, r, a] = [bitmap[i]!, bitmap[i + 1]!, bitmap[i + 2]!, bitmap[i + 3]!];
          if (a > 200 && b > r + 60 && b > g + 30) blue += 1;
        }
        return blue;
      };
      // The file the windows are given (src/icon.ts: apps/desktop/build/icon.png).
      const file = nativeImage.createFromPath(iconFile);
      const fileBlue = file.isEmpty() ? 0 : bluePixels(file);
      const main = BrowserWindow.getAllWindows().find((w) => w.getSize()[0] === 1280);
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        fetchWindowIcons: true,
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((s) => s.id === main?.getMediaSourceId());
      if (!source) return { fileBlue, listed: false as const, icon: null };
      if (!source.appIcon || source.appIcon.isEmpty())
        return { fileBlue, listed: true as const, icon: null };
      const { width, height } = source.appIcon.getSize();
      const icon = {
        width,
        height,
        blue: bluePixels(source.appIcon),
        png: source.appIcon.toPNG().toString('base64'),
      };
      return { fileBlue, listed: true as const, icon };
    },
    path.join(APP_DIR, 'build', 'icon.png'),
  );
  // Always: the icon file the windows use holds the company mark.
  expect(result.fileBlue, 'build/icon.png has no blue mark pixels').toBeGreaterThan(0);
  // GitHub's Windows runners have no interactive desktop, so Windows lists no window sources
  // there; the taskbar icon can only be read where Windows lists the Kite window.
  test.skip(!result.listed, 'Windows listed no window source for Kite (no interactive desktop)');
  const icon = result.icon;
  expect(icon, 'Windows listed the Kite window but returned no icon for it').not.toBeNull();
  expect(icon!.blue).toBeGreaterThan(0);
  const dir = process.env.KITE_SCREENSHOT_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'desktop-window-icon.png'), Buffer.from(icon!.png, 'base64'));
  }
  console.log(`[smoke] window icon ${icon!.width}×${icon!.height}, ${icon!.blue} blue pixels`);
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
