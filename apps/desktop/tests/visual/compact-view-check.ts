/**
 * File: apps/desktop/tests/visual/compact-view-check.ts
 * Purpose: ADR-0085 check of the compact view in a real desktop shell (dev build) against the overlay
 *          rig: a simulated call, then for each state (default size, zoom 80 % and 130 %, the bottom row,
 *          the narrowest window) it measures the overlay window and its page (window bounds, page height
 *          against the window, a page scrollbar, panels side by side or stacked, the Transcript switch
 *          and ⋮ / Exit whole) and saves a picture of the page (page.screenshot: the page only, never the
 *          real screen). Private: it notes whether each window was protected when first shown, and lists
 *          the shell's visible OS windows with their capture setting (window-affinity.ps1), once with the
 *          real pointer resting on a button that has a tooltip.
 *          Usage: start the rig, `pnpm --filter @kite/desktop build`, then
 *                 `pnpm --filter web exec tsx ../desktop/tests/visual/compact-view-check.ts <out dir>`
 *          KITE_RIG_PLAIN=1 shows the overlay as an account without account sync sees it.
 *          Prints PASS / FAIL / INFO lines and writes measurements.json next to the pictures.
 * Used by: the developer before a release (it needs a screen: the shell's windows appear on it)
 * Depends on: @playwright/test (_electron), the overlay rig (apps/web/tests/visual/overlay-rig.ts),
 *             window-affinity.ps1 (Windows)
 * Architecture: ADR-0085 (compact view: side by side, zoom scales the window, Private first)
 *
 * Temporary profile; update checks off; the real pointer moves only for the tooltip check (from this
 * process, console hidden) and is put back. All text is invented; nothing read from the page is printed
 * but sizes and states.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/** The rig's call page as the script drives it (apps/web/tests/visual/rig-live.tsx). */
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

/** Where the pictures go. */
const OUT = path.resolve(process.argv[2] ?? 'test-results/compact-view-check');

/** This checkout's apps/desktop. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** apps/desktop. */
const APP_DIR = path.resolve(HERE, '..', '..');

/** The rig. */
const RIG = process.argv[3] || 'http://localhost:3123';

/** How many checks failed. */
let failures = 0;

/** The shell's main process id (set once it starts). */
let mainPid = 0;

/** Everything measured, written to measurements.json. */
const results: Record<string, unknown> = {};

/**
 * Waits.
 *
 * @param ms Milliseconds.
 * @returns When done.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Records one check.
 *
 * @param name   What was checked.
 * @param ok     Whether it held.
 * @param detail What was seen.
 */
function check(name: string, ok: boolean, detail: string): void {
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures += 1;
}

/** A width and a height. */
interface Extent {
  /** The width. */
  width: number;
  /** The height. */
  height: number;
}

/** <html>'s scroll sizes. */
interface ScrollSizes {
  /** Its scroll height. */
  height: number;
  /** Its client height. */
  client: number;
  /** Its scroll width. */
  width: number;
  /** Its client width. */
  clientWidth: number;
}

/** What one state of the overlay measures. */
interface PageMeasure {
  /** The page's zoom (CSS zoom on <html>). */
  zoom: number;
  /** window.innerWidth / innerHeight (CSS px, as the page sees them). */
  inner: Extent;
  /** <html>'s scroll height and client height: more scroll than client means a scrollbar. */
  scroll: ScrollSizes;
  /** The root's computed height. */
  rootHeight: string;
  /** Whether the page can scroll (a scrollbar or hidden overflow). */
  scrolls: boolean;
  /** Bar 1's fit step (0 = everything shown). */
  fitStep: number | null;
  /** The Transcript switch: present, and whole inside bar 1 and the window. */
  transcriptSwitch: 'whole' | 'clipped' | 'absent';
  /** ⋮ and Exit whole. */
  barWhole: boolean;
  /** 'side' (panels side by side), 'stacked', 'one' or 'none'. */
  panels: string;
  /** Each panel's rect (CSS px). */
  panelRects: { left: number; top: number; width: number; height: number }[];
  /** A language control in the compact view. */
  languageControls: number;
  /** Elements with a title attribute (native tooltips) in the page. */
  titles: number;
  /** Each panel's scroll area: hidden content (scroll height less client height), CSS px. */
  hiddenInPanels: number[];
  /** <html> has the k-desktop class (popups kept in the window). */
  desktopClass: boolean;
}

