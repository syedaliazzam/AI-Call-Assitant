/**
 * File: apps/desktop/tests/manual/panels-click-through.spec.ts
 * Purpose: v1.3.2, typing behind the open panels, on the real shell with real mouse and keyboard input
 *          from Windows. With both panels open and a document window behind the overlay (the test's own
 *          full-screen window with a text box, a normal window as Word or Notepad is):
 *          - the window is fitted to the panels, and a click in the transparent space beside the shorter
 *            panel reaches the document, and typing follows it;
 *          - new transcript lines and a streaming answer update the panels without taking the keyboard;
 *          - a click on a panel's button works, then the keyboard goes back to the document;
 *          - the global shortcuts still work (Answer from the document);
 *          - Click-through (Ctrl+Alt+X): a click on a panel's words reaches the document; the bar's
 *            "Click-through on" turns it off.
 *          Every click lands on a window of this test, never on another app, and keys are only sent while
 *          one of this test's windows has the keyboard.
 *          Needs the overlay rig running (`pnpm --filter web exec tsx tests/visual/overlay-rig.ts`, port
 *          3123) and this checkout's shell built (`pnpm --filter @kite/desktop build`). Temporary profile.
 *          It moves the mouse and types for about a minute: leave the computer alone while it runs.
 *          Usage: pnpm --filter @kite/desktop exec playwright test -c playwright.manual.config.ts panels-click-through
 * Used by: the developer before a release (release checks); the v1.3.2 desktop smoke test
 * Depends on: @playwright/test (_electron), PowerShell (user32 mouse_event, Windows Forms SendKeys)
 * Architecture: ADR-0055; v1.3.2 (docs/design/paramount-ai-ui-spec.md S13, S15)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/** The rig's call page as the test drives it (tests/visual/rig-live.tsx). */
interface RigWindow {
  /** The rig's controls. */
  rig: {
    /**
     * Feeds a line as the speech engine would.
     *
     * @param speaker Who speaks.
     * @param text    The words.
     */
    say: (speaker: 'you' | 'them', text: string) => void;
  };
}

/** apps/desktop. */
const APP_DIR = path.join(__dirname, '..', '..');

/** The overlay rig (RIG_PORT, as the rig itself reads it; default 3123). */
const RIG = `http://localhost:${process.env.RIG_PORT ?? 3123}`;

/** Where the overlay is put (DIPs on the primary screen); its height follows the panels. */
const OVERLAY = { x: 120, y: 60, width: 1080, height: 540 };

/** The document behind: a text box over the whole window, and a record of the clicks it gets. */
const BEHIND = `data:text/html,${encodeURIComponent(
  '<!doctype html><title>document behind</title><body style="margin:0;background:#f4f6fa">' +
    '<textarea id="box" style="position:fixed;inset:0;width:100%;height:100%;font:20px sans-serif;border:0;background:transparent"></textarea>' +
    '<script>window.clicks=0;addEventListener("mousedown",()=>clicks++,true);</script></body>',
)}`;

let app: ElectronApplication;
let overlay: Page;
let call: Page;
let profile = '';

/** The primary screen's size in DIPs (set once the shell runs). */
let screenSize = { width: 1, height: 1 };

/**
 * Runs a PowerShell snippet with user32's mouse_event and Windows Forms' SendKeys loaded. Its window is
 * hidden: a console window would take the keyboard.
 *
 * @param script The snippet.
 */
function powershell(script: string): void {
  const prelude =
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    'Add-Type -Namespace K -Name U -MemberDefinition \'[DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int i);\'; ';
  const done = spawnSync('powershell', ['-NoProfile', '-Command', prelude + script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (done.status !== 0) throw new Error(`PowerShell failed: ${done.stderr.slice(0, 300)}`);
}

/**
 * Moves the real pointer to a screen point (DIPs) as mouse input, arriving from 6 px to the left, so
 * the window under it gets moves (the overlay's click-through follows them).
 *
 * @param x Screen x.
 * @param y Screen y.
 */
function pointAt(x: number, y: number): void {
  const nx = (value: number) => Math.round((value * 65_535) / screenSize.width);
  const ny = Math.round((y * 65_535) / screenSize.height);
  // 0x8001: MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE.
  powershell(
    `[K.U]::mouse_event(0x8001, ${nx(x - 6)}, ${ny}, 0, 0); Start-Sleep -Milliseconds 80; [K.U]::mouse_event(0x8001, ${nx(x - 3)}, ${ny}, 0, 0); Start-Sleep -Milliseconds 80; [K.U]::mouse_event(0x8001, ${nx(x)}, ${ny}, 0, 0); Start-Sleep -Milliseconds 400`,
  );
}

/** A real left click where the pointer is. */
function click(): void {
  powershell(
    '[K.U]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 60; [K.U]::mouse_event(4,0,0,0,0); Start-Sleep -Milliseconds 400',
  );
}

/**
 * Which of this test's windows has the keyboard: 'behind', 'overlay', 'other' (another of its windows) or
 * 'none' (another app).
 *
 * @returns The window.
 */
async function focused(): Promise<'behind' | 'overlay' | 'other' | 'none'> {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getFocusedWindow();
    if (!window) return 'none';
    if (window === (globalThis as unknown as { behind: Electron.BrowserWindow }).behind) {
      return 'behind';
    }
    return window.webContents.getURL().includes('/compact/') ? 'overlay' : 'other';
  });
}

