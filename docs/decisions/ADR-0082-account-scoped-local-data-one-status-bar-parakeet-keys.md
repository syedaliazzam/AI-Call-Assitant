# ADR-0082: Local data scoped per account, the start flow without Free/Paid, one status bar, and ParakeetAI's call keys

- **Status:** Accepted
- **Date:** 2026-11-14
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §3.3, §5, §7.1, §7.3, §7.4, §8.1 (version 4.22.0)
- **Supersedes / superseded by:** amends ADR-0049 (the one-time upload), ADR-0055 (the launcher's Start card), ADR-0068 (Record on the Connect card), ADR-0069 (the separate warning bar), ADR-0071 (Buy credits), ADR-0075 (bar 1's buttons and fit steps). Keeps ADR-0042 (Private) and ADR-0061 (Click-through) semantics.

## Context

A team feedback round on 14 Nov 2026 found:

1. **Privacy bug (P0).** A teammate signed in on a computer another account had used, and saw "This system has 2 sessions that are not in your account yet — add them to <email>". The one-time upload (ADR-0049) read the device's shared `kite` IndexedDB database, which records no owner, and offered it to any signed-in account. Accounts without account sync also used that shared database directly. Account-tied browser keys (the synced preferences, Drive switches, chat targets, the timing log with its call ids) were shared by every account on the browser profile. A window left open for account A after B signed in could still push A's changes using B's cookie.
2. **Start flow.** The desktop launcher showed a "Start your session" card (Free session / Paid session, Buy credits) before Connect, and Connect had a Record Off / Audio / Screen choice. Buy credits only showed a toast.
3. **Compact view.** Bar 1 had Answer, Screenshot and Chat buttons, and Chat opened a typed chat bar. Warnings had their own bar above the two-row transcript bar. The answer arrows showed "Ctrl ←". Click-through had no switch, only an indicator while on. Private started off unless chosen. The window opened at 980 × 480.
4. **Hotkeys.** The team uses ParakeetAI's keys. Ctrl+Backspace only cancelled a streaming answer, and it worked only while Paramount AI had the keyboard, which the overlay gives back after most clicks.
5. **False warning.** In a call with speakers on, "We can't hear the other side — check the audio source" showed while the other side's lines were still arriving. The rule looked only at the meter level (silent below 0.1).

## Decision

**1. Local data belongs to one account.**

- Every signed-in page opens only its account's own database. Synced accounts use `kite-u-<id>` (unchanged). Accounts without sync (dev, kill switch) use a new per-account `kite-l-<id>`. `SyncScope` gets the account id on every route and selects the database while rendering.
- The ownerless shared `kite` database (data from before 9 Nov) is never offered, read for display, changed or deleted. Its owner cannot be proven.
- The one-time upload card now offers only the same account's own `kite-l-<id>` data, into that account.
- `core/storage/accountScope.ts` remembers the last account on the browser profile (`kite.lastAccount`). When a different account signs in, it removes the previous account's account-tied keys: the synced preferences (read again from the account), Drive switches, chat targets, the call-start note and the recording-consent note. Device settings stay: theme, zoom, overlay, microphone and device id.
- The timing log is kept per account (`kite.callTimings.<id>`); the old unscoped log stays hidden.
- A page whose account changes without a reload (sign-out, then sign-in as someone else) shows nothing and reloads. Other windows of the profile reload when they see another account sign in.
- Sync and Drive requests carry `x-kite-account`. The server refuses a request that names a different account than the signed-in one with 409 `account_changed`. Requests without the header are checked as before.

**2. Start flow.** The "Start your session" Free/Paid card and every Buy credits button and toast are removed. Start and Start again go straight to Connect (audio source). Connect has no Record choice: recording starts only from the call bars' Rec pill (or Ctrl+Alt+R). The "Everyone on the call has agreed to be recorded" tick stays on Connect. Ticked, it leaves a short-lived consent note for that call (`kite-record-consent`), and the Rec pill then starts recording without asking again. Otherwise it asks as before. No call records by itself.

**3. Compact view.**

