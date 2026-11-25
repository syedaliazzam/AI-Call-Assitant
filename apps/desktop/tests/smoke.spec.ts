/**
 * Smoke test for the Electron shell (apps/desktop/src/main.ts, preload.ts, security.ts).
 * Launches the built app (dist/), or the installed app when KITE_INSTALLED_EXE names its
 * Paramount AI.exe (Day 6 Stage 3), always on a temporary profile, with KITE_URL pointing at a local test
 * page and checks: the home panel opens at 400×560 on /home and keeps to its own pages (v1.1.0);
 * it opens the main window at 1280×820; a web app with no /home opens the main window instead;
 * Private covers every window type, by a real screen capture on Windows (ADR-0042); the overlay is
 * see-through; window.kiteDesktop is exactly its methods and frozen; captureScreenshot() returns a
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
import { GLOBAL_HOTKEYS } from '@kite/shared';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
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
  /** True to answer /home with 404, as a web app before 1.1.0 does. */
  noHome: boolean;
}

/**
 * Starts a local HTTP server that answers every path with the fixture page and counts requests.
 *
 * @returns The running server.
 */
async function startServer(): Promise<TestServer> {
  const result = { requests: 0, noHome: false } as TestServer;
  result.server = createServer((request, response) => {
    result.requests += 1;
    if (result.noHome && request.url?.startsWith('/home')) {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Not found</title>');
      return;
    }
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
/** The window the tests talk through: the panel first, then the main window. */
let page: Page;

/**
 * Starts the app on its own temporary profile. On the default profile this test overwrites the
 * person's real overlay settings (it did, on 4 Nov 2026), and a running Kite would hold the
 * single-instance lock.
 *
 * @param origin The Kite URL's origin.
 * @returns The running app.
 */
function launch(origin: string): Promise<ElectronApplication> {
  // ELECTRON_RUN_AS_NODE makes Electron behave as plain Node.js. Tools that are themselves
  // Electron apps (VS Code extensions, for example) set it for their child processes, so it
  // must not be passed on to the app under test.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  // KITE_INSTALLED_EXE (Day 6 Stage 3): test the installed app (Paramount AI.exe from the installer)
  // instead of the development build, with the same checks.
  const installed = process.env.KITE_INSTALLED_EXE;
  const profile = `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'kite-smoke-'))}`;
  return electron.launch({
    ...(installed ? { executablePath: installed, args: [profile] } : { args: [APP_DIR, profile] }),
    env: {
      ...parentEnv,
      KITE_URL: `${origin}/`,
      KITE_TEST_NO_EXTERNAL_OPEN: '1',
      // The installed app would otherwise check the releases repository for updates.
      KITE_NO_UPDATE_CHECK: '1',
    },
  });
}

/**
 * How many windows the app has.
 *
 * @returns The count.
 */
const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

test.beforeAll(async () => {
  kite = await startServer();
  // A second server on another port = another origin, which the shell must refuse.
  other = await startServer();
  app = await launch(kite.origin);
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  kite?.server.close();
  other?.server.close();
});

test('opens the home panel at 400×560 on /home, the only window (v1.1.0, ADR-0041)', async () => {
  expect(page.url()).toBe(`${kite.origin}/home`);
  await expect(page.locator('#heading')).toHaveText('Kite smoke test page');
  // Shown once painted, which an installed app takes a moment longer to do.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false),
    )
    .toBe(true);
  const { sizes, workArea } = await app.evaluate(({ BrowserWindow, screen }) => ({
    sizes: BrowserWindow.getAllWindows().map((window) => window.getSize()),
    workArea: screen.getPrimaryDisplay().workAreaSize,
  }));
  expect(sizes).toHaveLength(1);
  const [width = 0, height = 0] = sizes[0]!;
  // Display scaling can round a frameless window up by a few pixels (403 at 125%).
  expect(Math.abs(width - Math.min(400, workArea.width))).toBeLessThanOrEqual(4);
  expect(Math.abs(height - Math.min(560, workArea.height))).toBeLessThanOrEqual(4);
});

test('the panel keeps to its own pages: anywhere else goes back to /home', async () => {
  await page.evaluate((url) => {
    window.location.href = url;
  }, `${kite.origin}/login`);
  await page.waitForURL(`${kite.origin}/login`);
  await page.evaluate((url) => {
    window.location.href = url;
  }, `${kite.origin}/settings`);
  await page.waitForURL(`${kite.origin}/home`);
});

test('the panel opens a page in the main window at 1280×820, and stays open', async () => {
  const opened = app.waitForEvent('window');
  await page.evaluate(() => window.kiteDesktop!.openPagesWindow!('/'));
  // From here on the tests talk through the main window, as the web app's pages do.
  page = await opened;
  await page.waitForLoadState('domcontentloaded');
  expect(page.url()).toBe(`${kite.origin}/`);
  await expect.poll(windowCount).toBe(2);
  const { sizes, workArea } = await app.evaluate(({ BrowserWindow, screen }) => ({
    sizes: BrowserWindow.getAllWindows().map((window) => window.getSize()),
    workArea: screen.getPrimaryDisplay().workAreaSize,
  }));
  const main = sizes.find(([width = 0]) => width > 500)!;
  // Electron shrinks a window to fit the screen's work area (for example 1280×720 on a
  // 1920×1080 laptop at 150% scaling), so compare against the size that fits. A shrunk side may
  // come out a few pixels smaller (macOS on a 1024×768 runner: 674 for a 677 px work area).
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
  fit(1280, workArea.width, main[0]!);
  fit(820, workArea.height, main[1]!);
  // A path that is not a plain Kite page is refused.
  expect(
    await page.evaluate(() =>
      window.kiteDesktop!.openPagesWindow!('https://evil.example/').then(
        () => 'opened',
        () => 'refused',
      ),
    ),
  ).toBe('refused');
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
      typeof window.kiteDesktop?.checkHotkeys,
      typeof window.kiteDesktop?.setOverlayOpacity,
      typeof window.kiteDesktop?.setOverlayCollapsed,
      typeof window.kiteDesktop?.minimizeMainWindow,
      // v1.0.2 (ADR-0035): overlay presets, resizing and modes.
      typeof window.kiteDesktop?.placeOverlay,
      typeof window.kiteDesktop?.getOverlayPreset,
      typeof window.kiteDesktop?.resizeOverlay,
      typeof window.kiteDesktop?.setOverlayMode,
      // v1.0.4 (ADR-0040): the full call window.
      typeof window.kiteDesktop?.showCallWindow,
      // v1.1.0 (ADR-0041): the home panel, the stacked overlay and its snap zones.
      typeof window.kiteDesktop?.openPagesWindow,
      typeof window.kiteDesktop?.windowControl,
      typeof window.kiteDesktop?.setOverlayLayout,
      typeof window.kiteDesktop?.onSnapZone,
      // v1.3.0 (ADR-0052): the link's one-time sign-in code.
      typeof window.kiteDesktop?.consumeLinkCode,
      // v1.2.0 (spec S13, S14): the icon and the chat bar's shortcut.
      typeof window.kiteDesktop?.moveOverlay,
      typeof window.kiteDesktop?.setChatHotkey,
      // v1.3.0 (ADR-0055): the Connect card's call window, the panel's size, click-through.
      typeof window.kiteDesktop?.openCallWindow,
      typeof window.kiteDesktop?.sizePanel,
      typeof window.kiteDesktop?.setOverlayClickThrough,
      // v1.3.0 (ADR-0056): the six positions.
      typeof window.kiteDesktop?.getOverlayPosition,
      typeof window.kiteDesktop?.setOverlayPosition,
      typeof window.kiteDesktop?.onOverlayPosition,
      // 1.5.0 (ADR-0068): meeting recording, the player, displays and this computer's name.
      typeof window.kiteDesktop?.recordingOpen,
      typeof window.kiteDesktop?.recordingWrite,
      typeof window.kiteDesktop?.recordingClose,
      typeof window.kiteDesktop?.recordingList,
      typeof window.kiteDesktop?.recordingPlay,
      typeof window.kiteDesktop?.recordingSaveAs,
      typeof window.kiteDesktop?.recordingShowInFolder,
      typeof window.kiteDesktop?.recordingDelete,
      typeof window.kiteDesktop?.listDisplays,
      typeof window.kiteDesktop?.setRecordingDisplay,
      typeof window.kiteDesktop?.deviceIdentity,
      typeof window.kiteDesktop?.renameDevice,
      // 1.6.4 (ADR-0082): Escape while a voice question listens.
      typeof window.kiteDesktop?.setVoiceCancelHotkey,
    ],
    version: window.kiteDesktop?.version,
    os: window.kiteDesktop?.os,
    frozen: Object.isFrozen(window.kiteDesktop),
  }));
  const appVersion = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  const expectedOs = { darwin: 'mac', win32: 'windows' }[process.platform as string] ?? 'linux';

  expect(bridge.keys).toEqual([
    // v1.0.1 (ADR-0034): accurate transcription.
    'accurateDownload',
    'accurateRemove',
    'accurateStatus',
    'accurateTranscribe',
    'captureScreenshot',
    'checkHotkeys',
    'closeCompactView',
    // v1.3.0 (ADR-0052): the link's one-time sign-in code, given once.
    'consumeLinkCode',
    // 1.5.0 (ADR-0068): meeting recording, the player, displays and this computer's name.
    'deviceIdentity',
    // 1.6.2 (ADR-0074): a recording file's size (and uploads without a token).
    'driveFileSize',
    // 1.6.0 (ADR-0072): Google Drive uploads of recordings.
    'driveUpload',
    // v1.3.0 (ADR-0056): the six positions.
    'getOverlayPosition',
    'getOverlayPreset',
    'getShareProtection',
    'listDisplays',
    // 1.8.0 (ADR-0111): the macOS permissions.
    'macPermissions',
    'minimizeMainWindow',
    // v1.2.0 (spec S13): dragging the icon.
    'moveOverlay',
    // 1.6.0 (ADR-0072): the progress of this page's Drive uploads.
    'onDriveUploadProgress',
    'onHotkey',
    'onOverlayPosition',
    'onSnapZone',
    // v1.3.0 (ADR-0055): the Connect card's call window.
    'openCallWindow',
    'openCompactView',
    'openMacPrivacySettings',
    'openPagesWindow',
    'os',
    'placeOverlay',
    'recordingClose',
    'recordingDelete',
    'recordingList',
    'recordingOpen',
    'recordingPlay',
    'recordingSaveAs',
    'recordingShowInFolder',
    'recordingWrite',
    'relaunchApp',
    // v1.3.2 (ADR-0061): the keyboard back to the app behind the overlay.
    'releaseOverlayFocus',
    'renameDevice',
    // 1.7.2 (ADR-0106): the Drive queue report, for the background upload on exit.
    'reportDriveQueue',
    'requestMacPermission',
    'resizeOverlay',
    'setCallActive',
    // v1.2.0 (spec S14): the chat bar's shortcut.
    'setChatHotkey',
    'setHotkeysEnabled',
    // v1.3.0 (ADR-0055): click-through over the overlay's gaps.
    'setOverlayClickThrough',
    'setOverlayCollapsed',
    'setOverlayLayout',
    'setOverlayMode',
    'setOverlayOpacity',
    'setOverlayPosition',
    'setRecordingDisplay',
    'setShareProtection',
    // 1.6.4 (ADR-0082): Escape while a voice question listens.
    'setVoiceCancelHotkey',
    'showCallWindow',
    // 1.6.0 (ADR-0072): the native "saved to Google Drive" notification.
    'showNotice',
    // v1.3.0 (ADR-0055): the launcher's window size.
    'sizePanel',
    'version',
    'windowControl',
  ]);
  expect(bridge.methods).toEqual(Array(43).fill('function'));
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
  expect(statuses.map((status) => status.action)).toEqual(GLOBAL_HOTKEYS);
  // 1.6.4 (ADR-0082, the developer's choice for ParakeetAI parity): Clear answers, Clear transcript and
  // previous / next are held during a call too (until 1.6.3 they never were); Escape never is.
  expect(statuses.map((status) => status.accelerator)).toEqual(
    expect.arrayContaining([
      'CommandOrControl+Backspace',
      'CommandOrControl+Shift+Backspace',
      'CommandOrControl+Left',
      'CommandOrControl+Right',
    ]),
  );
  expect(statuses.map((status) => status.accelerator)).not.toContain('Escape');
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
    const contents = BrowserWindow.getAllWindows().find((w) => w.getSize()[0]! > 500)!.webContents;
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
  // 1.6.5 (ADR-0085): opening the overlay turns Private on first, even after it was left off, so the
  // overlay is never shown unprotected.
  expect(state).toMatchObject({ onTop: true, focused: false, protected: true });
  expect((await page.evaluate(() => window.kiteDesktop!.getShareProtection!())).on).toBe(true);
  /**
   * Whether the overlay is protected now.
   *
   * @returns The shell's answer.
   */
  const overlayProtected = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((x) => x.getTitle() === 'Kite compact (smoke)')!
        .isContentProtected(),
    );
  // The user can still turn it off for the call, and on again: applied to the open window at once.
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(false));
  expect(await overlayProtected()).toBe(false);
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(true));
  expect(await overlayProtected()).toBe(true);

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
  await expect.poll(windowCount).toBe(2);
});