/**
 * Real typing, sent only while the document behind has the keyboard (so no key ever reaches another
 * app). SendKeys syntax: ^ is Ctrl, % is Alt.
 *
 * @param keys The keys.
 */
async function typeBehind(keys: string): Promise<void> {
  expect(await focused(), 'the document behind has the keyboard before typing').toBe('behind');
  powershell(`[System.Windows.Forms.SendKeys]::SendWait('${keys}'); Start-Sleep -Milliseconds 400`);
}

/**
 * The document's text and click count.
 *
 * @returns Its text box's value and how many presses it got.
 */
async function behindState(): Promise<{ text: string; clicks: number }> {
  return app.evaluate(() =>
    (
      globalThis as unknown as { behind: Electron.BrowserWindow }
    ).behind.webContents.executeJavaScript(
      '({ text: document.getElementById("box").value, clicks: window.clicks })',
    ),
  );
}

/**
 * The overlay's content place and zoom, to turn page points into screen points.
 *
 * @returns The content bounds and zoom factor.
 */
async function overlayPlace() {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/compact/'),
    )!;
    return { content: win.getContentBounds(), zoom: win.webContents.getZoomFactor() };
  });
}

/**
 * A page point in the overlay as a screen point.
 *
 * @param point The point, in the page's CSS pixels.
 * @returns The point on the screen, in DIPs.
 */
async function onScreen(point: { x: number; y: number }) {
  const { content, zoom } = await overlayPlace();
  return {
    x: Math.round(content.x + point.x * zoom),
    y: Math.round(content.y + point.y * zoom),
  };
}

test.beforeAll(async () => {
  test.skip(process.platform !== 'win32', 'Windows only');
  const rig = await fetch(RIG).catch(() => null);
  test.skip(!rig?.ok, `Start the overlay rig first (${RIG})`);
  profile = mkdtempSync(path.join(tmpdir(), 'kite-panels-through-'));
  // Set when this runs from an editor built on Electron: it would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  app = await electron.launch({
    args: [APP_DIR, `--kite-url=${RIG}`, `--user-data-dir=${profile}`],
    cwd: APP_DIR,
    env: { ...(env as Record<string, string>), KITE_NO_UPDATE_CHECK: '1' },
  });
  // The rig's simulated call is at /: it runs in the main window and opens the overlay, as a call does.
  const panel = await app.firstWindow();
  await panel.waitForLoadState();
  await panel.evaluate(() => window.kiteDesktop!.openPagesWindow!('/'));
  for (let i = 0; i < 60 && (!overlay || !call); i += 1) {
    overlay ??= app.windows().find((page) => page.url().includes('/compact/'))!;
    call ??= app.windows().find((page) => new URL(page.url()).pathname === '/' && page !== panel)!;
    if (!overlay || !call) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!overlay || !call) throw new Error('The overlay or the call did not open');
  await overlay.waitForSelector('[aria-label="Overlay controls"]');
  // The document behind: a normal window (not always on top), as Word is, covering the work area.
  await app.evaluate(
    async ({ BrowserWindow, screen }, { url, bounds }) => {
      const behind = new BrowserWindow({ ...screen.getPrimaryDisplay().workArea, frame: false });
      await behind.loadURL(url);
      behind.show();
      behind.focus();
      (globalThis as unknown as { behind: Electron.BrowserWindow }).behind = behind;
      const top = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/compact/'),
      )!;
      top.setBounds(bounds);
      top.moveTop();
    },
    { url: BEHIND, bounds: OVERLAY },
  );
  screenSize = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
  // Both panels, the way a user opens them (the page's own controls; no real input yet).
  // ADR-0118: bar 2's expand button (bar 1's Transcript switch is gone).
  await overlay.getByRole('button', { name: 'Open the full transcript' }).click();
  await call.evaluate(() => {
    const rig = (window as unknown as RigWindow).rig;
    rig.say('them', 'HI THANKS FOR JOINING');
    rig.say('you', 'happy to be here');
    rig.say('them', 'HOW DO YOU KEEP LATENCY LOW');
  });
  await overlay.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(overlay.getByLabel('Latest answer')).toContainText('Regional deployment', {
    timeout: 15_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (profile) rmSync(profile, { recursive: true, force: true });
});

