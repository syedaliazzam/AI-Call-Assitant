# ADR-0055: The desktop flow and call UI match the reference app

- **Status:** Accepted (developer: "go live", 9 Nov 2026); shipped to everyone in release 1.3.0; amended 26 Nov 2026 (Click-through covers the whole overlay, see the end)
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
7. **The logo** is the company mark (`images/logo-mark.png`, `BRAND_LOGO_SRC`), one swappable file; favicons and desktop icons come from it (`scripts/make-brand.ts`). No parrot or mascot image is used anywhere.

## Consequences

- One click less confusion: the desktop app has no dashboard to wander into; everything outside a call opens in the browser, where the person may need to sign in once.
- The desktop card window is wider (560) in 1.3.0; a 1.2.0 shell keeps 400 and the cards fit it, with Buy credits' words hidden.
- In 1.2.0 the main window shows "Connecting your call…" in front until the call starts, then minimises, as before.
- Notes still need the main window's page to finish after End (about 10 s); it closes itself after that.
- Windows' own "Restart now / Later" update question is drawn by Windows and is not covered by Private; it appears only between calls.
- A new original logo replaces `images/logo-mark.png` later (then run `pnpm --filter web make-brand`).

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

## Amendment (26 Nov 2026): Click-through covers the whole overlay

**Context.** With Click-through on (W on bar 1, ⋮, Ctrl+Alt+X; on a Mac ⌘ ⌥ X), clicks passed through the answer and transcript panels but not through bar 1, bar 2, the chat bar or the script bar (v1.3.2 kept the bars clickable so the mouse could turn the mode off). A teammate on a Mac could not click a meeting app's button behind the bars.

**Decision** (the developer's brief of 26 Nov 2026; web app only, through the same pass-through as above, `setOverlayClickThrough` → `setIgnoreMouseEvents(true, { forward: true })`):

1. **The whole overlay passes every click** while Click-through is on: both bars, the chat bar, the slim script bar, the panels and W's own spot (`overlay/useClickThrough.ts` `passesThrough`). The page tells the shell at once, without waiting for a pointer move (on Windows a press on bar 1's drag area sends the page no move first). Nothing in the overlay reacts to the pointer meanwhile and nothing is a drag area (`theme.css` `.k-pass-all`), so no hover colours, tooltips or window drags on buttons that cannot be pressed. A menu opened by a shortcut (Rec's consent) still takes its clicks.
2. **Only the shortcut turns it off from the overlay:** Ctrl+Alt+X (⌘ ⌥ X), a global shortcut held during the call, so it works while another app has focus. The icon still always takes its clicks (unchanged).
3. **Safety nets, so nobody is stuck:**
   - (a) bar 1 shows, in place of Chat, AA, the model chip and W, a hint that takes no clicks: **"Click-through on — press Ctrl+Alt+X to turn off"** (⌘ ⌥ X on a Mac; `overlay/clickThroughHint.ts`);
   - (b) the call window (the main Paramount AI window's live page) shows "Click-through is on…" with a **Turn click-through off** button (`LiveAnswers.tsx`);
   - (c) it turns off by itself when the call ends (the live page resets it as soon as the call is ending, and the last state the overlay hears says off);
   - (d) Settings › Hotkeys warns when another app holds that shortcut. **While another app holds it in a call** (the shell reports it as taken), Click-through keeps the bars clickable as in v1.3.2, so W turns it off (`CompactState.clickThroughKeyTaken`). On a Mac, macOS may not report a clash; (b) and (c) still apply.
   - A newer shell also has a tray (menu bar) item **Turn click-through off** during a call (`tray.ts`; it sends the page `click-through-off`): desktop 1.8.0 on a Mac, and listed for the next Windows desktop release.
4. **Click-through off is unchanged:** gaps pass, bars and panels take their clicks.

**Compatibility.** No new shell capability is needed: every shell from 1.3.0 already passes the whole window while the page asks it to (`setClickThrough`), so the Windows 1.7.4 app gets the new behaviour from the web app alone, including the hint, the call window's button, the auto-off and the taken-key fallback (1.7.4 already reports taken shortcuts with their actions). Only the tray item needs a new shell; an older shell simply has none.

**Validation.** Unit: `useClickThrough` (`passesThrough` in both modes and with the key taken), `clickThroughHint`, `StatusBar` (bar 1: the hint in place of the controls; W as before when off or with the key taken), `HotkeyList` (the clash warning), `platform/desktop` (taken actions), desktop `tray` and `hotkeys` (the tray item during a call). Harness: `test:live-ui` (the whole overlay passes at once, stays passing over bar 1 and the panels, no tooltips or drag areas; off: bar 1 takes clicks; key taken: bars take clicks), `answers.spec.ts` (the call window's button and the call ending turn it off). Real machines: `docs/testing/mac-release-test.md` (Mac) and the Windows checklist in the runbook.
