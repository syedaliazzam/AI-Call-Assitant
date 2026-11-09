/**
 * File: apps/web/tests/lib/fonts.ts
 * Purpose: The brand font (Inter Tight, ADR-0057) for the harness pages, only while screenshots are
 *          taken (KITE_SCREENSHOT_DIR): the app self-hosts it with next/font, which the harness bundles
 *          do not run, so the pictures load it from Google Fonts instead. Ordinary test runs (and CI)
 *          make no request to Google and fall back to the system font.
 * Used by: tests/integration (shell, screens, launcher, live, handoff, setup, ui-kit specs),
 *          tests/visual/overlay-rig.ts
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §7; ADR-0057
 */

/**
 * The <head> markup that loads Inter Tight for screenshots, or nothing.
 *
 * @param always True to load it even without KITE_SCREENSHOT_DIR (a visual rig).
 * @returns HTML to put in the page's <head>.
 * Called from: the harness servers in tests/integration and tests/visual
 */
export function brandFonts(always = false): string {
  if (!always && !process.env.KITE_SCREENSHOT_DIR) return '';
  return (
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&display=block">' +
    "<style>:root{--font-inter-tight:'Inter Tight'}</style>"
  );
}
