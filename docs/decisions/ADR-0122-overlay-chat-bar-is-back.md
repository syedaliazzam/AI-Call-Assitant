# ADR-0122: The overlay's chat bar is back (Chat on bar 1, a bar under it, no Screenshot button)

- **Status:** Accepted (25 Nov 2026, the developer's WP3 brief, item 1)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay, compact view), §7.3 (hotkeys) (version 4.60.0)
- **Supersedes / superseded by:** amends ADR-0082 §3 ("Bar 1 loses Answer, Screenshot and Chat… The chat bar is removed") and §4 ("Ctrl+Alt+K during a call opens Ask AI in its own window, since the overlay has no message box"). Keeps ADR-0082's removal of the Answer and Screenshot buttons, ADR-0056 / ADR-0075 mirroring and ADR-0113's bars column.

## Context

The developer compared the overlay with ParakeetAI's again. Its bar 1 has a **Chat** button, and under bar 1 a chat bar: a text box "Enter a message…", Send and ×. Ours lost both in ADR-0082, so a private typed question during a call meant leaving the overlay (Ask AI in the dashboard). With ADR-0123 (own questions), the chat bar is where the user's private questions go during a call.

## Decision

Web only. No change to the desktop shell or the bridge: Ctrl+Alt+K (⌘⌥K on a Mac) is already held by every desktop app since 1.0 (ADR-0030).

1. **Chat on bar 1.** First in the part of bar 1 that gives way (after the device icons and the Rec pill), with its shortcut as a key-cap: "Chat [Ctrl Alt K]". It gives way like the others: the key-cap goes at fit step 1 (with Rec's), the word at step 3 (the icon stays). Tooltip "Chat: type a question · Ctrl+Alt+K". It opens and closes the chat bar.
2. **The chat bar** (`overlay/ChatBar.tsx`) sits right under bar 1, exactly bar 1's width, and is one of the bars (it takes clicks in Click-through mode). It holds the box "Enter a message…", **Send** with its Enter key-cap (muted until something is typed) and **×**. Enter sends; Escape in the box closes it. After Send the box empties and the bar stays open for the next question. The question goes to the live page as a typed question (`chat`), for whoever the live page's chat switch says (Auto unless set otherwise); the reply shows in the answer panel (labelled "Your question:", ADR-0123).
3. **No Screenshot button**, on bar 1 or in the chat bar. Ctrl+Shift+Enter and Ctrl+Alt+Enter (⌘⇧↵, ⌘⌥↵) work as before.
4. **The keyboard stays with the meeting.** The box never takes the keyboard by itself: no autofocus, whether the bar was opened by Chat or by Ctrl+Alt+K. A click on Chat, Send or × gives the keyboard back to the app that had it (`data-releases-focus`, the shell's `releaseOverlayFocus`, desktop 1.3.2); only a click into the box keeps it, and Send lets it go again.
5. **Ctrl+Alt+K during a call** with the overlay open opens the chat bar (the live page counts the presses in `askKiteCount`; with the overlay focused the overlay sends the new command `open-chat`, which the live page counts the same way). Without the overlay (the call window) it still focuses the call window's message box; outside a call it opens Ask AI as before.
6. **Mirroring.** On the bottom-row positions the chat bar sits above bar 1, under bar 2, as everything else is mirrored.

## Consequences

- Bar 1 is wider by the Chat pill (about 130 px with its key-cap) and narrower by the Voice toggle (ADR-0123), so in a 640 px window it gives way one step earlier than before (Rec's and Chat's key-caps go first).
- An overlay with the chat bar open is one bar (44 px) taller; the window's height already follows the content.
- Ask AI's shortcut no longer leaves the call during an overlay call: Settings → Hotkeys and the guide say "Open Ask AI (during a call: the chat bar under the bars)".
- `CompactState.askKiteCount` (kept from before ADR-0082) is used again; a new `SimpleCommand` `open-chat`.

## Alternatives considered

- **Focus the box when the bar opens.** Rejected by the brief: typing must not leave the meeting unless the user clicks into the box.
- **A new shortcut for Chat.** Every new global key needs a desktop release and can clash; Ctrl+Alt+K is already held and already meant "a private question".
- **Close the bar after Send** (the pre-ADR-0082 behaviour). Kept open, like the reference, so follow-ups need only a click into the box.

## Validation

- Unit: `tests/unit/features/live/overlay/ChatBar.test.tsx` (box, placeholder, no autofocus, Send and ×, no Screenshot button, focus released), `StatusBar.test.tsx` (Chat on bar 1 with its key, before Auto answer, inside the part that gives way), `liveChannel.test.ts` (`open-chat`).
- Integration: `tests/integration/live.spec.ts` "ADR-0122" (opens under bar 1, not focused, Enter sends and keeps it open, × and Escape close, Ctrl+Alt+K opens it, mirrored on the bottom row), S13 and the 1.6.3 fit test (Chat in bar 1's order, never cut off).
- Pictures: `docs/testing/wp3-overlay-screenshots/` (640 and 1280 px, top and bottom).