test('Private covers every window: panel, main, overlay and side window, each by a capture (ADR-0042)', async () => {
  const state = await page.evaluate(() => window.kiteDesktop!.setShareProtection!(false));
  expect(state.scope).toBe('all');
  // Each one painted in its own colour, in its own place on the primary screen.
  await page.evaluate(() => window.kiteDesktop!.openCompactView!('smoke-all'));
  await expect.poll(windowCount).toBe(3);
  // A call is on: the panel steps aside, and a page opens in the side window, not the main one.
  await page.evaluate(() => window.kiteDesktop!.setCallActive!(true));
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.getSize()[0]! < 500)
            ?.isVisible() ?? null,
      ),
    )
    .toBe(false);
  const sideOpened = app.waitForEvent('window');
  await page.evaluate(() => window.kiteDesktop!.openPagesWindow!('/settings'));
  const side = await sideOpened;
  await side.waitForLoadState();
  await expect.poll(windowCount).toBe(4);
  expect(page.url()).toBe(`${kite.origin}/`);

  /**
   * Whether each window is protected, by what the shell says.
   *
   * @returns The windows' states.
   */
  const shielded = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.isContentProtected()),
    );
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(true));
  await expect.poll(shielded).toEqual([true, true, true, true]);

  if (process.platform === 'win32') {
    /**
     * Captures the primary screen and counts, in each window's area, the pixels of a colour painted
     * into it. The panel and the main window sit side by side, the overlay above. Numbers only: the
     * image is never kept or printed.
     *
     * @returns The share of each window's area in its colour.
     */
    const painted = () =>
      app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }) => {
        const display = screen.getPrimaryDisplay();
        const scale = display.scaleFactor;
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: Math.round(display.size.width * scale),
            height: Math.round(display.size.height * scale),
          },
        });
        const source = sources.find((x) => x.display_id === String(display.id)) ?? sources[0]!;
        const image = source.thumbnail;
        const actual = image.getSize();
        const bitmap = image.toBitmap(); // BGRA
        const fx = actual.width / display.size.width;
        const fy = actual.height / display.size.height;
        const shares: Record<string, number> = {};
        for (const window of BrowserWindow.getAllWindows()) {
          const b = window.getBounds();
          let magenta = 0;
          let total = 0;
          for (
            let y = Math.round((b.y + b.height * 0.3) * fy);
            y < (b.y + b.height * 0.7) * fy;
            y += 2
          ) {
            for (
              let x = Math.round((b.x + b.width * 0.3) * fx);
              x < (b.x + b.width * 0.7) * fx;
              x += 2
            ) {
              const i = (y * actual.width + x) * 4;
              total += 1;
              if (bitmap[i + 2]! > 230 && bitmap[i + 1]! < 40 && bitmap[i]! > 230) magenta += 1;
            }
          }
          shares[String(b.width)] = total === 0 ? 0 : magenta / total;
        }
        return shares;
      });
    const restore = await app.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const before = windows.map((window) => ({
        id: window.id,
        bounds: window.getBounds(),
        onTop: window.isAlwaysOnTop(),
      }));
      const place = [
        { x: 20, y: 20, width: 300, height: 200 },
        { x: 340, y: 20, width: 320, height: 200 },
        { x: 680, y: 20, width: 340, height: 200 },
        { x: 20, y: 240, width: 360, height: 200 },
      ];
      await Promise.all(
        windows.map(async (window, index) => {
          window.setMinimumSize(100, 100);
          if (window.isMinimized()) window.restore();
          window.showInactive();
          window.setBounds(place[index]!);
          // In front of whatever else is open on the machine: otherwise a covered window reads as
          // hidden, and "shown" fails because of the developer's editor, not the app.
          window.setAlwaysOnTop(true, 'screen-saver');
          await window.webContents.executeJavaScript(
            "document.documentElement.style.background = '#ff00ff'; document.body.style.background = '#ff00ff'; document.body.innerHTML = '';",
          );
        }),
      );
      return before;
    });
    await page.waitForTimeout(800);
    const hidden = await painted();
    await page.evaluate(() => window.kiteDesktop!.setShareProtection!(false));
    await page.waitForTimeout(800);
    const shown = await painted();
    console.log('[smoke] protection on every window', JSON.stringify({ hidden, shown }));
    for (const share of Object.values(hidden)) expect(share).toBe(0);
    for (const share of Object.values(shown)) expect(share).toBeGreaterThan(0.9);
    await app.evaluate(({ BrowserWindow }, list) => {
      for (const { id, bounds, onTop } of list) {
        const window = BrowserWindow.fromId(id);
        window?.setAlwaysOnTop(onTop, 'floating');
        window?.setBounds(bounds);
      }
    }, restore);
  }
  await page.evaluate(() => window.kiteDesktop!.setShareProtection!(false));
  await page.evaluate(() => window.kiteDesktop!.setCallActive!(false));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/settings'))
      ?.close();
  });
  await page.evaluate(() => window.kiteDesktop!.closeCompactView!());
  await expect.poll(windowCount).toBe(2);
  // Back to the tests' starting point: the painted pages are loaded again.
  await page.goto(`${kite.origin}/`);
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.reload();
  });
  await page.waitForLoadState('domcontentloaded');
});

