# Overlay before and after ADR-0118 / ADR-0119 (25 Nov 2026)

**What changed:** the transcript bar stays all call with the live words, and warnings move to their own line (ADR-0118). The transcript and the answer sit side by side whenever the window is 600 CSS px or wider (ADR-0119).

**Code:**
- **before:** `mac-internal-release` @ `20f7b6c`;
- **after:** @ `e3be8c0`. The next two commits (ADR-0120's Mac fixes) change nothing these pictures show.

**How they were made:**
- **Test:** `apps/web/tests/integration/live.spec.ts`, "ADR-0118 / ADR-0119 pictures". It runs only with `KITE_SCREENSHOT_DIR` set.
- **Harness:** the integration harness's desktop overlay, with invented data and no real call. It has Rec on, Click-through available and the top-centre position (the bottom-centre pictures are mirrored), over a busy light page.
- **Machine:** headless Chromium (Playwright 1.64.1) on the developer's Windows 11 laptop.
- **Windows pictures:** a Windows user agent, device scale 1.25.
- **Mac pictures:** `navigator.platform` set to MacIntel, a Mac user agent, device scale 2 (Retina). That shows the Mac's keys and words; it is not a real Mac.

**Window widths (CSS px = DIPs at 100 % zoom):**

| Width | Where the desktop app opens at it (40 % of the work area, 640–960) |
|---|---|
| **640** | 13" MacBook Air (work area 1440–1470 pt), 1366 or 1536 DIP Windows laptops, 1920×1080 at 125 % (1536 DIP) |
| **768** | 1920×1080 at 100 % (in `measurements.json` only) |
| **960** | the largest default |

**Measured** (`before/measurements.json`, `after/measurements.json`; Windows and Mac settings gave the same numbers):

| Window | Bar 1 before | Panels before | Bar 1 after | Panels after |
|---|---|---|---|---|
| 640 | 582 px | **stacked**, 584 px wide | 599 px | **side by side**, 640 px (transcript 254, answer 378) |
| 768 | 713 px | side by side, 715 px | 599 px | side by side, 720 px (286 / 426) |
| 960 | 713 px | side by side, 715 px | 599 px | side by side, 720 px (286 / 426) |

Bar 1 is narrower after because its Transcript switch is gone (ADR-0118).

**Files** (each name is in `before/` and `after/`):

| File | What it shows |
|---|---|
| `windows-640-top-center.png` | the 640 default on Windows |
| `mac-640-top-center.png` | the same with the Mac's keys (13" MacBook Air) |
| `windows-640-top-center-them-silent.png` | a warning: before, it replaced the words on bar 2; after, it has its own line |
| `windows-640-bottom-center.png` | the bottom row, mirrored |
| `windows-960-top-center.png` | a wide window: side by side before and after |
