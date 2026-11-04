/**
 * File: apps/web/tests/visual/v110-shots.ts
 * Purpose: v1.1.0's visual check (item 28): drives a simulated call on the overlay rig in a browser with
 *          a temporary profile and captures every screen and state as a page image, on a busy backdrop
 *          where the real window is see-through. It captures pages only, never the screen, so nothing
 *          of the computer it runs on can get in. With a folder of reference frames it also lays each
 *          capture next to its reference for looking at; those side-by-sides hold another company's UI
 *          and go in a git-ignored folder.
 *          Usage: start the rig (overlay-rig.ts), then
 *                 `pnpm --filter web exec tsx tests/visual/v110-shots.ts <out dir> [<references> <side-by-side dir>]`
 * Used by: the developer before a release; docs/testing/v1.1.0-visual-check.md
 * Depends on: @playwright/test, tests/visual/overlay-rig.ts
 * Architecture: docs/decisions/ADR-0041-home-panel-and-stacked-overlay.md
 *
 * All text is invented.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

/** Where the captures go. */
const OUT = path.resolve(process.argv[2] ?? 'test-results/v110-shots');

/** The reference frames, if given. */
const REFERENCES = process.argv[3] ? path.resolve(process.argv[3]) : null;

/** Where the side-by-sides go, if given. */
const SIDE_BY_SIDE = process.argv[4] ? path.resolve(process.argv[4]) : null;

/** The rig. */
const RIG = 'http://localhost:3123';

/** A busy backdrop for the see-through states: light and dark text-like stripes and blocks. */
const BACKDROP = [
  'repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0 2px, transparent 2px 22px)',
  'linear-gradient(120deg, #1d4ed8 0%, #0ea5e9 35%, #f8fafc 36%, #e2e8f0 70%, #334155 71%, #0f172a 100%)',
].join(', ');

/** Which reference frame each capture is compared with. */
const PAIRS: Readonly<Record<string, string>> = {
  'home-panel': 'desktop-home.png',
  'home-menu': 'desktop-menu-idle.png',
  'snap-zones': 'desktop-positions.png',
  'bars-during-call': 'desktop-bars.png',
  'transcript-panel': 'desktop-transcript-panel.png',
  'answer-panel': 'desktop-answer-panel.png',
  'coding-answer': 'desktop-code-answer.png',
  'live-menu': 'desktop-menu-live.png',
  'browser-split': 'browser-split.png',
};

/** The fake shell the overlay and panel pages see: the same methods as the real preload's. */
const FAKE_SHELL = `
  window.kiteDesktop = Object.freeze({
    version: '1.1.0', os: 'windows',
    placeOverlay: async () => undefined, getOverlayPreset: async () => 'top-center',
    resizeOverlay: async () => undefined, setOverlayMode: async () => undefined,
    setOverlayOpacity: async () => undefined, setOverlayCollapsed: async () => undefined,
    setOverlayLayout: async () => undefined, openPagesWindow: async () => undefined,
    windowControl: async () => undefined, showCallWindow: async () => undefined,
    closeCompactView: async () => undefined, openCompactView: async () => undefined,
    minimizeMainWindow: () => undefined, setCallActive: () => undefined,
    getShareProtection: async () => ({ on: false, supported: true, scope: 'all' }),
    setShareProtection: async (on) => ({ on, supported: true, scope: 'all' }),
    checkHotkeys: async () => [], setHotkeysEnabled: async () => [], onHotkey: () => undefined,
    onSnapZone: () => () => undefined,
  });
`;

/** The rig page's controls (window.rig in rig-live.tsx). */
interface RigControls {
  /**
   * Feeds a line as the speech engine would.
   *
   * @param speaker 'them' or 'you'.
   * @param text    What they said.
   */
  say: (speaker: string, text: string) => void;
}

/**
 * Lets a see-through page show the backdrop, as the real window shows what is behind it.
 *
 * @param page The page.
 * @returns When done.
 */
const paintBackdrop = (page: Page) =>
  page.evaluate((image) => {
    document.documentElement.style.backgroundImage = image;
    document.documentElement.style.backgroundAttachment = 'fixed';
  }, BACKDROP);

