# ADR-0054: A light dashboard and a dark call view, as two theme settings

- **Status:** Accepted (developer, 9 Nov 2026)
- **Date:** 2026-11-09
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Home panel); `docs/design/paramount-ai-ui-spec.md` §1
- **Supersedes / superseded by:** replaces ADR-0041's "Theme … one setting, default System" (and v1.2.0's one theme on `<html>`).

## Context

Since v1.1.0, one Theme setting (default System) covered the home panel, the overlay and the call window, and from v1.2.0 the web pages too. On a computer set to dark, the dashboard opened dark. If someone chose Light for the dashboard, the overlay turned light during calls too. The reference app keeps the working pages light and the call overlay dark, and each can change without the other.

## Decision

1. **Two settings, both kept in localStorage on the device (not synced to the account):**
   - **Dashboard** (`kite.theme`): the web pages and the desktop home panel. **Light** until chosen. It keeps the key the one theme used before, so an earlier choice (Light, Dark or System) stays.
   - **Call** (`kite.callTheme`): the compact view (desktop bars and the browser's picture-in-picture window), the desktop call window and the browser's call view. **Dark** until chosen.
2. **Where each is changed.** The account menu and the home panel's ⋮ change the dashboard theme. The overlay's ⋮ and the call view's ⋮ change the call theme.
3. **First paint.** The boot script paints `<html>` dark only for Dark, or for System on a computer that prefers dark. Nothing stored means light. Call views paint their own root (`k-dark` / `k-light`), as before.

## Consequences

- With nothing chosen: a light dashboard and a dark overlay, whatever the computer prefers.
- Someone whose computer is dark and who never chose a theme now sees a light dashboard. Choosing System or Dark brings the dark one back.
- Someone who chose Light before keeps a light dashboard, but gets a dark call view until they choose Light in the overlay's ⋮.
- Web only: no shell change. A 1.2.0 shell gets it with the next web deploy.

## Alternatives considered

- **Keep one setting and change its default:** a dashboard set to Light would still turn the overlay light.
- **Move the theme into the account settings (ADR-0049):** a look is per device, like Zoom and text size, and the bars have to paint before any pull.

## Validation

- `tests/unit/core/storage/appearancePrefs.test.ts`: the defaults, the two choices kept apart, an old choice kept, and the boot script.
- `tests/integration/shell.spec.ts`, `live.spec.ts`, `handoff.spec.ts`, `ui-kit.spec.ts`.
