/**
 * File: apps/web/tests/visual/feedback-shots.ts
 * Purpose: The ADR-0082 visual check (team feedback, 14 Nov 2026): drives a simulated call on the overlay
 *          rig in a browser with a temporary profile and captures the overlay (bars with live words, the
 *          "can't hear the other side" warning, a voice question listening, an answer, the answers after
 *          Ctrl+Backspace) and the launcher's first card after choosing a session. It works on the rig of
 *          this version and of the version before (main), so the same states can be compared side by
 *          side. Page images only, never the screen; all text is invented.
 *          Usage: start the rig (overlay-rig.ts, RIG_PORT), then
 *                 `RIG=http://localhost:3123 OVERLAY_WIDTH=640 pnpm --filter web exec tsx tests/visual/feedback-shots.ts <out dir>`
 * Used by: the developer before a release (ADR-0082)
 * Depends on: @playwright/test, tests/visual/overlay-rig.ts (?notice= and ?launcher=1)
 * Architecture: docs/decisions/ADR-0082-account-scoped-local-data-one-status-bar-parakeet-keys.md
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

/** Where the captures go. */
const OUT = path.resolve(process.argv[2] ?? 'test-results/feedback-shots');

/** The rig. */
const RIG = process.env.RIG ?? 'http://localhost:3123';

/** The overlay's width: 980 for the old default, a third of a 1920 screen (640) for the new one. */
const WIDTH = Number(process.env.OVERLAY_WIDTH ?? 640);

/** A busy backdrop, as the real see-through window shows what is behind it. */
const BACKDROP =
  'linear-gradient(135deg, #1e3a5f 0%, #3b5b7a 40%, #c7d2de 41%, #e2e8f0 70%, #94a3b8 100%)';

/** The fake desktop shell the overlay sees (desktop 1.6.x methods; everything does nothing). */
const FAKE_SHELL = `
  window.kiteDesktop = Object.freeze({
    version: '1.6.4', os: 'windows',
    placeOverlay: async () => undefined, getOverlayPreset: async () => 'top-center',
    resizeOverlay: async () => undefined, setOverlayMode: async () => undefined,
    setOverlayOpacity: async () => undefined, setOverlayCollapsed: async () => undefined,
    setOverlayLayout: async () => undefined, openPagesWindow: async () => undefined,
    windowControl: async () => undefined, showCallWindow: async () => undefined,
    closeCompactView: async () => undefined, openCompactView: async () => undefined,
    minimizeMainWindow: () => undefined, setCallActive: () => undefined,
    getShareProtection: async () => ({ on: true, supported: true, scope: 'all' }),
    setShareProtection: async (on) => ({ on, supported: true, scope: 'all' }),
    checkHotkeys: async () => [], setHotkeysEnabled: async () => [], onHotkey: () => undefined,
    onSnapZone: () => () => undefined,
    setOverlayClickThrough: async () => undefined, releaseOverlayFocus: async () => undefined,
    getOverlayPosition: async () => 'top-center', setOverlayPosition: async () => undefined,
    onOverlayPosition: () => () => undefined, moveOverlay: async () => undefined,
    setChatHotkey: async () => undefined, setVoiceCancelHotkey: async () => undefined,
  });
`;

/**
 * Saves a capture of a page.
 *
 * @param page The page.
 * @param name The capture's name.
 * @returns When saved.
 */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.info(`  captured ${name}`);
}

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

/** The rig page's window. */
interface RigWindow {
  /** The rig's controls. */
  rig: RigControls;
}

/**
 * Feeds a line to the simulated call (window.rig in rig-live.tsx).
 *
 * @param call    The call's page.
 * @param speaker Who spoke.
 * @param text    What they said.
 * @returns When done.
 */
async function say(call: Page, speaker: 'them' | 'you', text: string): Promise<void> {
  await call.evaluate(([who, words]) => (window as unknown as RigWindow).rig.say(who!, words!), [
    speaker,
    text,
  ] as const);
  await call.waitForTimeout(3_200);
}

/**
 * Opens the overlay for the rig's session, on the backdrop.
 *
 * @param page   A page of the call's context.
 * @param height The window's height.
 * @returns When it shows its bars.
 */