/**
 * Measures the overlay's page (no named functions inside: tsx would wrap them in __name).
 *
 * @param overlay The overlay's page.
 * @returns What it shows.
 */
async function measurePage(overlay: Page): Promise<PageMeasure> {
  return overlay.evaluate(() => {
    const html = document.documentElement;
    const root = document.querySelector<HTMLElement>('.k-overlay-root');
    const bar = document.querySelector('[aria-label="Overlay controls"]');
    const barBox = bar?.getBoundingClientRect();
    const exit = document.querySelector('[aria-label="Exit: end call"]')?.getBoundingClientRect();
    const menu = document.querySelector('[aria-label="Overlay menu"]')?.getBoundingClientRect();
    const sw = bar?.querySelector('[role="switch"][aria-label="Transcript"]');
    let transcriptSwitch: 'whole' | 'clipped' | 'absent' = 'absent';
    if (sw && barBox) {
      const box = sw.getBoundingClientRect();
      // Whole: inside bar 1, the window, and not cut by its (overflow-hidden) group.
      const group = sw.parentElement?.closest('[data-fit-step]')?.getBoundingClientRect() ?? barBox;
      transcriptSwitch =
        box.width > 0 &&
        box.left >= barBox.left - 1 &&
        box.right <= Math.min(barBox.right, window.innerWidth) + 1 &&
        box.right <= group.right + 1
          ? 'whole'
          : 'clipped';
    }
    const panelRects = [...document.querySelectorAll('[data-panel]')].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    });
    let panels = 'none';
    if (panelRects.length === 1) panels = 'one';
    if (panelRects.length === 2) {
      // Side by side: one is wholly left of the other (on the bottom row they are bottom-aligned, so their
      // tops may differ).
      const [a, b] = [panelRects[0]!, panelRects[1]!];
      panels =
        a.left + a.width <= b.left + 2 || b.left + b.width <= a.left + 2 ? 'side' : 'stacked';
    }
    const fit = document.querySelector('[data-fit-step]')?.getAttribute('data-fit-step');
    return {
      zoom: Number(html.style.zoom || 1),
      inner: { width: window.innerWidth, height: window.innerHeight },
      scroll: {
        height: html.scrollHeight,
        client: html.clientHeight,
        width: html.scrollWidth,
        clientWidth: html.clientWidth,
      },
      rootHeight: root ? getComputedStyle(root).height : '',
      scrolls: html.scrollHeight > html.clientHeight + 1 || html.scrollWidth > html.clientWidth + 1,
      fitStep: fit === null || fit === undefined ? null : Number(fit),
      transcriptSwitch,
      barWhole: Boolean(
        exit &&
        menu &&
        barBox &&
        exit.right <= Math.min(barBox.right, window.innerWidth) + 1 &&
        menu.right <= exit.left + 1 &&
        menu.width >= 24,
      ),
      panels,
      panelRects,
      languageControls: document.querySelectorAll(
        '[aria-label*="anguage" i], [aria-label*="Answer language"]',
      ).length,
      titles: document.querySelectorAll('[title]').length,
      desktopClass: html.classList.contains('k-desktop'),
      hiddenInPanels: [...document.querySelectorAll('[data-panel] [data-scroll]')].map(
        (area) => area.scrollHeight - area.clientHeight,
      ),
    };
  });
}

/**
 * The overlay window's bounds, its display's work area, and whether it is protected now.
 *
 * @param app The shell.
 * @returns All three, in DIPs.
 */