test('a web app with no /home (rolled back) opens the main window instead (ADR-0041)', async () => {
  const old = await startServer();
  old.noHome = true;
  const rolledBack = await launch(old.origin);
  try {
    await expect
      .poll(() =>
        rolledBack.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((window) => window.webContents.getURL()),
        ),
      )
      .toEqual([`${old.origin}/`]);
  } finally {
    await rolledBack.close();
    old.server.close();
  }
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

test('overlay: opacity, collapse, minimises the main window and brings it back (ADR-0029)', async () => {
  await page.evaluate(() => window.kiteDesktop!.openCompactView!('smoke-overlay'));
  await expect.poll(windowCount).toBe(3);
  // See-through (ADR-0033): the window's own background is clear (Electron reports its colour without
  // the alpha, as black; a solid window is white or the theme's).
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.isAlwaysOnTop())!
        .getBackgroundColor(),
    ),
  ).toMatch(/^#0{6}(?:0{2})?$/);
  /**
   * Reads the real overlay and main windows.
   *
   * @returns Their state.
   */
  const read = () =>
    app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const overlay = windows.find((w) => w.getTitle().includes('overlay') || w.isAlwaysOnTop());
      // The panel is the other one; it is 400 wide.
      const main = windows.find((w) => w !== overlay && w.getSize()[0]! > 500);
      return {
        opacity: overlay?.getOpacity(),
        height: overlay?.getBounds().height,
        minimized: main?.isMinimized(),
        count: windows.length,
      };
    });
  await page.evaluate(() => window.kiteDesktop!.setOverlayOpacity!(0.6));
  expect((await read()).opacity).toBeCloseTo(0.6, 1);
  // Kept readable whatever the page asks for.
  await page.evaluate(() => window.kiteDesktop!.setOverlayOpacity!(0));
  expect((await read()).opacity).toBeGreaterThanOrEqual(0.3);
  await page.evaluate(() => window.kiteDesktop!.setOverlayOpacity!(1));

  const open = (await read()).height ?? 0;
  await page.evaluate(() => window.kiteDesktop!.setOverlayCollapsed!(true));
  await expect.poll(async () => (await read()).height).toBeLessThan(open);
  await page.evaluate(() => window.kiteDesktop!.setOverlayCollapsed!(false));
  await expect.poll(async () => (await read()).height).toBe(open);

  // v1.2.0 (spec S13): the icon really is 48 px on this system, moves, and comes back.
  /**
   * The overlay's bounds.
   *
   * @returns Its bounds.
   */
  const overlayBounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.isAlwaysOnTop())!
        .getBounds(),
    );
  const before = await overlayBounds();
  await page.evaluate(() => window.kiteDesktop!.setOverlayMode!('icon'));
  await expect.poll(async () => (await overlayBounds()).width).toBe(48);
  expect((await overlayBounds()).height).toBe(48);
  const icon = await overlayBounds();
  await page.evaluate(() => window.kiteDesktop!.moveOverlay!(30, 40));
  await expect
    .poll(overlayBounds)
    .toEqual({ x: icon.x + 30, y: icon.y + 40, width: 48, height: 48 });
  await page.evaluate(() => window.kiteDesktop!.setOverlayMode!('full'));
  await expect.poll(async () => (await overlayBounds()).width).toBe(before.width);
  expect((await overlayBounds()).height).toBe(before.height);
  // A bad move is refused by the shell.
  await expect(
    page.evaluate(() => window.kiteDesktop!.moveOverlay!(Number.NaN, 0)),
  ).rejects.toThrow();

  // v1.2.0 (spec S15) widened it with both panels open; 1.6.4 (ADR-0082): by default it kept its width; 1.6.5
  // (ADR-0085): the panels never change it, and it is in the same place after.
  const place = await overlayBounds();
  await page.evaluate(() =>
    window.kiteDesktop!.setOverlayLayout!({ transcript: true, answer: true, popupHeight: 0 }),
  );
  // setOverlayLayout is an invoke: the shell has applied the layout when it answers.
  expect((await overlayBounds()).width).toBe(place.width);
  await page.evaluate(() =>
    window.kiteDesktop!.setOverlayLayout!({ transcript: false, answer: false, popupHeight: 0 }),
  );
  await expect.poll(async () => (await overlayBounds()).width).toBe(place.width);
  expect((await overlayBounds()).x).toBe(place.x);

  // Conflicts can be checked with no call on, and nothing stays registered. The screenshot and voice
  // question's shortcut (Ctrl+Alt+Enter; 1.6.4, ADR-0082: one of the call's) is among them, so Settings can
  // report a clash.
  const statuses = await page.evaluate(() => window.kiteDesktop!.checkHotkeys!());
  expect(statuses.length).toBeGreaterThan(5);
  expect(statuses.map((status) => status.action)).toContain('screenshot-send');
  // Only during a call: asking outside one takes nothing from other apps.
  await page.evaluate(() => window.kiteDesktop!.setChatHotkey!(true));

  // A call starting in the overlay minimises the main window; closing the overlay restores it.
  await page.evaluate(() => window.kiteDesktop!.minimizeMainWindow!());
  await expect.poll(async () => (await read()).minimized).toBe(true);
  await page.evaluate(() => window.kiteDesktop!.closeCompactView!());
  await expect.poll(async () => (await read()).minimized).toBe(false);
  expect((await read()).count).toBe(2);
});

