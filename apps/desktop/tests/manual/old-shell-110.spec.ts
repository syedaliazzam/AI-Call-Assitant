/**
 * Compatibility test (v1.2.0, ADR-0045): a real 1.1.0 desktop app against the new web app, as people who
 * have not updated yet will run it. Covers: the home panel opens first; a call runs, with the bars in the
 * window that shell gives them, nothing cut off; compact collapses to bar 1 because that shell has no
 * icon; the chat bar opens and sends; the ⋮ menu works, Answer preferences too; Exit asks first, and the
 * overlay closes when the call ends.
 * Takes a copy of the old app, always on a temporary profile, against the visual rig
 * (apps/web/tests/visual/overlay-rig.ts). All text is invented.
 *
 * It never sends a screenshot: that would capture the real screen of the computer it runs on.
 *
 * Manual run, not part of the automated suites: it needs the old app. Usage: start the rig, then
 * KITE_OLD_SHELL_EXE=<path to the 1.1.0 Kite.exe> pnpm --filter @kite/desktop exec playwright test
 * -c playwright.manual.config.ts old-shell-110.spec.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/** The rig: the new web app with a mocked /api/answer. */
const RIG = 'http://localhost:3123';

/** The old app. */
const OLD_SHELL = process.env.KITE_OLD_SHELL_EXE;

/** The rig page's controls. */
interface RigWindow {
  /** The controls. */
  rig: {
    /**
     * Feeds a line as the speech engine would.
     *
     * @param speaker 'them' or 'you'.
     * @param text    What they said.
     */
    say: (speaker: string, text: string) => void;
  };
}

/** The part of the shell's bridge called here. */
interface ShellWindow {
  /** The bridge. */
  kiteDesktop: {
    /**
     * Opens a page in the main window.
     *
     * @param where The page.
     * @returns Resolves when done.
     */
    openPagesWindow: (where: string) => Promise<void>;
    /**
     * Closes the overlay.
     *
     * @returns Resolves when done.
     */
    closeCompactView: () => Promise<void>;
  };
}

test('a 1.1.0 shell keeps working with the new web app', async () => {
  test.skip(!OLD_SHELL, 'KITE_OLD_SHELL_EXE names the 1.1.0 Kite.exe');
  // ELECTRON_RUN_AS_NODE would make it plain Node.js (the editor sets it for its children).
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  const app = await electron.launch({
    executablePath: OLD_SHELL!,
    args: [`--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'kite-old-shell-110-'))}`],
    env: {
      ...parentEnv,
      KITE_URL: `${RIG}/`,
      KITE_NO_UPDATE_CHECK: '1',
      KITE_TEST_NO_EXTERNAL_OPEN: '1',
    },
  });
  try {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getVersion())).toBe('1.1.0');
    // The home panel first, drawn by the new web app. This shell has none of 1.2.0's calls.
    const home = await app.firstWindow();
    await home.waitForLoadState();
    expect(new URL(home.url()).pathname).toBe('/home');
    const bridge = await home.evaluate(() =>
      Object.keys((window as never as { kiteDesktop: object }).kiteDesktop),
    );
    expect(bridge).toContain('setOverlayLayout');
    expect(bridge).not.toContain('moveOverlay');
    expect(bridge).not.toContain('setChatHotkey');
    expect(bridge).not.toContain('pickHandoffFile');

    // The call: the main window, then the overlay.
    const opening = app.waitForEvent('window');
    await home.evaluate(() => (window as never as ShellWindow).kiteDesktop.openPagesWindow('/'));
    const main = await opening;
    await main.waitForLoadState();
    await expect(main.getByRole('toolbar', { name: 'Call controls' })).toBeVisible();
    /**
     * Finds the overlay's window.
     *
     * @returns The page, if it is open.
     */
    const findOverlay = () =>
      app.windows().find((window) => new URL(window.url()).pathname.startsWith('/compact/'));
    if (!findOverlay()) {
      const overlayOpening = app.waitForEvent('window');
      await main.getByRole('button', { name: 'Back to compact' }).click();
      await overlayOpening;
    }
    await expect.poll(() => Boolean(findOverlay())).toBe(true);
    const overlay = findOverlay()!;
    await overlay.waitForLoadState();
    const bar = overlay.getByRole('toolbar', { name: 'Overlay controls' });
    await expect(bar).toBeVisible();

    // The real window this shell made: the page asked for what its bars need, and got it.
    await overlay.evaluate(() => localStorage.removeItem('kite.overlayPanels'));
    await overlay.reload();
    await expect(bar).toBeVisible();
    const strip = overlay.getByRole('region', { name: 'Live transcript bar' });
    await expect(strip).toBeVisible();
    await expect
      .poll(async () =>
        overlay.evaluate(() => {
          const region = document.querySelector('[aria-label="Live transcript bar"]');
          return (region?.getBoundingClientRect().bottom ?? 1e6) <= window.innerHeight;
        }),
      )
      .toBe(true);
    const barFits = await bar.evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(barFits, 'bar 1 fits the window this shell gives it').toBe(true);

    // Compact collapses, because this shell cannot make the icon.
    await expect(overlay.getByRole('button', { name: 'Shrink to an icon' })).toHaveCount(0);
    /**
     * The overlay's height, from the shell.
     *
     * @returns The height.
     */
    const height = () =>
      app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.isAlwaysOnTop())
            ?.getBounds().height ?? 0,
      );
    const open = await height();
    await overlay.getByRole('button', { name: 'Collapse the overlay' }).click();
    await expect.poll(height).toBeLessThan(open);
    await overlay.getByRole('button', { name: 'Open the overlay' }).click();
    await expect.poll(height).toBeGreaterThanOrEqual(open);

    // The chat bar opens with room for it, and sends: the answer opens its panel.
    await main.evaluate(() =>
      (window as never as RigWindow).rig.say(
        'them',
        'HOW WOULD YOU DESIGN A VOICE AGENT FOR A HOSPITAL',
      ),
    );
    await overlay.getByRole('button', { name: /^Chat/ }).click();
    const chat = overlay.getByRole('group', { name: 'Chat' });
    await expect(chat).toBeVisible();
    await chat.getByLabel('Type a question').fill('How would you design a voice agent?');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    const answer = overlay.getByRole('region', { name: 'Latest answer' });
    await expect(answer.getByLabel('Answer line')).toContainText('Start from latency');
    const fits = await overlay.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight + 1,
    );
    expect(fits, 'the window does not scroll').toBe(true);

    // The menu, and what it opens, work on this shell.
    await overlay.getByRole('button', { name: 'Overlay menu' }).click();
    const menu = overlay.getByRole('group', { name: 'Overlay settings' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Get help' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Open call window' })).toBeVisible();
    await menu.getByRole('button', { name: 'Answer preferences', exact: true }).click();
    await expect(overlay.getByRole('group', { name: 'Answer preferences' })).toBeVisible();
    await overlay.keyboard.press('Escape');

    // Exit asks first. The rig's End does nothing, so the test then makes the call a real live page
    // makes when a call ends, on this shell.
    await overlay.getByRole('button', { name: 'Exit: end call' }).click();
    await overlay.getByRole('button', { name: 'End call?' }).click();
    await main.evaluate(() => (window as never as ShellWindow).kiteDesktop.closeCompactView());
    await expect.poll(() => Boolean(findOverlay()), { timeout: 15_000 }).toBe(false);
    console.log('[old shell] 1.1.0 works with the new web app');
  } finally {
    await app.close().catch(() => undefined);
  }
});