test('both panels open: the document behind takes clicks and typing; panels update; hotkeys work', async () => {
  // The window is fitted to what it shows: its bottom is the taller panel's bottom.
  const fit = await overlay.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')];
    return {
      count: panels.length,
      bottom: Math.max(...panels.map((panel) => panel.getBoundingClientRect().bottom)),
      height: window.innerHeight,
    };
  });
  expect(fit.count, 'both panels are open').toBe(2);
  expect(fit.height - fit.bottom, 'the window ends at the panels').toBeLessThanOrEqual(12);
  expect(fit.height, 'and is no taller than the layout allows').toBeLessThanOrEqual(OVERLAY.height);

  // A gap beside the shorter panel: the first point under the bars marked data-gap.
  const spot = await overlay.evaluate(() => {
    const bar = document.querySelector('[aria-label="Overlay controls"]')!.getBoundingClientRect();
    for (let y = window.innerHeight - 10; y > bar.bottom + 60; y -= 6) {
      for (let x = 20; x < window.innerWidth - 20; x += 12) {
        const at = document.elementFromPoint(x, y);
        if (at?.hasAttribute('data-gap') && at.closest('[data-panel]') === null) return { x, y };
      }
    }
    return null;
  });
  expect(spot, 'the overlay has a transparent gap beside the shorter panel').not.toBeNull();
  const gap = await onScreen(spot!);
  pointAt(gap.x, gap.y);
  pointAt(gap.x, gap.y);
  click();
  expect((await behindState()).clicks, 'the click went through to the document').toBe(1);
  await typeBehind('kite');
  expect((await behindState()).text, 'typing went to the document').toBe('kite');

  // New lines and a streaming answer update the panels without taking the keyboard.
  await call.evaluate(() => {
    const rig = (window as unknown as RigWindow).rig;
    rig.say('them', 'AND WHAT PRODUCTION SYSTEMS HAVE YOU BUILT');
  });
  await typeBehind('^{ENTER}');
  await expect(overlay.getByLabel('Latest answer')).toContainText('Document search', {
    timeout: 15_000,
  });
  await expect(overlay.getByLabel('Live transcript')).toContainText('production systems');
  expect(await focused(), 'the panels updated without taking the keyboard').toBe('behind');
  await typeBehind(' still here');
  expect((await behindState()).text).toBe('kite still here');

  // A real click on a panel's button works, then the keyboard goes back to the document.
  const previous = overlay.getByRole('button', { name: 'Previous question' });
  const box = (await previous.boundingBox())!;
  const at = await onScreen({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  pointAt(at.x, at.y);
  click();
  await expect(overlay.getByLabel('Latest answer')).toContainText('Regional deployment');
  await expect.poll(focused, { timeout: 3_000 }).toBe('behind');
  await typeBehind('!');
  expect((await behindState()).text, 'typing after a panel click went to the document').toBe(
    'kite still here!',
  );
});

test('Click-through (Ctrl+Alt+X): a click on a panel reaches the document; the bar turns it off', async () => {
  await typeBehind('^%x');
  const indicator = overlay.getByRole('button', { name: 'Click-through on. Turn off' });
  await expect(indicator).toBeVisible();
  // Over the words in the transcript panel: not a gap, but in this mode the click passes.
  const words = (await overlay.getByLabel('Live transcript').boundingBox())!;
  const before = (await behindState()).clicks;
  const at = await onScreen({ x: words.x + 40, y: words.y + 20 });
  pointAt(at.x, at.y);
  pointAt(at.x, at.y);
  click();
  expect((await behindState()).clicks, 'the click on the panel went to the document').toBe(
    before + 1,
  );
  expect(await focused()).toBe('behind');
  // The bars still take clicks: the indicator turns it off.
  const chip = (await indicator.boundingBox())!;
  const off = await onScreen({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 });
  pointAt(off.x, off.y);
  click();
  await expect(indicator).toHaveCount(0);
  expect((await behindState()).clicks, 'the bar kept its click').toBe(before + 1);
});
