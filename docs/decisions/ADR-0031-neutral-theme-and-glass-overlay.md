# ADR-0031: Neutral theme and see-through overlay

- **Status:** Accepted (developer, 3 Nov 2026)
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (screens); `docs/design/kite-ui-theme.md`
- **Supersedes / superseded by:** replaces the navy and cyan brand theme of 30 Oct 2026. Layout, flow and hotkeys do not change.

## Context

The developer asked for a neutral, minimal look before v1.0.0, with exact colours, type and radii. The Kite logo stays. One part of the brief cannot be done in page code alone: a web page cannot blur what is behind its window, and the overlay's window was opaque.

## Decision

1. **Theme.** Inter only, a neutral palette, soft radii. All values live in `apps/web/src/ui/theme.css` (see the theme document).
2. **Native glass on the desktop overlay.** The window uses a native material: `backgroundMaterial: 'acrylic'` on Windows and `vibrancy: 'hud'` on macOS. The page paints `rgba(24,24,27,.82)` on top. The browser's picture-in-picture window stays solid, because nothing can show through it.
3. **Default overlay opacity is 1 (was 0.92).** The panel is already see-through. Dimming the whole window as well takes its text below 4.5:1 over a bright background.
4. **Lighter text on glass only.** Over pure white the panel lightens to about `#424244`, where the requested secondary grey `#A1A1AA` is 3.9:1. Text on glass uses `#B4B4BB`, the smallest step that passes. The solid panel keeps `#A1A1AA`.
5. **Text colours beside the requested ones.** `#16A34A` is 3.3:1 on white, so it is used for dots only and text uses `#15803D`. Muted `#71717A` is 4.3:1 on `#F2F2F4`, so text on that background uses the body colour.
6. **Live view stays dark, in neutral greys** (from the overlay's palette), for low glare during calls. The brief gave no colours for it.
7. **Key terms stay on wizard step 2**, under Extra. They were not in the brief's list of rows, but they feed speech-to-text hotwords, so removing them would remove a feature.

## Consequences

- Kite no longer matches the company site's colours; only the logo ties them together.
- The overlay's blur strength is the system's, not exactly 16 px: acrylic and vibrancy do not take a radius. The CSS `blur(16px)` only affects content inside the page.
- Windows draws the window's own corners (about 8 px), so the 16 px panel radius shows a little of the material at the corners.
- On Windows 10 there is no acrylic: the panel shows over black, which is dark and readable.
- The new look reaches desktop users at once for pages. The native material needs the new installer.

## Alternatives considered

- **Transparent window without a material:** tried on 3 Nov 2026. The stripes behind stay sharp, so it is not blurred.
- **Raising the panel to about 0.86 opaque** instead of lightening the secondary text: changes the look of the whole panel to fix one colour.
- **A light live view:** would match the pages, but gives more glare during calls and changes the most-used screen with no colours specified.

## Validation

- `tests/unit/ui/theme.test.ts`: the brief's values, and contrast including overlay text over pure white and pure black.
- `tests/integration/live.spec.ts`: "overlay look" at default and smallest size, over light and dark busy backgrounds.
- Measured on Windows 11 (3 Nov 2026), with a test window using the same options: acrylic blurs what is behind, and the window's edges still resize.
- Still to check: the real overlay page in the installed app (release smoke test), and macOS vibrancy (human check; no Mac here).