- Bar 1 loses Answer, Screenshot and Chat; their shortcuts keep working. The chat bar ("Enter a message…") is removed.
- Bar 1 gets a Click-through switch (on/off state, tooltip with Ctrl+Alt+X) where clicks can pass.
- The warning bar and the transcript bar merge into one status bar: level button (transcript panel), language, one line, Clear (transcript), collapse. The line shows the live words, or the current warning with its button, in a fixed order (`overlay/statusLine.ts`). With the transcript panel open, the same bar is the panel's header (messages only). Collapsed, an alert still shows the bar.
- The answer arrows show only ← →.
- Private (`setContentProtection`) is turned on at the start of every call; ⋮ can turn it off for that call.
- The overlay's default size is a third of the display work area's width; with panels open it grows up to half its height. Desktop 1.6.4 resizes an existing overlay to this once. ⋮ and Exit stay pinned (ADR-0075), and the smallest width is 440.

**4. Hotkeys (ParakeetAI's, plus ours).**

- Ctrl+Enter: answer.
- Ctrl+Shift+Enter: screenshot.
- Ctrl+Shift+Space: voice question. Kite listens to the microphone, shows "Listening…" on the status bar, and sends after about 1.5 s of silence; Esc or the same key cancels. The question is never a "You" line and never counts as a reply: dictation always uses a diverted target.
- Ctrl+Alt+Enter: screenshot first, then the voice question, sent together.
- Ctrl+←/→: previous / next answer.
- Ctrl+Backspace: clear the answers. They leave the screen in the overlay and the call window and stay saved for the review.
- Ctrl+Shift+Backspace: clear the transcript.
- Ctrl+= / Ctrl+- / Ctrl+0: the overlay's zoom (the ⋮ Zoom setting).
- Ours stay: Ctrl+Alt+R, X, T, H, K, S and the arrows. Ctrl+Alt+K during a call opens Ask AI in its own window, since the overlay has no message box.
- **The developer's choice:** desktop 1.6.4 holds Clear answers, Clear transcript, ← →, the zoom keys and Ctrl+Alt+Enter globally during a call, like ParakeetAI, and releases them at End. Escape is held only while a voice question listens (new bridge method `setVoiceCancelHotkey`). The action ids stay the same ('chat' is now the voice question), so a 1.6.3 shell still works: its keys reach the page while it has focus, and the page asks it to hold Ctrl+Alt+Enter for the whole call.

**5. No false "can't hear".** `ChannelSilence.heard()` records when a channel's words arrive, from both the on-device and the cloud engines. A channel whose words arrived within the rule's time is never the silent one. Words only clear a channel: whether the other side talked, for the microphone rule, is still the meter's, so this never adds a warning.

## Consequences

- Another account's local data can no longer be seen or offered on a shared computer.
- Data from before 9 Nov in the shared `kite` database is no longer offered to anyone, including its real owner. It stays on disk untouched; offering it would need proof of ownership that does not exist.
- After deploy, every browser profile's chat targets reset once (its last account is unknown).
- During a call in the desktop app, other apps cannot use Ctrl+Backspace, Ctrl+←/→, Ctrl+Shift+Backspace, Ctrl+= / - / 0 or Ctrl+Alt+Enter, for example in a code editor. Settings → Hotkeys and the guide say so. In a browser, or with an older desktop app, these keys work only while Paramount AI has focus.
- The main call window keeps its message box; only the overlay lost the typed chat.

## Alternatives considered

- **Offer unowned legacy data when no other account has used the device:** rejected. A pre-sync owner leaves no trace, so this guess can still leak.
- **Keep the call keys focused-only:** this was the 1.1.0 choice. The developer chose ParakeetAI parity over keeping them for other apps during calls.
- **A separate warning bar kept beside the status bar:** rejected by the feedback (one bar).
- **Lowering the meter's silent level:** rejected. A level threshold is guessed per machine; words arriving is proof.

## Validation

- Unit tests:
  - account switching on one device: `accountScope`, `db`, `accountSwitch`, `SyncScope`, `LegacyUploadCard`, `callTimingsAccount`, and the server 409s;
  - the status line's order and the status bar's markup;
  - bar 1 without Answer, Screenshot and Chat, with the Click-through switch;
  - the keys (Ctrl+Backspace, the zoom keys, Escape);
  - the voice question's target is always diverted;
  - `answersAfterClear`;
  - the Rec pill with consent;
  - the consent note;
  - Connect without Record;
  - the launcher's first card;
  - `ChannelSilence` with words arriving under a quiet meter;
  - the shell: the call keys held and released, Escape only while listening, and the default size and its one-time migration.
- Integration specs: live-ui, answers, review, screenshot.
- Desktop 1.6.4 install-check in CI.
