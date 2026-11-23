# ADR-0071: Sign-in redesign and the dashboard's session cards in the desktop app

- **Status:** Accepted
- **Date:** 2026-11-11
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Sign in, Home panel), 4.12.0
- **Supersedes / superseded by:** amends ADR-0055 (the desktop "Your sessions" card: no search, no
  Create session, no Buy credits on that card, nothing edits a session)

## Context

Two screens no longer matched the product.

- **Sign-in** still had a plain black panel and the line "Sessions are saved on this computer · Audio
  never leaves it", which has been wrong since account sync went live for everyone (ADR-0049, 4.0.0).
  The form had a single error line, no way to see the password, no help for a forgotten password, and
  nothing pointing a new person to the desktop app. Chrome painted autofilled fields pale blue.
- **The desktop "Your sessions" card** (ADR-0055) listed sessions as compact rows. With many
  sessions it could not be searched, and to create one the person had to find the dashboard themselves.
  The rows did not show how a call went (length, answers) the way the dashboard's cards do.

## Decision

Web only. The desktop shell does not change: every link opens in the system browser already
(`openInSystemBrowser`), and Buy credits, search and the cards are page code.

**Sign-in** (`src/ui/AuthCard.tsx`, `src/features/auth/`)

- A light left panel (`.k-auth-hero`: the session card's inner grey #F6F6F7, its faint #71717A dot grid,
  a soft white glow; the dark theme's surface in dark): the logo, a "Live call assistant" label, the
  headline "Answers while you talk.", a still product preview, three feature rows, and the line
  "Sessions sync to your account · Audio never leaves your computer". The change-password page shares it.
- The preview (`SignInHero.tsx`) is drawn with the call bars' own pieces (`pieceClass`, `PILL`,
  `KeyChip`, `StatusIcon`) and `AnswerBody`, with invented words. It is one `role="img"` with nothing
  focusable.
- The form: title 24/500; Email and Password in the app's field style (44 px); messages under each
  field, checked before anything is sent (`signInFieldErrors` in `core/auth/messages.ts`); one message
  at the top for a refused sign-in (the same for a wrong email or password, as before); a show/hide
  password button (`Input` gets an `end` slot); "Forgot password? Ask your admin to reset it."; a
  full-width 52 px Sign in with a spinner. PR #32 stays: the form posts, and Sign in is disabled until
  the page is hydrated.
- Autofill: an inset shadow in the field's own colour covers Chrome's blue, with the focus ring added
  back (global, so every form gets it).
- Under the card, "Get the desktop app" downloads the newest Windows installer directly through
  `/download/windows`, in the same tab (ADR-0114, 23 Nov 2026; the route reads the installer's
  versioned name from the release's `latest.yml`). Until then it opened the releases page
  (`releases/latest`), because the versioned name gives no stable direct file link. Hidden inside the
  desktop app.
- Below 900 px the left panel is hidden and the logo sits above the card.

**Desktop "Your sessions"** (`src/features/home/LauncherSessions.tsx`)

- Buy credits shows on every card of the launcher, the sessions card too (still only the toast "Not
  needed, your team account is unlimited.").
- A search box ("Search by title or description": the card's title, its role or topic line, and the
  description) joined to a sort button (newest, oldest, A–Z), the dashboard's own control, now shared
  (`features/dashboard/SessionSearch.tsx`).
- The list uses the dashboard's session card (`SessionCardFrame`, extracted from `SessionCard`), one
  column: date, ⋮ (View in dashboard ↗, Delete with a confirmation), logo tile, title, role, chips,
  status and usage line ("4m 26s · 12 answers"), and Start session (the Start card) or View transcript
  (the session's page in the browser). The browser's session stays first, edged in green, "From your
  browser".
- A bar stuck to the bottom: "View in Dashboard ↗" and "+ Create session" (green), replacing "Open
  dashboard". Create session opens `/dashboard?create=1`, a new address that redirects to
  `/sessions/new?type=interview` (Create session as a modal over the sessions page); `/dashboard` alone
  redirects to `/`.
- Delete from the desktop app uses `deleteSession`, which account sync carries to the account.

## Consequences

- One session card everywhere; a later change to the card reaches both places.
- The desktop app can now delete a session. This is the only edit it makes; Edit, Rename and Duplicate
  stay in the dashboard.
- The theme still follows the ⋮ menu's choice in the launcher (light by default); the window was
  designed and checked in light.
- Installed 1.5.x shells get all of this with the next web deploy; no desktop release.

## Alternatives considered

- **Mount the real `ControlBar` in the sign-in preview.** It needs call state and commands and would
  register key handlers on the sign-in page; the shared pieces give the same look without them.
- **Point Create session at `/sessions/new` directly.** It works, but `/dashboard?create=1` is a stable
  address that does not tie the desktop app to the wizard's route.
- **Force the light theme in the launcher.** It would make the menu's Theme choice do nothing there.

## Validation

- Unit: `tests/unit/core/auth/messages.test.ts`, `tests/unit/features/auth/LoginForm.test.tsx`,
  `tests/unit/features/home/launcher.test.ts` (search, sort, the browser's session first).
- Harness: `screens.spec.ts` (sign-in light and dark at 1440 and 390, field messages, show/hide, a
  refused sign-in), `launcher.spec.ts` (cards, search, sort, ⋮, Delete, Buy credits' toast, the bottom
  bar, the empty state).
- Visual pairs: sign-in before and after; the sessions card before and after (560 × 720). The reference
  `docs/design/references/v1.2/desktop-sessions-card.png` was not on disk; the card was matched to the
  dashboard's `active sessions.png` and the header to `first desktop app card appear.jpeg`.
