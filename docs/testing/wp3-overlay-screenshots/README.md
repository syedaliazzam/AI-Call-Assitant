# Overlay before and after WP3 (ADR-0122 to ADR-0124), 25 Nov 2026

**What changed:**
- **ADR-0122:** Chat is back on bar 1 (with its key, Ctrl+Alt+K) and opens a chat bar under bar 1: "Enter a message…", Send, ×.
- **ADR-0123:** the Voice toggle is gone; bar 2 shows a small hint of what Ctrl+Enter answers now (**Them** or **You**).
- **ADR-0124:** side by side, the transcript and the answer are always the same height, and the transcript scrolls inside its panel. The answer alone sits centred under the bars.

**Code:**
- **before:** `mac-internal-release` @ `57e551d`;
- **after:** the ADR-0124 commit on top of it.

**How they were made:**
- **Test:** `apps/web/tests/integration/live.spec.ts`, "WP3 pictures". It runs only with `KITE_SCREENSHOT_DIR` set.
- **Harness:** the integration harness's desktop overlay, with invented data and no real call. Rec off, Click-through available, over a busy light page. A browser page does not fit its height to the content as the desktop shell does, so the panels sit in a 620 px tall page.
- **The hint:** `?press=them` on the top row and `?press=you` on the bottom row. It is "after" only.
- **Machine:** headless Chromium (Playwright 1.64.1) on the developer's Windows 11 laptop, Windows user agent, device scale 1.25.

**Measured** (`before/measurements.json`, `after/measurements.json`, CSS px):

| Window | Panels | Before: transcript / answer height | After: transcript / answer height |
|---|---|---|---|
| 640 | both, top and bottom | 296 / 409 | **409 / 409** |
| 1280 | both, top and bottom | 296 / 380 | **380 / 380** |
| 640, 1280 | answer alone | centred on centre positions | centred (within 1 px) on every position |
| 640, 1280 | chat bar open | (none) | bar 1's width (638 / 771), right under bar 1 (above it on the bottom row) |

Bar 1 is 638 px at 640, with Chat's key-cap given way, and 771 px at 1280 with every key-cap. Before, it was 635 px.

**Files** (each name is in `after/`; the `-chat` ones only there):

| File | What it shows |
|---|---|
| `windows-640-top-center-both.png` | the 640 default, both panels: the same height after |
| `windows-640-top-center-both-chat.png` | the chat bar under bar 1 |
| `windows-640-top-center-answer.png` | the answer alone, centred |
| `windows-640-bottom-center-both.png` | the bottom row, mirrored |
| `windows-640-bottom-center-both-chat.png` | the bottom row with the chat bar (above bar 1) and the **You** hint |
| `windows-1280-…` | the same in a wide window |
