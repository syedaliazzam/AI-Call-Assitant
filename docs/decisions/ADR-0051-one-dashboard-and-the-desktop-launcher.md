# ADR-0051: One dashboard, and a launcher in the desktop app

- **Status:** Accepted (developer, 8 Nov 2026)
- **Date:** 2026-11-08
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Home panel, Dashboard), §7.3
- **Supersedes / superseded by:** replaces the dashboard part of ADR-0041 (the home panel as a second place to manage sessions) for accounts with account sync. Rolled out with ADR-0049's accountSync switch.

## Context

The desktop app had a dashboard of its own: the home panel (search, cards with Edit, Rename, Duplicate, Delete, Create session) and the dashboard pages in its main window. With ADR-0049 every device shows the same sessions, so a second dashboard only adds a second place to do the same things. The team wants one dashboard, in the browser.

## Decision

For an account with account sync, `/home` in the desktop app is a **launcher**:

- **Ready sessions from the account** (not ended), newest first, each with **Start** only. Start opens the start card (S10), then the call.
- **"Call ended · <name> · View notes"** for a call that ended in the last 2 hours.
- **Open dashboard.**
- **⋮:** account, Dashboard, Get help, Private, Zoom, theme, Log out.
- **The sign-in page** when signed out (unchanged).
- **No search, no Create session, no card menu, no dashboard pages** in the app's own windows.

**Open dashboard, View notes, Dashboard ↗** (launcher, overlay ⋮), **Get help** and **Edit session** (overlay ⋮, call window) open the web app in the system browser with `window.open`. The shell already sends every `window.open` there (`security.ts`).

- Installed desktop apps load the `vercel.app` address (ADR-0047), so links from it go to `https://call.paramountintelligence.co`.
- Links from any other address stay on that address (`features/sync/dashboardLink.ts`).
- The browser has its own sign-in, so someone signs in there once.

**Web only.** It is the same `/home` page, so desktop 1.2.0 shells get the launcher as soon as the web app is deployed. Accounts without the switch keep the full home panel.

## Consequences

- One place to create, edit and delete sessions; the desktop app is for calls.
- Editing a session during a call happens in the browser. The call keeps the details it started with, as before when editing in another window.
- The desktop's main window is still used for the call itself (the overlay, the full call window); it no longer shows dashboard pages.
- A session that is still marked live after a crash shows as ready until the 12-hour rule ends it, as on the dashboard.

## Alternatives considered

- **Keep both dashboards:** two places to do the same thing, and two sets of screens to keep working.
- **Open the dashboard inside the desktop app:** it would still be a second dashboard, on another address with its own sign-in (ADR-0047).
- **A launcher with search:** the ready list is short; searching belongs to the dashboard.

## Validation

- `tests/unit/features/sync/dashboardLink.test.ts`.
- `tests/e2e-prod/launcher.spec.ts`: this checkout's shell (shell code identical to 1.2.0) against production, temporary profile, test account. It checks the ready list, the last call, no search or create, the links' addresses (`window.open` replaced in the panel) and Start.
- `tests/e2e-prod/sync-devices.spec.ts` shows the same sessions on the launcher.