async function windowPlace(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/compact/'),
    )!;
    const bounds = win.getBounds();
    return {
      bounds,
      area: screen.getDisplayMatching(bounds).workArea,
      protectedNow: win.isContentProtected(),
    };
  });
}

/**
 * Sets the UI zoom the way ⋮ Zoom and Ctrl+= do (the shared setting; every window follows).
 *
 * @param call The call's page (another window: the overlay gets the storage event).
 * @param zoom The zoom (0.8–1.3).
 */
async function setZoom(call: Page, zoom: number): Promise<void> {
  await call.evaluate((value) => {
    if (value === 1) localStorage.removeItem('kite.uiZoom');
    else localStorage.setItem('kite.uiZoom', String(value));
  }, zoom);
  await wait(1_400);
}

/**
 * Measures one state and saves its picture.
 *
 * @param app     The shell.
 * @param overlay The overlay's page.
 * @param name    The state's name (file name).
 * @returns The measurements.
 */
async function snap(app: ElectronApplication, overlay: Page, name: string) {
  const page = await measurePage(overlay);
  const place = await windowPlace(app);
  const { area, bounds } = place;
  const onScreen =
    bounds.x >= area.x &&
    bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width &&
    bounds.y + bounds.height <= area.y + area.height;
  results[name] = { ...page, window: bounds, workArea: area, onScreen };
  console.info(
    `INFO  ${name}: window ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}; page ${page.inner.width}x${page.inner.height} zoom ${page.zoom}; ` +
      `scroll ${page.scroll.height}/${page.scroll.client} (w ${page.scroll.width}/${page.scroll.clientWidth}); root ${page.rootHeight}; ` +
      `fit step ${page.fitStep}; Transcript ${page.transcriptSwitch}; ⋮/Exit ${page.barWhole ? 'whole' : 'cut'}; panels ${page.panels}; ` +
      `language controls ${page.languageControls}; titles ${page.titles}; k-desktop ${page.desktopClass}; ` +
      `panel heights ${page.panelRects.map((r) => r.height).join('/')}; hidden in panels ${page.hiddenInPanels.join('/')}`,
  );
  await overlay.screenshot({ path: path.join(OUT, `${name}.png`) });
  return { ...page, bounds, onScreen };
}

/** One of the shell's visible OS windows (window-affinity.ps1). */
interface OsWindow {
  /** Its window class (Chrome_WidgetWin_1 for a page; a tooltip or a list has its own). */
  cls: string;
  /** Its width, in physical pixels. */
  w: number;
  /** Its height, in physical pixels. */
  h: number;
  /** Its capture setting: 0x11 = left out of captures, 0 = captured. */
  affinity: number;
}

/**
 * Lists the shell's visible OS windows and their capture setting (Windows only).
 *
 * @param app   The shell.
 * @param point Where to rest the real pointer first (screen pixels), or none.
 * @returns The windows, or [] off Windows.
 */
function osWindows(app: ElectronApplication, point?: { x: number; y: number }): OsWindow[] {
  if (process.platform !== 'win32') return [];
  // The shell's main process (it owns every window; Playwright's child process may be a launcher).
  const pid = mainPid;
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(HERE, 'window-affinity.ps1'),
    '-Pids',
    String(pid),
  ];
  if (point) args.push('-X', String(point.x), '-Y', String(point.y), '-WaitMs', '1800');
  const run = spawnSync('powershell', args, { windowsHide: true, encoding: 'utf8' });
  try {
    return JSON.parse(run.stdout.trim() || '[]') as OsWindow[];
  } catch {
    console.info('INFO  window list unreadable');
    return [];
  }
}

/**
 * A control's middle in screen pixels.
 *
 * @param app     The shell.
 * @param overlay The overlay's page.
 * @param label   The control's accessible name.
 * @returns The point, or null when the control is not there.
 */
