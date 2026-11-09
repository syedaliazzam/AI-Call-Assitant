# ADR-0058: A green accent, the desktop cards' texture, and motion tokens

- **Status:** Accepted (released with 1.3.1)
- **Date:** 2026-11-09
- **Architecture reference:** `docs/design/paramount-ai-ui-spec.md` §0, §1 (tokens); `docs/architecture/kite-architecture-v3.1.md` §9.1
- **Supersedes / superseded by:** changes spec §0 ("Do NOT copy their green brand colour") and §1's accent (blue `#2563EB`) and ADR-0057 decision 5. Web and desktop, every account.

## Context

For 1.3.1 the developer asked for the reference app's colours and motion: a green accent everywhere the references show green, a few neutral values, the desktop cards' glow and dot texture, and named animation times, all as tokens and respecting "reduce motion". The values came from the developer's list; `parakeet-colours.json` and `parakeet-measurements.json` were not in the repository, so the screenshots in `docs/design/references/v1.2/` decided where green appears. The logo stays the company mark.

## Decision

1. **Green accent** (`src/ui/tokens/theme.css`): `#16A34A` with `#FAFAFA` text, hover `#15803D`, soft `#F0FDF4`. It fills the Create session button, the sidebar's plus tile (soft green with a green plus), switches that are on, the stepper's circles and line, radio dots, the Ready dot, level bars, the Team badge, the gift icon, success toasts and focus rings. Green **text** (links, the "You" label, the Team badge) uses `#15803D`, which passes AA (5.0:1); the fill green is 3.3:1, enough for non-text only.
2. **Neutrals:** page `#FFFFFF`, text `#18181B`, strong text (headings) `#09090B`, muted `#71717A`, border `#E4E4E7`, light button and hover `#F4F4F5`, a card's inner panel `#F6F6F7`. Primary buttons `#18181B` with white text; secondary white with a 1 px `#E4E4E7` border and `#18181B` text; tabs `#18181B` selected and `#71717A` otherwise; chips white with a border and muted text; destructive `#DC2626` with white text.
3. **The dark compact view** (desktop call bars and panels): `#18181B` surfaces, white text, `#A1A1AA` muted, `#22C55E` indicators (switches, level bars, the Auto answer dot). Green text over the see-through panel is `#86EFAC`. The dark dashboard uses `#22C55E` for links, focus and indicators.
4. **Texture:** the desktop cards (Your sessions, Start and its two tiles, Connect) have the inner grey with a faint `#71717A` dot grid (8 px) and a white glow along the top edge (`.k-card-texture`); fainter on dark.
5. **Motion tokens:** `--k-dur` 150 ms (hover colours, switches, card hover shadow, menus, dropdowns, the chat bar), `--k-dur-slow` 200 ms (modals, desktop cards, the tab underline, the stepper line, toasts), press scale 0.98, a 4 px slide for menus (upward on the overlay's bottom row), modals and desktop cards fade in from 98 %, toasts rise 8 px and hide after 3 s (`--k-toast-ms`). The tab underline is one element that slides between tabs; the stepper line fills from the top. In the desktop app, jumps between the six positions slide over 150 ms (`apps/desktop/src/windows.ts`).
6. **Reduce motion:** the operating system's setting turns every duration to 0, the scales to 1 and the slides to 0, and stops the pulsing Live dot (CSS); the desktop's jumps move at once (`systemPreferences.getAnimationSettings().prefersReducedMotion`). The live level bars keep moving: they show sound, not decoration.

## Consequences

- Three values the developer kept fail WCAG AA for text (listed, not changed): `#FAFAFA` on the green button **3.16:1** (AA for large text only); muted `#71717A` on the card's inner panel **4.47:1**; the compact view's `#A1A1AA` over the see-through panel above a white page **3.91:1** at the default 82 % (a text shadow helps; over dark pages it is 6.9:1). `tests/unit/ui/theme.test.ts` pins the first two so a change is noticed.
- One stylesheet still holds every colour and time; `theme.test.ts` refuses hard-coded animation times in components.
- The spec's "do not copy their green" line no longer holds for the colour. Icons, wording, logo and mascot are still never copied.

## Alternatives considered

- **Green text at `#16A34A`:** 3.3:1 on white fails AA for normal text; the darker green keeps links readable and still reads as green.
- **Keeping blue:** the developer asked for green.

## Validation

Unit (`theme.test.ts`: values, AA pins, reduce motion, no hard-coded times), the UI-kit, shell, live and keyboard harnesses (computed colours), visual pairs of the dashboard, Create session, the desktop cards, the compact view and chat bar, and the transcript panel in light and dark (1.3.1 release).
