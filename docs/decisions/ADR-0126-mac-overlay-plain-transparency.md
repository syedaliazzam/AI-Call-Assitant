# ADR-0126: The Mac overlay is plainly see-through (no vibrancy)

- **Status:** Accepted (26 Nov 2026, the developer's follow-up release brief, Fix 2)
- **Date:** 2026-11-26
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (compact view) (version 4.64.0)
- **Supersedes / superseded by:** amends ADR-0035 §1 ("vibrancy on macOS") and ADR-0039 §2 ("macOS keeps vibrancy"). Desktop shell only, macOS only: Mac 1.8.0 (not yet published). Windows unchanged.

## Context

A teammate on macOS in dark mode saw no meeting behind the overlay, even at 40 % opacity. `overlayGlass()` in `apps/desktop/src/windows.ts` gave macOS `vibrancy: 'hud'` with `visualEffectState: 'active'`. That fills the whole window with a frosted, blurred material: dark in dark mode, and fully opaque when macOS's "Reduce transparency" is on. The page's own panels (40–100 % background, the opacity slider) sit on top of that material, so the slider changed nothing the user could see. ADR-0039 removed the same kind of problem on Windows (acrylic) in v1.0.3.

## Decision

1. **macOS uses plain transparency, as Windows does:** `transparent: true`, `backgroundColor: '#00000000'`, not maximisable or full-screen, **no** `vibrancy` and **no** `visualEffectState`. Wherever the page paints nothing the meeting shows, and the panels' opacity slider decides how much of it shows behind them.
2. **macOS keeps its shadow** (`hasShadow` left at its default). macOS draws it from the painted content, so it follows the rounded panels (Windows and Linux keep `hasShadow: false`: their shadow is a rectangle). If the real-Mac test shows a stale shadow outline after the panels change size, the fallback is `hasShadow: false` on macOS too (one line; not needed until seen).
3. **Windows and Linux are unchanged** (the same options as before, now built from the same `clear` object).
4. **Themes:** no change. The web app paints System from `prefers-color-scheme` and follows changes live (`ThemeSync.tsx`, `useAppearance.ts`); the shell never sets `nativeTheme.themeSource`, so Electron stays on "system" and follows macOS's appearance. The real-Mac test checks it on the dashboard, Settings and the overlay.

## Consequences

- On a Mac the overlay looks like the Windows one: the meeting shows behind the panels at the slider's opacity, in light and dark mode, with "Reduce transparency" on or off (that setting affects system materials, which the overlay no longer uses).
- No blur behind the panels on a Mac. Readability rests on the panels' tint and the text shadow, as on Windows since ADR-0039.
- The Mac build must come from a commit that has this change (`docs/testing/mac-release-test.md` names it).

## Alternatives considered

- **Keep vibrancy and lower its strength:** Electron offers no strength setting; every material fills the window, and "Reduce transparency" makes it opaque.
- **Vibrancy only behind the panels:** Electron applies vibrancy to the whole window, not to parts of the page.
- **Turn vibrancy off only in dark mode:** the material also hid the meeting in light mode (lighter, but still not see-through) and with "Reduce transparency".

## Validation

- Unit: `apps/desktop/tests/unit/windows.test.ts`: `overlayGlass('darwin')` and `overlayGlass('win32')` give exactly the expected options; `compactWindowOptions` on darwin has no vibrancy, no `visualEffectState` and a clear background.
- Real Mac (tonight's test, `docs/testing/mac-release-test.md`): the meeting shows behind the overlay at 40 % in dark mode and light mode, with "Reduce transparency" on and off; the shadow follows the panels; System follows the Mac's appearance.