test('the six positions: 16 from the work area, the bottom row grows upward, the page is told (ADR-0056)', async () => {
  await page.evaluate(() => window.kiteDesktop!.openCompactView!('smoke-positions'));
  await expect.poll(windowCount).toBe(3);
  /**
   * The overlay's bounds and the work area of the display it is on, from the real shell.
   *
   * @returns Both, in DIPs.
   */
  const where = () =>
    app.evaluate(({ BrowserWindow, screen }) => {
      const overlay = BrowserWindow.getAllWindows().find((w) => w.isAlwaysOnTop())!;
      const bounds = overlay.getBounds();
      return { bounds, area: screen.getDisplayMatching(bounds).workArea };
    });
  // The overlay's own page hears about each change.
  await expect
    .poll(() => app.windows().some((w) => w.url().includes('/compact/smoke-positions')), {
      timeout: 15_000,
    })
    .toBe(true);
  const overlayPage = app.windows().find((w) => w.url().includes('/compact/smoke-positions'))!;
  await overlayPage.waitForLoadState();
  await overlayPage.evaluate(() => {
    (window as unknown as { __positions: string[] }).__positions = [];
    window.kiteDesktop!.onOverlayPosition!((preset) =>
      (window as unknown as { __positions: string[] }).__positions.push(preset),
    );
  });
  await page.evaluate(() =>
    window.kiteDesktop!.setOverlayLayout!({ transcript: false, answer: false, popupHeight: 0 }),
  );
  for (const preset of [
    'top-left',
    'top-center',
    'top-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ] as const) {
    expect(await page.evaluate((p) => window.kiteDesktop!.setOverlayPosition!(p), preset)).toBe(
      preset,
    );
    // v1.3.1 (ADR-0058): a jump slides there over 150 ms, so the place is checked once it arrives.
    await expect
      .poll(
        async () => {
          const { bounds, area } = await where();
          const left = preset.endsWith('left');
          const right = preset.endsWith('right');
          const x = left
            ? area.x + 16
            : right
              ? area.x + area.width - bounds.width - 16
              : area.x + Math.round((area.width - bounds.width) / 2);
          const y = preset.startsWith('top')
            ? area.y + 16
            : area.y + area.height - bounds.height - 16;
          return Math.max(Math.abs(bounds.x - x), Math.abs(bounds.y - y));
        },
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => window.kiteDesktop!.getOverlayPosition!())).toBe('bottom-right');
  // On the bottom row an answer panel grows the window upward: its bottom edge stays.
  const before = (await where()).bounds;
  await page.evaluate(() =>
    window.kiteDesktop!.setOverlayLayout!({ transcript: false, answer: true, popupHeight: 0 }),
  );
  await expect.poll(async () => (await where()).bounds.height).toBeGreaterThan(before.height);
  const after = (await where()).bounds;
  expect(Math.abs(after.y + after.height - (before.y + before.height))).toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      overlayPage.evaluate(() => (window as unknown as { __positions: string[] }).__positions),
    )
    .toEqual([
      'top-left',
      'top-center',
      'top-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]);
  // A name the shell does not know is refused.
  await expect(
    page.evaluate(() => window.kiteDesktop!.setOverlayPosition!('middle' as never)),
  ).rejects.toThrow();
  // The jump and nudge keys are registered during a call. ADR-0095 (desktop 1.7.0) moved the jumps to
  // Ctrl+Shift+Arrows; Ctrl+Alt+Arrows (the jumps until then) is no longer held. This line still expected the
  // old keys until 25 Nov 2026 (CI did not run from 17 Nov), and its failure broke the tests after it.
  const statuses = await page.evaluate(() => window.kiteDesktop!.setHotkeysEnabled!(true));
  const keys = statuses.map((status) => status.accelerator);
  expect(keys).toEqual(
    expect.arrayContaining(['CommandOrControl+Shift+Left', 'CommandOrControl+Alt+Shift+Left']),
  );
  expect(keys).not.toContain('CommandOrControl+Alt+Left');
  await page.evaluate(() => window.kiteDesktop!.setHotkeysEnabled!(false));
  // Back to the top centre for the tests after this one, then closed.
  await page.evaluate(() => window.kiteDesktop!.setOverlayPosition!('top-center'));
  await page.evaluate(() => window.kiteDesktop!.closeCompactView!());
  await expect.poll(windowCount).toBe(2);
});

test('window icon (Windows): the taskbar icon is the green parrot logo (UI U4, ADR-0060)', async () => {
  test.skip(process.platform !== 'win32', 'window icons are read through Windows');
  // The icon Windows itself shows for the Kite window (title bar and taskbar).
  const result = await app.evaluate(
    async ({ BrowserWindow, desktopCapturer, nativeImage }, iconFile) => {
      /**
       * Counts the parrot's green pixels (ADR-0060; the blue ribbon mark before): clearly more green than
       * red and blue, and opaque.
       *
       * @param image An icon image.
       * @returns The number of green logo pixels.
       */
      const greenPixels = (image: Electron.NativeImage) => {
        const bitmap = image.toBitmap(); // BGRA
        let green = 0;
        for (let i = 0; i < bitmap.length; i += 4) {
          const [b, g, r, a] = [bitmap[i]!, bitmap[i + 1]!, bitmap[i + 2]!, bitmap[i + 3]!];
          if (a > 200 && g > r + 40 && g > b + 30) green += 1;
        }
        return green;
      };
      // The file the windows are given (src/icon.ts: apps/desktop/build/icon.png).
      const file = nativeImage.createFromPath(iconFile);
      const fileGreen = file.isEmpty() ? 0 : greenPixels(file);
      const main = BrowserWindow.getAllWindows().find((w) => w.getSize()[0]! > 500);
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        fetchWindowIcons: true,
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((s) => s.id === main?.getMediaSourceId());
      if (!source) return { fileGreen, listed: false as const, icon: null };
      if (!source.appIcon || source.appIcon.isEmpty())
        return { fileGreen, listed: true as const, icon: null };
      const { width, height } = source.appIcon.getSize();
      const icon = {
        width,
        height,
        green: greenPixels(source.appIcon),
        png: source.appIcon.toPNG().toString('base64'),
      };
      return { fileGreen, listed: true as const, icon };
    },
    path.join(APP_DIR, 'build', 'icon.png'),
  );
  // Always: the icon file the windows use holds the logo.
  expect(result.fileGreen, 'build/icon.png has no green logo pixels').toBeGreaterThan(0);
  // GitHub's Windows runners have no interactive desktop, so Windows lists no window sources
  // there; the taskbar icon can only be read where Windows lists the Kite window.
  test.skip(!result.listed, 'Windows listed no window source for Kite (no interactive desktop)');
  const icon = result.icon;
  expect(icon, 'Windows listed the Kite window but returned no icon for it').not.toBeNull();
  expect(icon!.green).toBeGreaterThan(0);
  const dir = process.env.KITE_SCREENSHOT_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'desktop-window-icon.png'), Buffer.from(icon!.png, 'base64'));
  }
  console.log(`[smoke] window icon ${icon!.width}×${icon!.height}, ${icon!.green} green pixels`);
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

  expect(await windowCount()).toBe(2);

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
