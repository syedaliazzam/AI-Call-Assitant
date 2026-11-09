# ADR-0057: The reference app's typography and sizes, and four small UI changes

- **Status:** Accepted (released with 1.3.0)
- **Date:** 2026-11-09
- **Architecture reference:** `docs/design/paramount-ai-ui-spec.md` §1 (tokens), §3 (S4, S15); `docs/architecture/kite-architecture-v3.1.md` §9.1
- **Supersedes / superseded by:** changes spec §1's font (Inter → Inter Tight), type scale and button sizes. Web and desktop, every account.

## Context

Before "go live" the developer asked for the reference app's typography, sizes and buttons, from measured styles (captured at a 725 px window) and the screenshots in `docs/design/references/v1.2/`. The measured-styles file was not in the repository, so the numbers come from the developer's own list and the screenshots.

## Decision

1. **Font:** Inter Tight, self-hosted with `next/font` (no request to Google from users' browsers), weights 400, 500, 600. Body 16 / 400 / 24; H1 24 / 500; section headings 16 / 500; buttons and labels 14 / 500 / 20; the selected tab 600.
2. **Buttons** (`src/ui/Button.tsx`): standard 36 tall, padding 8 × 16; large primary 52 tall, padding 0 × 20 (modal footers); icon buttons 36 × 36, round; a subtle shadow on raised buttons. Text buttons keep the 10 px radius, as in the reference's screenshots (Cancel / Next, Start session).
3. **Tabs** 44 tall, padding 12 × 16, radius 14 at the top. **Search** 39 tall, 14 px text, the words 32 px in.
4. **Session cards:** outer radius 48, padding 8 / 8 / 12, 1 px border; the inner grey panel radius 32, padding 12, a light shadow.
5. **Colours** stay the tokens they were: near-black primary with white text, white secondary with a 1 px light-grey border, neutral greys, solid red destructive actions; the accent stays Paramount AI blue.
6. **Small changes:** Create session no longer asks for or shows Contact name (stored values are kept, unchanged); Key terms move into a collapsed **Advanced** section at the bottom of step 1; the model row reads **Select model**; the overlay's transcript lines are 17 / 600 with a 14 px "Name · 12:29 AM" line, You on the right and Them on the left, tighter spacing.
7. **Default themes** stay as ADR-0054 set them: the dashboard light, the call windows (desktop overlay) dark; a saved choice wins.

## Consequences

- Every screen's text is slightly larger (16 px body) and buttons are 4 px shorter; the UI harness tests check the new sizes.
- Harness screenshots load Inter Tight from Google Fonts only while taking pictures (`tests/lib/fonts.ts`); CI makes no such request.

## Alternatives considered

- **Fully round (pill) text buttons:** the reference's buttons have rounded corners, not round ends; only icon buttons are circles.

## Validation

- Unit: the theme tokens (`tests/unit/ui/theme.test.ts`).
- Harness: `ui-kit.spec.ts` (button, label sizes), `setup.spec.ts` (session card radius and padding, Advanced and no Contact name, Select model), `shell.spec.ts`, `live.spec.ts` (transcript 17 / 600, You right); phone width 390 without sideways scroll.
- Visual pairs, light and dark, against the references (`tests/visual/v12-pairs.ts`).
