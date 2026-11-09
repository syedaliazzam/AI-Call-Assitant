# ADR-0055: The desktop flow and call UI match the reference app

- **Status:** Proposed (built and deployed behind the accountSync switch; accepted when the developer says "go live")
- **Date:** 2026-11-09
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §4 (protection), §5 (Home panel, Connect, overlay), §7.3; `docs/design/paramount-ai-ui-spec.md` §3 (S10, S11, S13, S14)
- **Supersedes / superseded by:** refines ADR-0051 (the launcher), ADR-0053 (where the desktop's Connect card is), ADR-0042 (Private covers every window); overrides spec S10's "No Buy credits" and S11's microphone meter on the desktop. Desktop 1.3.0 (draft) and the web app, for accounts with account sync only.

## Context

Before "go live", the developer wants the desktop flow and the call UI to match the reference app: the first card, the Start card, the Connect card, the compact bars, the chat bar, typing behind the bars, and screen-share protection everywhere. The developer also saw the old dashboard in the desktop app while signed in with account sync.

**Why the old dashboard showed:** ADR-0051 changed only `/home`. Start → Continue opened `/live/<id>` in the main window, and `AppShell` drew every signed-in page there (the Connect card and the desktop live view included) inside the full sidebar: Create session, Call Sessions, Resumes and the rest. Its links, and Back / Back to dashboard (`href="/"`), led to the dashboard pages in that window. The accountSync switch never reached `AppShell`.

## Decision

All behind the accountSync switch (accounts without it see no change), in the web app and in desktop 1.3.0.

1. **One dashboard, in the browser.** In a desktop app with the home panel (1.1.0+) and account sync, `AppShell` keeps only the call page, with no header and no sidebar. Any other page opens in the system browser (`call.paramountintelligence.co` from installed apps) and its window closes (`features/shell/desktopPages.ts`, `DesktopAway.tsx`).
2. **The desktop window is a frame with one card at a time** (`features/home/Launcher.tsx`): logo, compact, move, ⋮ and the red close, plus the dark **Buy credits** on the Start and Connect cards. 1.3.0 sizes the window to 560 × 720 (`sizePanel`).
   - **Your sessions:** the account's sessions (the same list as the dashboard, newest first): logo tile, company, role, date and status. The session the browser's link opened comes first, highlighted "From your browser". "Call ended · View notes" sits on top after a call, and Open dashboard at the bottom. Link-code sign-in and the switch-account question (ADR-0052) are unchanged.
   - **Start your session:** "Signed in as <email>", **Free session** (Team, Unlimited · Free, Start free) and **Paid session** (No limit · Included, Buy Credits), Back. **Both Buy credits buttons only show a toast**, "Not needed, your team account is unlimited.": no payment code, route or link exists.
   - **Connect Call Session:** System audio, three tips (How → `/help#zoom`, Watch → `/help#private`, Open → a YouTube search), Back and Connect; "Need it for macOS?" and Back to dashboard under it. No microphone meter or status text; the microphone is picked on the call bar. A missing speech model gets a small dialog (about 204 MB, Download and connect / Cancel, a progress bar), downloaded into the same Cache Storage the engine reads.
3. **Connect starts the call in the main window, from the small window** (`core/live/callStart.ts`). The live page holds the speech engine and the capture, so it still runs the call. The card leaves a 60 s note in localStorage and posts on a BroadcastChannel; the live page connects without a card of its own, reports `connected` or a fixed failure sentence, shows only a status line (`BackgroundCallStatus.tsx`), and after End closes its window once the call's data and notes are saved. Desktop 1.3.0 opens that window minimised (`openCallWindow`, UUID-checked) and does not restore it after End; the panel comes back with "Call ended · View notes". A 1.2.0 shell opens it in front with `openPagesWindow`, and it works the same.
4. **Bars as in the reference:** bar 1 adds a **Transcript** pill with an on/off switch (opens or closes the transcript panel, remembered with the panels); the bars are 900 wide, so every key-cap fits; desktop 1.3.0 opens the overlay 900 wide and widens a saved place once. The **chat bar** is the reference's: dark input, [Ctrl Alt ↵], Send [↵], ✕. The answer-target switch and the microphone button left the bar; voice stays on Ctrl+Shift+Space twice, with a red microphone shown only while it listens.
5. **Typing behind the bars:** the overlay marks its transparent layout boxes `data-gap`. Over a gap, desktop 1.3.0 passes clicks through (`setIgnoreMouseEvents(true, { forward: true })`); over a bar, panel or open menu it takes them again; never for the icon. IPC `kite:overlay-click-through` from the overlay's own page only.
6. **Private covers every window and popup:** every `BrowserWindow` is protected as it is created (`browser-window-created`; attaching is idempotent). In the desktop app, `<select>` lists are drawn in the page and `title` tooltips become `aria-description`, because both were separate system windows that protection does not reach (`platform/desktopDocument.ts`). Nothing is hidden from the taskbar or process lists, and nothing tries to evade monitoring or proctoring tools.
7. **The final logo** (`images/final-logo.png`) is shown everywhere as one lockup; favicons and desktop icons come from its parrot (`scripts/make-brand.ts`).

## Consequences

- One click less confusion: the desktop app has no dashboard to wander into; everything outside a call opens in the browser, where the person may need to sign in once.
- The desktop card window is wider (560) in 1.3.0; a 1.2.0 shell keeps 400 and the cards fit it, with Buy credits' words hidden.
- In 1.2.0 the main window shows "Connecting your call…" in front until the call starts, then minimises, as before.
- Notes still need the main window's page to finish after End (about 10 s); it closes itself after that.
- Windows' own "Restart now / Later" update question is drawn by Windows and is not covered by Private; it appears only between calls.
- The icon-1024 desktop icon is scaled up from a 443 × 504 parrot until a square 1024 px mark exists.

## Alternatives considered

- **Run the call in the small window:** the shell sends hotkeys, screenshots, minimising and the overlay to the main window; moving all of that is a rewrite and breaks 1.2.0.
- **A frameless main window for the Connect card:** a window's frame cannot change after creation, and the main window still shows the full call view.
- **Keep the switch and microphone on the chat bar:** the reference has neither; voice and Ask AI keep their shortcuts.
- **Hide the overlay from capture by other means:** never (CLAUDE.md); `setContentProtection` only.

## Validation

- Unit: `desktopPages`, `launcher` (order, last call), `callStart`, `modelCache`, `useClickThrough`, `desktopDocument`, `headingId`; desktop `home` (sizes), `windows` (900 default, widening, click-through, protection attach), `preload` keys.
- Harness: `test:launcher` (sessions, Start, Connect, model dialog, call start), `test:live-ui` (bar 1 order with Transcript, fits 900 → 460, chat bar), `test:sim-calls` (chat bar and voice).
- Real shell, temporary profiles: `tests/manual/click-through.spec.ts` (real Windows input: a gap click reaches the window behind and typing follows; a bar keeps its click), `tests/manual/protection-chrome.spec.ts` (Chrome's entire-screen capture leaves out a window created after Private was turned on).
- Visual pairs for the Start card, Connect card, bars, chat bar and icon (`tests/visual/v12-pairs.ts`).
- Human: the regression checklist in `docs/testing/v1.3.0-regression-checklist.md`, including the Private matrix (`final-test-plan.md` §3c).