/**
 * Saves a capture.
 *
 * @param page The page.
 * @param name The capture's name.
 * @returns When saved.
 */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.info(`  captured ${name}`);
}

/**
 * Feeds a line to the simulated call.
 *
 * @param call    The call's page.
 * @param speaker Who spoke.
 * @param text    What they said.
 * @returns When done.
 */
const say = async (call: Page, speaker: 'them' | 'you', text: string) => {
  await call.evaluate(
    ([who, words]) => (window as unknown as { rig: RigControls }).rig.say(who!, words!),
    [speaker, text] as const,
  );
  // The rig dates each line 1.5 s long, ending now, and lines closer than 1.5 s are one line
  // (merge.ts): a real pause keeps them apart.
  await call.waitForTimeout(3_200);
};

/**
 * Lays a capture next to its reference frame.
 *
 * @param context A browser context.
 * @param name    The capture's name.
 * @param frame   The reference frame's file name.
 * @returns When saved.
 */
async function sideBySide(context: BrowserContext, name: string, frame: string): Promise<void> {
  if (!REFERENCES || !SIDE_BY_SIDE) return;
  const reference = path.join(REFERENCES, frame);
  if (!existsSync(reference)) return;
  const page = await context.newPage();
  const data = (file: string) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  await page.setContent(
    `<!doctype html><body style="margin:0;background:#334155;color:#fff;font:15px sans-serif">
      <div style="display:flex;gap:16px;padding:12px;align-items:flex-start">
        <div><p>Reference: ${frame}</p><img style="max-width:900px;max-height:900px" src="${data(reference)}"></div>
        <div><p>Kite: ${name}</p><img style="max-width:900px;max-height:900px" src="${data(path.join(OUT, `${name}.png`))}"></div>
      </div></body>`,
  );
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SIDE_BY_SIDE, `${name}.png`), fullPage: true });
  await page.close();
}

