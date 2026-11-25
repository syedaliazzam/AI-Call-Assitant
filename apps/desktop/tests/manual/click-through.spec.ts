/**
 * File: apps/desktop/tests/manual/click-through.spec.ts
 * Purpose: The overlay's click-through on the real shell (v1.3.0, ADR-0055), with real mouse and keyboard
 *          input from Windows: a click in a transparent gap between the bars reaches the window behind,
 *          and typing then goes there; a click on a bar still reaches the bar. The window behind is the
 *          test's own (a full-screen page with a text box, pinned below the overlay), so every click lands
 *          on a window of this test, never on another app.
 *          Needs the overlay rig running (`pnpm --filter web exec tsx tests/visual/overlay-rig.ts`, port
 *          3123) and this checkout's shell built (`pnpm --filter @kite/desktop build`). Temporary profile.
 *          It moves the mouse for a few seconds: leave the computer alone while it runs.
 *          Usage: pnpm --filter @kite/desktop exec playwright test -c playwright.manual.config.ts click-through
 * Used by: the developer before a release (docs/testing/final-test-plan.md, release checks)
 * Depends on: @playwright/test (_electron), PowerShell (user32 mouse_event, Windows Forms SendKeys)
 * Architecture: ADR-0055
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

/** apps/desktop. */
const APP_DIR = path.join(__dirname, '..', '..');

/** The overlay rig (RIG_PORT, as the rig itself reads it; default 3123). */
const RIG = `http://localhost:${process.env.RIG_PORT ?? 3123}`;

/** Where the overlay is put (DIPs on the primary screen). */
const OVERLAY = { x: 120, y: 120, width: 900, height: 420 };

/** The window behind: a text box over the whole page, and a record of the clicks it gets. */
const BEHIND = `data:text/html,${encodeURIComponent(
  '<!doctype html><title>behind</title><body style="margin:0;background:#e8eef6">' +
    '<textarea id="box" style="position:fixed;inset:0;width:100%;height:100%;font:20px sans-serif;border:0;background:transparent"></textarea>' +
    '<script>window.clicks=[];addEventListener("mousedown",e=>clicks.push([e.screenX,e.screenY]),true);</script></body>',
)}`;

let app: ElectronApplication;
let overlay: Page;
let profile = '';

/**
 * Runs a PowerShell snippet with user32's mouse_event and Windows Forms' SendKeys loaded.
 *
 * @param script The snippet.
 */
function powershell(script: string): void {
  const prelude =
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    'Add-Type -Namespace K -Name U -MemberDefinition \'[DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int i);\'; ';
  const done = spawnSync('powershell', ['-NoProfile', '-Command', prelude + script], {
    encoding: 'utf8',
  });
  if (done.status !== 0) throw new Error(`PowerShell failed: ${done.stderr.slice(0, 300)}`);
}

/** The primary screen's size in DIPs (set once the shell runs). */
let screenSize = { width: 1, height: 1 };

/**
 * Moves the real pointer to a screen point (DIPs) the way a mouse does: as mouse input (mouse_event,
 * absolute), which the shell's pointer forwarding sees. (SetCursorPos alone only moves the cursor; a
 * click-through window would then never learn the pointer is over a bar.) It arrives from 6 px to the
 * left, so the window under it gets moves.
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
    '[K.U]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 60; [K.U]::mouse_event(4,0,0,0,0); Start-Sleep -Milliseconds 300',
  );
}

/**
 * Real typing, into whatever has the keyboard.
 *
 * @param text Letters only.
 */
function type(text: string): void {
  powershell(`[System.Windows.Forms.SendKeys]::SendWait('${text}'); Start-Sleep -Milliseconds 300`);
}

test.beforeAll(async () => {
  test.skip(process.platform !== 'win32', 'Windows only');
  const rig = await fetch(RIG).catch(() => null);
  test.skip(!rig?.ok, `Start the overlay rig first (${RIG})`);
  profile = mkdtempSync(path.join(tmpdir(), 'kite-click-through-'));
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
  let found: Page | undefined;
  for (let i = 0; i < 60 && !found; i += 1) {
    found = app.windows().find((page) => page.url().includes('/compact/'));
    if (!found) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!found) throw new Error('The overlay did not open');
  overlay = found;
  await overlay.waitForSelector('[aria-label="Overlay controls"]');
  // The window behind covers the whole primary screen, pinned below the overlay.
  await app.evaluate(
    async ({ BrowserWindow, screen }, { url, bounds }) => {
      const behind = new BrowserWindow({ ...screen.getPrimaryDisplay().bounds, frame: false });
      behind.setAlwaysOnTop(true, 'normal');
      await behind.loadURL(url);
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
  await new Promise((resolve) => setTimeout(resolve, 1_000));
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (profile) rmSync(profile, { recursive: true, force: true });
});

test('a click in a gap reaches the window behind, typing follows it; a bar keeps its clicks', async () => {
  // Where the overlay's pieces are, in screen DIPs: its content's place plus each element's box.
  const { content, zoom } = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/compact/'),
    )!;
    return { content: win.getContentBounds(), zoom: win.webContents.getZoomFactor() };
  });
  // A gap under bar 1: the first point, from the right, whose element is a layout box marked data-gap.
  const spot = await overlay.evaluate(() => {
    const bar = document.querySelector('[aria-label="Overlay controls"]')!.getBoundingClientRect();
    for (let y = bar.bottom + 12; y < window.innerHeight - 8; y += 8) {
      for (let x = window.innerWidth - 16; x > window.innerWidth / 2; x -= 16) {
        if (document.elementFromPoint(x, y)?.hasAttribute('data-gap')) return { x, y };
      }
    }
    return null;
  });
  expect(spot, 'the overlay has a transparent gap under bar 1').not.toBeNull();
  const gap = {
    x: Math.round(content.x + spot!.x * zoom),
    y: Math.round(content.y + spot!.y * zoom),
  };

  // Twice: a real mouse sends a stream of moves; one short burst can arrive before a just-started
  // overlay listens.
  pointAt(gap.x, gap.y);
  pointAt(gap.x, gap.y);
  click();
  const clicks = await app.evaluate(() =>
    (
      globalThis as unknown as { behind: Electron.BrowserWindow }
    ).behind.webContents.executeJavaScript('window.clicks.length'),
  );
  expect(clicks, 'the click went through the gap to the window behind').toBe(1);
  type('kite');
  const typed = await app.evaluate(() =>
    (
      globalThis as unknown as { behind: Electron.BrowserWindow }
    ).behind.webContents.executeJavaScript('document.getElementById("box").value'),
  );
  expect(typed, 'typing went to the window behind').toBe('kite');

  // A bar keeps its clicks: bar 2's expand button (ADR-0118; bar 1's Transcript pill is gone) switches the
  // full transcript panel.
  const pill = overlay.getByRole('button', { name: /^(Open|Close) the full transcript$/ });
  const before = await pill.getAttribute('aria-pressed');
  const box = (await pill.boundingBox())!;
  pointAt(
    Math.round(content.x + (box.x + box.width / 2) * zoom),
    Math.round(content.y + (box.y + box.height / 2) * zoom),
  );
  click();
  await expect(pill).not.toHaveAttribute('aria-pressed', before ?? 'false');
  const clicksAfter = await app.evaluate(() =>
    (
      globalThis as unknown as { behind: Electron.BrowserWindow }
    ).behind.webContents.executeJavaScript('window.clicks.length'),
  );
  expect(clicksAfter, 'the bar took the click; the window behind did not get it').toBe(1);
});
