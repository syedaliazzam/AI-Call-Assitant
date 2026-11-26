# Overlay before and after "overlay fixes 2" (ADR-0124 and ADR-0119 amended), 27 Nov 2026

**What changed:**
- **ADR-0124 amended (Fix 1):** the answer follows the overlay's position again. On a left position it lines up on the bars' left edge, on a right position on their right edge, centred in the middle; top and bottom rows alike. Before, the answer alone was centred on every position.
- **ADR-0119 amended (Fix 3):** opening the transcript opens the answer beside it. The pair is one row about 1.4 × the bars' width (at least 720 px), the transcript about a third. The overlay window grows for the row on the side its position allows, and the bars do not move or change. Closing the transcript narrows the window back.
- Fix 2 (ADR-0123 amended: on your own, Ctrl+Enter answers whatever you said) has no picture; it is covered by `sim-calls.spec.ts`.

**Code:**
- **before:** `main` @ `b4bb753` (production's code: production is `3b05780`, and the two differ only in docs).
- **after:** branch `overlay-fixes-2`.

**How they were made:**
- **Test:** `apps/web/tests/integration/live.spec.ts`, "ADR-0119 / ADR-0124 amended pictures". It runs only with `KITE_SCREENSHOT_DIR` set. The "before" set ran the same test file against `b4bb753` in a temporary worktree.
- **The screen:** a page as large as the screen (1280 × 800, 1440 × 900, 1920 × 1080 CSS px, 100 % scaling). The overlay window is an iframe at its position, 16 px from the edges, as the desktop app places it, at the app's default width for that screen: 640 for 1280 and 1440, 768 for 1920 (40 % of the work area, 640–960).
- **The window's growth:** the page asks the shell for resize steps. Here the test plays the shell: it widens the iframe by what the steps ask and moves its left edge for the 'w' steps, as `resizeBounds()` in `apps/desktop/src/windows.ts` does. "Before" sends no steps, so its window keeps its width.
- **Harness:** the integration harness's desktop overlay with invented data, no real call. Rec off, Click-through not shown, so bar 1 fits a 640 window here (605 px). The frame is 560 px tall: a browser page does not fit its height to the content as the desktop shell does.
- **Machine:** headless Chromium (Playwright) on the developer's Windows 11 laptop, Windows user agent, device scale 1.

**Measured** (`before/measurements.json`, `after/measurements.json`, CSS px; the same at all six positions):

| Screen | Window | Transcript | Before: row / transcript / answer | After: window / row / transcript / answer | Answer alone, distance from the bars' edge (left / right positions) |
|---|---|---|---|---|---|
| 1280, 1440 | 640 | open | 640 / 256 / 378 | **847 / 847 / 288 / 553** | |
| 1920 | 768 | open | 720 / 288 / 426 | **847 / 847 / 288 / 553** | |
| all | 640 or 768 | closed | | window unchanged | before 115 px in (centred); **after 0** |

The bars are 605 px in every picture, before and after, open and closed: they never move or change. The row is 1.40 × the bars. With bar 1 squeezed (Rec pill and Click-through in a 640 window), the integration test checks the same: bar 1's width and fit step do not change when the window grows.

**Files** (`before/` and `after/`): `<screen>-<position>-closed.png` (transcript closed, the answer alone) and `<screen>-<position>-open.png` (transcript open), for screens 1280, 1440 and 1920 and the positions top-left, top-center, top-right, bottom-left, bottom-center and bottom-right.
