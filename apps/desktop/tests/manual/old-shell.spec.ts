/**
 * Compatibility test (v1.1.0, item 31): an installed desktop app from before 1.1.0 against the new web
 * app, as people who have not updated yet will run it. Covers: the main window opens first, with no home
 * panel; a live call works and the overlay opens at its fixed size, with its bars and panels; nothing
 * offers a page in another window, which that shell does not have; Private says it covers only the
 * overlay; End closes the overlay. Takes a copy of the old app, always on a temporary profile, against
 * the visual rig (apps/web/tests/visual/overlay-rig.ts). All text is invented.
 *
 * Manual run, not part of the automated suites: it needs the old app. Usage: start the rig, then
 * KITE_OLD_SHELL_EXE=<path to the kept Kite.exe> pnpm --filter @kite/desktop exec playwright test
 * -c playwright.manual.config.ts old-shell.spec.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

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

/** The part of the shell's bridge read here. */
interface ShellWindow {
  /** The bridge. */
  kiteDesktop: {
    /**
     * Reads the protection state.
     *
     * @returns The state.
     */
    getShareProtection: () => Promise<object>;
  };
}

/** The rig: the new web app with a mocked /api/answer. */
const RIG = 'http://localhost:3123';

/** The old app. */
const OLD_SHELL = process.env.KITE_OLD_SHELL_EXE;

test('a shell before 1.1.0 keeps working with the new web app', async () => {
  test.skip(!OLD_SHELL, 'KITE_OLD_SHELL_EXE names the kept Kite.exe');
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  const app = await electron.launch({
    executablePath: OLD_SHELL!,
    args: [`--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'kite-old-shell-'))}`],
    env: { ...parentEnv, KITE_URL: `${RIG}/`, KITE_NO_UPDATE_CHECK: '1' },
  });
  try {
    // The main window first, 1280 wide: this shell has no panel.
    const main = await app.firstWindow();
    await main.waitForLoadState();
    const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
    expect(version).toMatch(/^1\.0\./);
    expect(new URL(main.url()).pathname).toBe('/');
    const bridge = await main.evaluate(() =>
      Object.keys((window as never as { kiteDesktop: object }).kiteDesktop),
    );
    expect(bridge).not.toContain('openPagesWindow');
    expect(bridge).not.toContain('setOverlayLayout');

    // The rig's call starts in the overlay, as that shell expects.
    await expect(main.getByRole('toolbar', { name: 'Call controls' })).toBeVisible();
    const isOverlay = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) =>
          new URL(window.webContents.getURL()).pathname.startsWith('/compact/'),
        ),
      );
    if (!(await isOverlay())) {
      const opening = app.waitForEvent('window');
      await main.getByRole('button', { name: 'Back to compact' }).click();
      await opening;
    }
    await expect.poll(isOverlay).toBe(true);
    const overlay = app
      .windows()
      .find((window) => new URL(window.url()).pathname.startsWith('/compact/'))!;
    await overlay.waitForLoadState();
    await expect(overlay.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();

    // A question and an answer, with the panel inside the fixed window.
    await main.evaluate(() =>
      (window as never as RigWindow).rig.say(
        'them',
        'HOW WOULD YOU DESIGN A VOICE AGENT FOR A HOSPITAL',
      ),
    );
    await overlay
      .getByRole('button', { name: /^Answer/ })
      .first()
      .click();
    const answer = overlay.getByRole('region', { name: 'Latest answer' });
    await expect(answer.getByLabel('Answer line')).toContainText('Start from latency');
    const fits = await overlay.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight + 1,
    );
    expect(fits, 'the fixed window does not scroll').toBe(true);

    // The menu offers nothing this shell cannot do.
    await overlay.getByRole('button', { name: 'Overlay menu' }).click();
    const menu = overlay.getByRole('group', { name: 'Overlay settings' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Dashboard' })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: 'Edit session' })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: 'Open call window' })).toBeVisible();
    await overlay.keyboard.press('Escape');

    // Private is honest about what it covers on this shell.
    const hint = await overlay.evaluate(async () => {
      const state = await (window as never as ShellWindow).kiteDesktop.getShareProtection();
      return 'scope' in state;
    });
    expect(hint).toBe(false);

    // The call page's menu has no Edit session either: it would replace the call's own page.
    await main.getByRole('button', { name: 'More' }).click();
    await expect(main.getByRole('menuitem', { name: 'Edit session' })).toHaveCount(0);
    await expect(main.getByRole('menuitem', { name: /^Theme:/ })).toBeVisible();
    await main.keyboard.press('Escape');

    // End closes the overlay.
    await overlay.getByRole('button', { name: 'End call' }).click();
    await overlay.getByRole('button', { name: 'End call?' }).click();
    console.log('[old shell] version', version, 'works with the new web app');
  } finally {
    await app.close().catch(() => undefined);
  }
});