/**
 * Captures everything.
 *
 * @returns When done.
 */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (SIDE_BY_SIDE) mkdirSync(SIDE_BY_SIDE, { recursive: true });
  // A browser of Playwright's own, with a new temporary profile each run.
  const browser = await chromium.launch();

  // The home panel.
  const homeContext = await browser.newContext({
    viewport: { width: 400, height: 560 },
    colorScheme: 'dark',
  });
  await homeContext.addInitScript(FAKE_SHELL);
  const home = await homeContext.newPage();
  await home.goto(`${RIG}/home`);
  const notice = home.getByRole('dialog', { name: 'Using Kite' });
  await notice.waitFor();
  await shot(home, 'acceptable-use-notice');
  await notice.getByRole('button', { name: 'Got it' }).click();
  await home.getByRole('list', { name: 'Sessions' }).waitFor();
  await shot(home, 'home-panel');
  await home.getByRole('button', { name: 'Menu', exact: true }).click();
  await shot(home, 'home-menu');
  await home.keyboard.press('Escape');
  await home.emulateMedia({ colorScheme: 'light' });
  await shot(home, 'home-panel-light');

  // The snap zones, over a busy page, with the centre lit by the pointer.
  const zonesContext = await browser.newContext({ viewport: { width: 1536, height: 824 } });
  await zonesContext.addInitScript(FAKE_SHELL);
  const zones = await zonesContext.newPage();
  await zones.goto(
    `${RIG}/overlay-zones?zones=top-left,24,24,480,320;top-center,528,24,480,320;top-right,1032,24,480,320`,
  );
  await paintBackdrop(zones);
  await zones.evaluate(() =>
    document.querySelector('[data-zone="top-center"]')?.setAttribute('data-active', 'true'),
  );
  await shot(zones, 'snap-zones');

  // A call: the live page, and the overlay linked to it.
  const callContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const call = await callContext.newPage();
  await call.goto(`${RIG}/`);
  await call
    .getByRole('button', { name: /^Answer/ })
    .first()
    .waitFor();
  await say(call, 'them', 'THANKS FOR JOINING LET US START WITH YOUR BACKGROUND');
  await say(call, 'you', 'SURE I HAVE BEEN WORKING ON ROUTE PLANNING FOR FOUR YEARS');

  await callContext.addInitScript(FAKE_SHELL);
  const overlay = await callContext.newPage();
  await overlay.setViewportSize({ width: 680, height: 108 });
  await overlay.goto(`${RIG}/compact/harness-session`);
  await overlay.getByRole('toolbar', { name: 'Overlay controls' }).waitFor();
  await paintBackdrop(overlay);
  await shot(overlay, 'bars-during-call');

  await overlay.getByRole('button', { name: 'Chat' }).click();
  await overlay.setViewportSize({ width: 680, height: 108 });
  await shot(overlay, 'chat-input');
  await overlay.getByRole('button', { name: 'Close chat' }).click();

  await say(call, 'them', 'TELL ME ABOUT A TIME YOU LED A MIGRATION');
  await say(call, 'them', 'GRONK BLIMP SPROCKET WIBBLE FLANGE');
  await overlay.setViewportSize({ width: 680, height: 390 });
  await overlay.getByRole('button', { name: 'Open the transcript', exact: true }).click();
  await shot(overlay, 'transcript-panel');
  await overlay.getByRole('button', { name: 'Close the transcript' }).click();

  await overlay.setViewportSize({ width: 680, height: 452 });
  await say(call, 'them', 'HOW WOULD YOU DESIGN A VOICE AGENT FOR A HOSPITAL');
  await overlay
    .getByRole('button', { name: /^Answer/ })
    .first()
    .click();
  // At once: the mocked answer takes about a second.
  await overlay.getByRole('button', { name: 'Stop' }).waitFor({ timeout: 3_000 });
  await overlay.screenshot({ path: path.join(OUT, 'answer-thinking.png') });
  await overlay.getByRole('heading', { name: 'Answer line' }).waitFor();
  await overlay.waitForTimeout(2_500);
  await shot(overlay, 'answer-panel');

  await overlay.setViewportSize({ width: 680, height: 660 });
  await overlay.getByRole('button', { name: 'Open the transcript', exact: true }).click();
  await shot(overlay, 'both-panels');
  await overlay.getByRole('button', { name: 'Overlay menu' }).click();
  await shot(overlay, 'live-menu');
  await overlay.keyboard.press('Escape');
  await overlay.getByRole('button', { name: 'Close the transcript' }).click();

  await overlay.setViewportSize({ width: 680, height: 452 });
  await overlay.getByRole('button', { name: 'End call' }).click();
  await shot(overlay, 'end-confirm');
  await overlay.getByRole('button', { name: 'Cancel' }).click();

  await overlay.emulateMedia({ colorScheme: 'light' });
  await shot(overlay, 'answer-panel-light');
  await overlay.emulateMedia({ colorScheme: 'dark' });

  await say(call, 'them', 'CAN YOU WRITE A FUNCTION THAT COUNTS VOWELS IN A STRING');
  await overlay
    .getByRole('button', { name: /^Answer/ })
    .first()
    .click();
  await overlay
    .getByLabel('Complexity')
    .waitFor({ timeout: 8_000 })
    .catch(() => undefined);
  await overlay.waitForTimeout(1_000);
  await shot(overlay, 'coding-answer');
  await overlay.close();

  await shot(call, 'call-window');

  // The browser view.
  const browserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const split = await browserContext.newPage();
  await split.goto(`${RIG}/?layout=browser`);
  await split.getByRole('toolbar', { name: 'Call controls' }).waitFor();
  await say(split, 'them', 'THANKS FOR JOINING LET US START');
  await say(split, 'you', 'SOUNDS GOOD I AM READY WHEN YOU ARE');
  await say(split, 'them', 'HOW WOULD YOU DESIGN A VOICE AGENT FOR A HOSPITAL');
  await split
    .getByRole('button', { name: /^Answer/ })
    .first()
    .click();
  await split.waitForTimeout(2_500);
  await shot(split, 'browser-split');
  await split.getByRole('button', { name: 'More' }).click();
  await shot(split, 'browser-menu');

  for (const [name, frame] of Object.entries(PAIRS)) {
    await sideBySide(browserContext, name, frame);
  }
  await browser.close();
}

void main().then(
  () => console.info('done'),
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
