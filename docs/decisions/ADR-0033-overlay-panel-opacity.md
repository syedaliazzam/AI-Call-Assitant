# ADR-0033: Overlay transparency dims the panel, not the window

- **Status:** Accepted (developer, 3 Nov 2026)
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (compact view); `docs/design/kite-ui-theme.md`
- **Supersedes / superseded by:** adjusts ADR-0029 (window opacity) and ADR-0031 (default opacity 1). The overlay structure, hotkeys and tokens are unchanged.

## Context

The overlay's opacity slider dimmed the **whole window** (`BrowserWindow.setOpacity`), which fades the text along with the background. ADR-0031 therefore pinned the default to 1, so the slider was of little use: turning it down made the text hard to read. The developer asked for a usable transparency control — a 40–100% slider, default 70% — where the text stays fully opaque and only the background behind it dims, and asked for the contrast at the 40% minimum to be measured and reported rather than the minimum quietly raised.

## Decision

1. **The slider sets the panel's background opacity, not the window's.** The glass panel's background is `rgba(24, 24, 27, var(--k-overlay-alpha))`, and the slider sets `--k-overlay-alpha` (0.4–1). The window stays fully opaque (`setOverlayOpacity(1)`), so dimming the panel never fades the text.
2. **Default 0.7, minimum 0.4, maximum 1** (`OVERLAY_OPACITY`). The native window material (acrylic/vibrancy, ADR-0031) still provides the blur behind the panel.
3. **The text stays fully opaque, with a shadow.** Overlay text keeps its opaque colours and gains `text-shadow: 0 1px 2px rgba(0,0,0,.6)` so it stays legible as more of the background shows through at lower settings.
4. **Fade on hover** now changes the panel's background opacity (solid under the pointer when fading is on), not the window's.
5. **The minimum is not raised.** At 40% over a bright background the nominal WCAG contrast is low; the text shadow carries legibility there, and the measured numbers are reported below.

## Measured contrast (computed from the theme tokens, WCAG 2.x)

The glass panel is `#18181B` painted at the given background-opacity over the background behind the window. "body" is `--ui-text` `#FAFAFA`, "them" is `--ui-them` `#E4E4E7`, "muted" is `--ui-muted` `#B4B4BB` (secondary text).

| Background opacity | over white (body / them / muted) | over a busy mid-grey | over dark |
|---|---|---|---|
| **0.70 (default)** | **6.26** / 5.15 / 3.17 | 11.3 / 9.33 / 5.74 | 18.1 / 14.9 / 9.16 |
| 0.40 (minimum) | 2.43 / 2.00 / 1.23 | 6.98 / 5.74 / 3.53 | 19.0 / 15.6 / 9.62 |
| 1.00 | 16.97 / 13.96 / 8.59 (any background) | — | — |

- **At the default (0.70):** the primary text passes 4.5:1 over the worst case (pure white) — body 6.26, them 5.15 — and everything passes over busy and dark backgrounds. The secondary muted grey over pure white is 3.17 (shadow-aided).
- **At the minimum (0.40):** over dark and busy backgrounds the primary text still passes (body 6.98 over busy). **Over a bright background it does not** — body is 2.43, them 2.00 — and the text shadow is what keeps it readable. This is reported, not hidden: the minimum stays 0.40 by the developer's choice.

A unit test (`tests/unit/ui/theme.test.ts`) pins the default and minimum, the primary-text passes at the default over white and busy and at the minimum over dark and busy, and the weak bright-background corner at the minimum (so a token or alpha change is caught).

## Consequences

- The slider is now useful: 70% is see-through yet readable, and the user can go more transparent at the cost of contrast over bright backgrounds.
- `--k-overlay-glass` (the old fixed 0.82 panel colour) is no longer what the panel paints; the panel uses the variable alpha. The token stays for reference.
- The browser picture-in-picture panel is solid (`--k-dark-bg`): nothing can show through it, so the slider does not apply there (unchanged).
- Browser split-view panels over the shared-tab preview use the same overlay tokens, translucent, so the preview shows through (ADR companion work on the split view).

## Alternatives considered

- **Keep dimming the window:** rejected — it fades the text (the ADR-0031 problem).
- **Raise the minimum so 4.5:1 always holds:** the developer asked not to; a user who wants more transparency over a dark meeting should be able to choose it, and the shadow aids legibility.
- **A transparent window with a translucent background:** Electron's transparent windows limit resizing (ADR-0029); the native material plus a variable-alpha panel keeps resizing and gives the same effect inside the page.

## Validation

- `tests/unit/ui/theme.test.ts` (the table above and the invariants).
- `tests/integration/live.spec.ts`: the overlay rendered at 40% and 70% over light and dark busy backgrounds (screenshots).
- Human check: the real overlay in the installed app at the minimum setting over light, dark and busy meeting backgrounds (`docs/testing/final-test-plan.md`).