async function openOverlay(page: Page, height: number): Promise<void> {
  await page.setViewportSize({ width: WIDTH, height });
  await page.goto(`${RIG}/compact/harness-session`);
  await page.getByRole('toolbar', { name: 'Overlay controls' }).waitFor();
  await page.evaluate((image) => {
    document.documentElement.style.backgroundImage = image;
    document.documentElement.style.backgroundAttachment = 'fixed';
  }, BACKDROP);
}

/**
 * Runs the captures.
 *
 * @returns When done.
 */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
    });
    await context.addInitScript(FAKE_SHELL);
    const call = await context.newPage();
    await call.goto(`${RIG}/`);
    await call
      .getByRole('button', { name: /^Answer/ })
      .first()
      .waitFor();
    await say(call, 'them', 'THANKS FOR JOINING LET US START WITH YOUR BACKGROUND');
    await say(call, 'you', 'SURE I HAVE BEEN WORKING ON ROUTE PLANNING FOR FOUR YEARS');

    const overlay = await context.newPage();
    await openOverlay(overlay, 150);
    await shot(overlay, '1-bars');

    // The other side cannot be heard: the call page with the notice.
    await call.goto(`${RIG}/?notice=them-silent`);
    await call
      .getByRole('button', { name: /^Answer/ })
      .first()
      .waitFor();
    await say(call, 'them', 'CAN YOU HEAR ME');
    await overlay.waitForTimeout(800);
    await shot(overlay, '2-cant-hear-warning');
    await call.goto(`${RIG}/`);
    await call
      .getByRole('button', { name: /^Answer/ })
      .first()
      .waitFor();
    await say(call, 'them', 'TELL ME ABOUT A TIME YOU LED A MIGRATION');

    // A voice question: Ctrl+Shift+Space (in the version before: the chat bar with the microphone, by
    // pressing it twice).
    await overlay.bringToFront();
    await overlay.locator('body').click({ position: { x: WIDTH - 260, y: 20 } });
    await overlay.keyboard.press('Control+Shift+Space');
    await overlay.waitForTimeout(150);
    if ((await overlay.getByText('Listening… (Esc cancels)').count()) === 0) {
      await overlay.keyboard.press('Control+Shift+Space');
    }
    await overlay.setViewportSize({ width: WIDTH, height: 150 });
    await shot(overlay, '3-voice-question');
    await overlay.keyboard.press('Escape');
    if ((await overlay.getByRole('button', { name: 'Close chat' }).count()) > 0) {
      await overlay.getByRole('button', { name: 'Close chat' }).click();
    }

    // An answer (Ctrl+Enter), then Ctrl+Backspace.
    await say(call, 'them', 'HOW WOULD YOU DESIGN A VOICE AGENT FOR A HOSPITAL');
    await overlay.setViewportSize({ width: WIDTH, height: 520 });
    await overlay.keyboard.press('Control+Enter');
    await overlay.getByRole('heading', { name: 'Answer line' }).waitFor({ timeout: 15_000 });
    await overlay.waitForTimeout(2_500);
    await shot(overlay, '4-answer');
    await overlay.keyboard.press('Control+Backspace');
    await overlay.waitForTimeout(800);
    await shot(overlay, '5-after-ctrl-backspace');
    await context.close();

    // The launcher: choose a session.
    const home = await browser.newContext({
      viewport: { width: 560, height: 720 },
      colorScheme: 'light',
    });
    await home.addInitScript(FAKE_SHELL);
    const panel = await home.newPage();
    await panel.goto(`${RIG}/home?launcher=1`);
    await panel
      .getByText('Bluefin Logistics')
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 15_000 });
    // The one-time acceptable-use notice, if it shows.
    const gotIt = panel.getByRole('button', { name: 'Got it' });
    if ((await gotIt.count()) > 0) await gotIt.click();
    await shot(panel, '6-launcher-sessions');
    await panel
      .getByRole('button', { name: /^Start/ })
      .filter({ visible: true })
      .first()
      .click();
    await panel.waitForTimeout(800);
    await shot(panel, '7-after-choosing-a-session');
    await home.close();
  } finally {
    await browser.close();
  }
}

await main();
