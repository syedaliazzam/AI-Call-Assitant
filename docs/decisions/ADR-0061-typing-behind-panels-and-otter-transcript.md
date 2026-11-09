# ADR-0061: Typing behind the open panels, and the transcript as an Otter export

- **Status:** Accepted (web and desktop 1.3.2)
- **Date:** 2026-11-09
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (overlay, session review), §7.3 (`windows.ts`, `hotkeys.ts`), §7.4 (`answers.sourceLineId`); `docs/design/paramount-ai-ui-spec.md` S13, S15, S16, S17, §4
- **Supersedes / superseded by:** extends ADR-0055 (click-through over the gaps); replaces the chat-bubble transcript of v1.0.2 / ADR-0041 on screen and the line-per-row downloads of v1.1.0

## Context

1. In desktop 1.3.1, with the transcript or answer panel open, the user could not click or type in Word or any app behind them until the panels were closed. The overlay is one window holding the bars and the panels. The panels were stretched to fill the window below the bars, so the window had no transparent space left for ADR-0055's click-through. A click on a panel button also made the overlay the active window and kept the keyboard there.
2. The transcript was shown as chat bubbles, and downloaded as one timestamped row per line with answers in time order. The team wants it to read like an Otter export, with Kite's answers placed next to what they answered.

## Decision

**Overlay (desktop 1.3.2; the web page works with older shells):**

1. The panels are as tall as what they show, up to the height the window allows. Side by side they are top-aligned, so the space under the shorter one is a `data-gap`. The page measures how tall the bars and panels would be (each panel's box plus what its scroll areas hide) and sends it as `OverlayLayout.contentHeight` (optional, rounded up in 8 px steps). A 1.3.2 shell sets the window's height to `fittedHeight()`: no taller than the layout's height (the most the user gave the panels), and no shorter than the content, an open menu or the bars' minimum. The window is then exactly its visible box. An older shell drops the field and keeps its height, and the empty space still passes clicks.
2. Nothing the panels do takes focus: new lines, answers and streaming only re-render the page, and the window is shown with `showInactive`. After a click on a panel's button (copy, ← →, a switch, Answer this), the page calls `releaseOverlayFocus()` (IPC `kite:overlay-release-focus`; only the overlay's own page). The shell blurs the overlay only while it has focus. Windows then activates the next window below it, which is the app that was active before the click. A click that opened a text box (the report box, the chat bar: `data-keeps-focus`) keeps the keyboard.
3. **Click-through mode** is a new global shortcut, `click-through` = Ctrl+Alt+X (no clash with the other Ctrl+Alt shortcuts: H, S, K, T, Enter, Arrows), and a ⋮ menu switch. The live page holds the state like the script bar (`CompactState.clickThrough`, command `click-through`). While it is on, everything but the bars (`data-bars`: bar 1, the chat bar, bar 2 and its Auto answer pill) passes the mouse to the app behind. A click on the bars gives the keyboard back too, and turning the mode on gives it back at once. Bar 1 shows "Click-through on", which turns it off with a click.

**Transcript (web; Review, downloads and the live panels):**

4. `core/transcript/turns.ts` merges one speaker's consecutive lines into a turn and starts a new one on a speaker change or a pause over 8 s (`TURN_GAP_MS`). Each turn shows "<Speaker name>  <mm:ss since the call started>" with its words under it, and a blank line between turns. Minutes are not capped at 59. "You" shows the account's display name, which the server pages pass in through `AccountNameProvider`, so nothing is fetched. "Them" shows `Session.contactName`, which can be renamed in Review by clicking the name. It is stored on the session and synced with it, and defaults to "Them" ("Client 1" before).
5. Each answer to speech records `StoredAnswer.sourceLineId`: the live id of the line its question ended on. A saved line's id ends with it. Review and the downloads put the answer right after the turn holding that line. If that line is gone, or the answer came from chat or a screenshot, the answer goes after the last turn that started at or before it was asked. It is labelled "Paramount AI answered  <mm:ss>", with "(chat)", "(screenshot)" or "private" where that applies, then "Question:" and "Answer:" lines. Review collapses it; TXT and PDF write it out in full, never its private note. The clock runs from when the call connected (recorded on its answers), otherwise from its first item.
6. The live panels use the same turns and headers; answers stay in the answer panel during the call. With Save transcript off nothing changes: no lines are stored, so the downloads hold the answers only. The session card's Download transcript is then enabled.

## Consequences

- `releaseOverlayFocus` relies on Windows activating the window below the overlay. In the real-input test that is the document window the user was in; with other always-on-top windows in between, it could be one of those.
- Focused shortcuts (Ctrl+← / →, Ctrl+Backspace, Ctrl+Alt+T) work in the overlay only until the click's focus is given back. The global shortcuts are unchanged.
- The window resizes as the panels' content grows (in 8 px steps) until it reaches the layout's height.
- Answers saved before 1.3.2 have no source line and are placed by time.
- No database version: `sourceLineId` is not indexed. The names are display only and never sent to Claude.

## Alternatives considered

- **A non-focusable overlay** (`focusable: false`, `WS_EX_NOACTIVATE`): tested on Windows with Electron 44. A real click on such a window never reaches its buttons, because Chromium eats the click that would activate it. Electron also hides a non-focusable window from the taskbar, which CLAUDE.md forbids.
- **Separate windows for the panels:** a larger change to `windows.ts` (positions, snapping, protection, icon mode, bottom row) for the same effect.
- **Keeping the bubbles on screen** and changing only the downloads: rejected; the team asked for the same format everywhere.

## Validation

- Unit: turn merging, mm:ss, names, answer placement (with a missing and a reused source line), the TXT golden file `apps/web/tests/fixtures/transcript/otter-export.txt`, `passesThrough`, `fittedHeight`, the release-focus IPC, Ctrl+Alt+X.
- Real input (`apps/desktop/tests/manual/panels-click-through.spec.ts`): a document window behind both panels. Clicks and typing reach it; the panels update while it keeps the keyboard; a panel-button click gives the keyboard back; Ctrl+Enter still answers; Click-through passes a click on a panel and turns off from the bar.
- Harness (live, review), and visual pairs for Review and the live panel.
