# ADR-0060: The green parrot logo

- **Status:** Accepted (web 9 Nov 2026; desktop icons with 1.3.2)
- **Date:** 2026-11-09
- **Architecture reference:** `docs/design/paramount-ai-ui-spec.md` §0 (what not to copy), §1; `src/ui/brand.ts`
- **Supersedes / superseded by:** changes spec §0's "Do NOT copy their logo, parrot or mascot" **for the logo only**; ADR-0057 / the 1.3.0 checklist's "company logo, no parrot".

## Context

The developer supplied a new logo, `apps/web/public/images/green-logo.png`: a green parrot with "Paramount AI" and a green "AI" badge, in one wide image on white (2172 × 724, no transparency). It resembles the reference app's logo. The developer was told this conflicts with spec §0 and carries a trademark risk, and chose to use it.

## Decision

1. The logo rule changes for the logo only: the product's logo may be the green parrot. Everything else in spec §0 stays: no copied icon artwork, sentences or vendor logos, and no parrot or mascot elsewhere in the interface.
2. `scripts/make-brand.ts` reads `green-logo.png` and writes `images/green-logo-lockup.png` (white margins trimmed, 192 px tall) for the app, and makes every favicon and desktop icon from the parrot alone (the words are unreadable at 16–48 px), on a white square.
3. `BRAND_LOGO_SRC` points at the trimmed logo. Because it already shows the name, the lockup no longer prints "Paramount AI" beside it (`BRAND_LOGO_HAS_NAME`; the name stays for screen readers). The logo is taller than the old mark so its words stay readable, blends its white into light pages, and sits on the existing white tile on dark ones.
4. The desktop app's own icons (taskbar, Start menu, installer) change with the next desktop release, 1.3.2; its window frame and cards show the web lockup, so they change with the web deployment.

## Consequences

- The legal question of the logo's likeness to another company's mark is the developer's.
- There is no vector or transparent version yet: the icons are on white, and the favicon is a PNG inside an SVG.

## Alternatives considered

- A mark that does not resemble the reference app: recommended, declined.

## Validation

Shell, launcher and hand-off harness in light and dark; header and sidebar visual pairs; production serves the new logo and favicon.