async function screenPoint(app: ElectronApplication, overlay: Page, label: string) {
  const box = await overlay
    .getByLabel(label, { exact: true })
    .first()
    .boundingBox({ timeout: 2_000 })
    .catch(() => null);
  if (!box) return null;
  const zoom = await overlay.evaluate(() => Number(document.documentElement.style.zoom || 1));
  return app.evaluate(
    ({ BrowserWindow, screen }, middle) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/compact/'),
      )!;
      const bounds = win.getContentBounds();
      return screen.dipToScreenPoint({
        x: Math.round(bounds.x + middle.x),
        y: Math.round(bounds.y + middle.y),
      });
    },
    // Playwright's boxes are in the page's CSS px; under CSS zoom on <html> they are already scaled.
    { x: box.x + box.width / 2, y: box.y + box.height / 2, zoom },
  );
}

/** Runs the call, measures each state, and closes the shell. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), 'kite-compact-check-'));
  // Set when this runs from an editor built on Electron: it would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const app = await electron.launch({
    args: [APP_DIR, `--kite-url=${RIG}`, `--user-data-dir=${profile}`],
    cwd: APP_DIR,
    env: { ...(env as Record<string, string>), KITE_NO_UPDATE_CHECK: '1' },
  });
  try {
    // Private as the last call left it: OFF (a fresh profile). Notes whether each window was protected
    // when it was first shown (protection.attach's own 'show' listener runs first).
    await app.evaluate(({ app: electronApp }) => {
      const shown: { path: string; protectedAtShow: boolean }[] = [];
      (globalThis as unknown as { kiteShown: typeof shown }).kiteShown = shown;
      electronApp.on('browser-window-created', (_event, window) => {
        // At ready-to-show: the overlay is shown with showInactive() then, which fires no 'show' on Windows.
        window.once('ready-to-show', () => {
          let where = '';
          try {
            where = new URL(window.webContents.getURL()).pathname.split('/')[1] ?? '';
          } catch {
            where = '';
          }
          shown.push({ path: `/${where}`, protectedAtShow: window.isContentProtected() });
        });
      });
    });
    mainPid = await app.evaluate(() => process.pid);
    const panel = await app.firstWindow();
    await panel.waitForLoadState();
    await panel.evaluate((plain) => {
      if (plain) localStorage.setItem('rig.plainAccount', '1');
      else localStorage.removeItem('rig.plainAccount');
    }, process.env.KITE_RIG_PLAIN === '1');
    await panel.evaluate(() => window.kiteDesktop!.openPagesWindow!('/'));
    let overlay: Page | undefined;
    let call: Page | undefined;
    for (let i = 0; i < 60 && (!overlay || !call); i += 1) {
      overlay ??= app.windows().find((page) => page.url().includes('/compact/'));
      call ??= app.windows().find((page) => new URL(page.url()).pathname === '/' && page !== panel);
      if (!overlay || !call) await wait(500);
    }
    if (!overlay || !call) throw new Error('The overlay or the call did not open');
    await overlay.waitForSelector('[aria-label="Overlay controls"]');
    await wait(1_500);
    const shown = await app.evaluate(
      () => (globalThis as unknown as { kiteShown: unknown[] }).kiteShown,
    );
    results.shown = shown;
    const overlayShown = (shown as { path: string; protectedAtShow: boolean }[]).find(
      (entry) => entry.path === '/compact',
    );
    check(
      'Private: overlay protected when first shown (Private left off by the last call)',
      overlayShown?.protectedAtShow === true,
      JSON.stringify(overlayShown ?? 'not seen'),
    );
    // At call start, before any answer: which panels are open.
    const start = await snap(app, overlay, 'start-100');
    results.startPanels = start.panels;
    check(
      'Transcript open at call start (first call on this device)',
      start.panelRects.length >= 1,
      start.panels,
    );
    for (const [speaker, words] of [
      ['them', 'HI THANKS FOR JOINING TODAY'],
      ['you', 'great happy to be here'],
      ['them', 'HOW DO YOU KEEP LATENCY LOW'],
    ] as const) {
      await call.evaluate(([who, text]) => (window as unknown as RigWindow).rig.say(who, text), [
        speaker,
        words,
      ] as const);
      await wait(300);
    }
    // ADR-0082: bar 1 has no Answer button; Ctrl+Enter with the overlay focused asks.
    await overlay.keyboard.press('Control+Enter');
    await overlay
      .getByLabel('Latest answer')
      .getByText('Regional deployment', { exact: false })
      .waitFor({ timeout: 15_000 });
    await wait(1_200);
    // Both panels open (the 1.6.4 shell needs the transcript opened by hand).
    let state = await measurePage(overlay);
    if (state.panelRects.length < 2) {
      const sw = overlay.getByRole('switch', { name: 'Transcript' });
      if ((await sw.count()) > 0) await sw.first().click();
      else await overlay.getByLabel('Show the transcript').first().click();
      await wait(1_200);
      state = await measurePage(overlay);
    }
    await overlay.evaluate(() => window.kiteDesktop!.setOverlayPosition!('top-center'));
    await wait(1_000);
    const base = await snap(app, overlay, 'top-center-100');
    check('default: panels side by side', base.panels === 'side', base.panels);
    check('default: no page scrollbar', !base.scrolls, String(base.scrolls));
    check(
      'default: no language control',
      base.languageControls === 0,
      String(base.languageControls),
    );
    check(
      'default: the window fits the panels (no text hidden in them)',
      base.hiddenInPanels.every((hidden) => hidden <= 1),
      base.hiddenInPanels.join('/'),
    );
    for (const zoom of [0.8, 1.3]) {
      await setZoom(call, zoom);
      const seen = await snap(app, overlay, `top-center-${Math.round(zoom * 100)}`);
      const ratio = seen.bounds.width / base.bounds.width;
      check(
        `zoom ${zoom * 100} %: window width follows (×${zoom})`,
        Math.abs(ratio - zoom) < 0.03,
        `×${ratio.toFixed(2)}`,
      );
      check(`zoom ${zoom * 100} %: no page scrollbar`, !seen.scrolls, String(seen.scrolls));
      check(`zoom ${zoom * 100} %: same layout`, seen.panels === base.panels, seen.panels);
      check(
        `zoom ${zoom * 100} %: Transcript switch whole`,
        seen.transcriptSwitch === 'whole',
        seen.transcriptSwitch,
      );
      check(`zoom ${zoom * 100} %: ⋮ and Exit whole`, seen.barWhole, String(seen.barWhole));
      check(`zoom ${zoom * 100} %: window on screen`, seen.onScreen, String(seen.onScreen));
      check(
        `zoom ${zoom * 100} %: the window fits the panels (no text hidden in them)`,
        seen.hiddenInPanels.every((hidden) => hidden <= 1),
        seen.hiddenInPanels.join('/'),
      );
      const centre = seen.bounds.x + seen.bounds.width / 2;
      const baseCentre = base.bounds.x + base.bounds.width / 2;
      check(
        `zoom ${zoom * 100} %: top centre stays put`,
        Math.abs(centre - baseCentre) <= 2 && Math.abs(seen.bounds.y - base.bounds.y) <= 2,
        `centre ${Math.round(centre - baseCentre)}, top ${seen.bounds.y - base.bounds.y}`,
      );
    }
    await setZoom(call, 1);
    const back = await windowPlace(app);
    check(
      'zoom reset: back to the same size',
      Math.abs(back.bounds.width - base.bounds.width) <= 2,
      `${back.bounds.width} vs ${base.bounds.width}`,
    );
    // The bottom row: at 100 %, and bottom-right at 130 %.
    await overlay.evaluate(() => window.kiteDesktop!.setOverlayPosition!('bottom-center'));
    await wait(1_000);
    const bottom = await snap(app, overlay, 'bottom-center-100');
    check('bottom: panels side by side', bottom.panels === 'side', bottom.panels);
    await overlay.evaluate(() => window.kiteDesktop!.setOverlayPosition!('bottom-right'));
    await wait(1_000);
    const br = await windowPlace(app);
    await setZoom(call, 1.3);
    const br130 = await snap(app, overlay, 'bottom-right-130');
    const right = (b: { x: number; width: number }) => b.x + b.width;
    const lower = (b: { y: number; height: number }) => b.y + b.height;
    check(
      'bottom-right 130 %: bottom-right corner stays put',
      Math.abs(right(br130.bounds) - right(br.bounds)) <= 2 &&
        Math.abs(lower(br130.bounds) - lower(br.bounds)) <= 24,
      `right ${right(br130.bounds) - right(br.bounds)}, bottom ${lower(br130.bounds) - lower(br.bounds)}`,
    );
    check('bottom-right 130 %: on screen', br130.onScreen, String(br130.onScreen));
    await setZoom(call, 1);
    // The narrowest window (a drag to the minimum), at 100 % and 130 %.
    await overlay.evaluate(() => window.kiteDesktop!.setOverlayPosition!('top-center'));
    await wait(1_000);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/compact/'),
      )!;
      const [, height] = win.getSize();
      win.setSize(300, height ?? 400);
    });
    await wait(1_200);
    const narrow = await snap(app, overlay, 'narrowest-100');
    check(
      'narrowest 100 %: Transcript switch whole',
      narrow.transcriptSwitch === 'whole',
      narrow.transcriptSwitch,
    );
    check('narrowest 100 %: ⋮ and Exit whole', narrow.barWhole, String(narrow.barWhole));
    check('narrowest 100 %: no page scrollbar', !narrow.scrolls, String(narrow.scrolls));
    await setZoom(call, 1.3);
    const narrow130 = await snap(app, overlay, 'narrowest-130');
    check(
      'narrowest 130 %: Transcript switch whole',
      narrow130.transcriptSwitch === 'whole',
      narrow130.transcriptSwitch,
    );
    check('narrowest 130 %: ⋮ and Exit whole', narrow130.barWhole, String(narrow130.barWhole));
    check('narrowest 130 %: no page scrollbar', !narrow130.scrolls, String(narrow130.scrolls));
    await setZoom(call, 1);
    // Private, in the shell's own terms: Private on (as the page turns it on at call start), then every
    // visible OS window of the shell, at rest and with the real pointer on a button with a tooltip.
    await overlay.evaluate(() => window.kiteDesktop!.setShareProtection!(true));
    await overlay.evaluate(() => window.kiteDesktop!.setOverlayPosition!('top-center'));
    await wait(1_200);
    const atRest = osWindows(app);
    results.osWindowsAtRest = atRest;
    check(
      'Private on: every visible shell window left out of captures (0x11)',
      atRest.length > 0 && atRest.every((w) => w.affinity === 0x11),
      JSON.stringify(atRest),
    );
    if (process.env.KITE_REAL_POINTER === '1') {
      const targets = ['Clear answers', 'Clear transcript', 'Previous question'];
      for (const label of targets) {
        const point = await screenPoint(app, overlay, label);
        if (!point) continue;
        const hovered = osWindows(app, point);
        results[`osWindowsHover:${label}`] = hovered;
        check(
          `Private on, pointer resting on "${label}": every visible shell window left out (0x11)`,
          hovered.every((w) => w.affinity === 0x11),
          `${hovered.length} windows ${JSON.stringify(hovered)}`,
        );
        break;
      }
    }
    // The Rec popover's Screen list (more than one display only): drawn in the page or by the OS.
    results.selectAppearance = await overlay.evaluate(() =>
      [...document.querySelectorAll('select')].map((s) => getComputedStyle(s).appearance),
    );
  } finally {
    writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(results, null, 2));
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
}

void main().then(
  () => {
    console.info(`compact-view-check: ${failures} failed; pictures in ${OUT}`);
    if (failures > 0) process.exitCode = 1;
  },
  (error: unknown) => {
    console.error('compact-view-check: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
