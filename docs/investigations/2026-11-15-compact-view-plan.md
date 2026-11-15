# Compact view (desktop 1.6.4): Private coverage, language, Transcript toggle, layout and zoom

- **Date:** 15 Nov 2026
- **Scope:** investigation and plan, written before any change. **Update, same day:** the developer took the decisions (see [Decisions](#decisions-i-need-from-you)), the live measurements were run (see [Measured results](#measured-results-15-nov-2026)), and the plan was implemented as ADR-0085 (web, and desktop 1.6.5). Where the implementation differs from the plan, the measured results say so.
- **Versions read:** web at `main` `7d9309b` (as on disk this morning; another session is changing code in parallel, so line numbers can drift by a few lines); desktop shell 1.6.4 (Electron 44.9.3).
- **No secrets, emails, ids or call text** appear here.

## How to read this

- **CONFIRMED (code)** means the code makes it certain. **LIKELY** means the code points to it but a live measurement is still needed. **NOT VERIFIED** means I could not check it.
- **Live measurements:** none at first (another session was using the repo). They were run later the same day and are in [Measured results](#measured-results-15-nov-2026); every LIKELY item below is now confirmed or corrected there.
- Paths are under `apps/web/src/` unless they start with `apps/`.

## Evidence used

| Source | What it gave |
|---|---|
| Code reading: `apps/desktop/src/{windows,protection,main,snapZones,updater}.ts`; `features/live/{CompactView,CompactLive,LivePage}.tsx`; `features/live/overlay/*`; `platform/desktopDocument.ts`; `features/sync/SyncScope.tsx`; `core/storage/{overlayPrefs,appearancePrefs}.ts`; `features/appearance/useAppearance.ts`; `ui/tokens/theme.css` | causes, `file:line` |
| ADR-0042, ADR-0055, ADR-0075, ADR-0082 | what was decided before, and why |
| Kite's own captures: `docs/testing/v1.6.3-screenshots/after/overlay-163-top-both.png` and the others in that folder (there are no 1.6.4 captures) | how side by side looked at 980 px wide |
| The developer's ParakeetAI frames in `docs/design/references/` (git-ignored; catalogued in `docs/design/reference-catalog.md`). I opened `desktop-transcript-panel.png`, `desktop-code-answer.png`, `v1.2/compact view.jpeg` and the `side-by-side/` comparisons | how ParakeetAI's overlay looks (private frames, not public docs) |
| ParakeetAI's public site and its public feedback board (searched and fetched 15 Nov 2026; sources at the end) | what ParakeetAI claims publicly |

## Summary

| # | Issue | Verdict | Cause in one line | Ships in |
|---|---|---|---|---|
| 1 | Private covers everything in the compact view | **Mostly yes, with 3 gaps** (CONFIRMED in code) | (a) the overlay is shown **before** Private is turned on at call start; (b) for accounts **without account sync**, native `title` tooltips and one native `<select>` list open as separate OS windows that Private does not cover; (c) OS-level surfaces (mic-in-use icon, taskbar button) are outside Kite by design | Web (a, b); desktop 1.6.5 optional, as a backstop for (a) |
| 2 | Remove the language selector from the compact view | Change request | Two selectors: the status bar's (`overlay/StatusBar.tsx:226`) and ⋮ "Answer language" (`overlay/LiveMenu.tsx:264-270`). Both **write the session's language** (`LivePage.tsx:1447-1451`) | Web only |
| 3 | Transcript toggle disappears | **CONFIRMED** | It is fit step 4 of 6 (`overlay/ControlBar.tsx:118-119, :580`). It also only exists for accounts with account sync (`CompactView.tsx:657-662`) | Web only |
| 4 | Transcript open by default at call start | Change request | First-time default is "both closed" (`core/storage/overlayPrefs.ts:120-127`) | Web only |
| 5 | Side-by-side panels | **Already built, but it never triggers at the 1.6.4 default size** | Side by side starts at 900 CSS px (`CompactView.tsx:244-249`); the 1.6.4 default is a third of the screen (640 px on a 1920 screen) (`apps/desktop/src/windows.ts:100, :196-209`) | Web (layout, divider); desktop 1.6.5 (default size) |
| 6 | Zoom breaks the layout | **CONFIRMED** for the fixed window, and **CONFIRMED by measurement** for the scrollbar (739 px of page in a 568 px window at 130 %) | Zoom is CSS `zoom` on `<html>` (`features/appearance/useAppearance.ts:82-85`); the window's **width** never follows it (`windows.ts:986-1022`; only heights use `scale`). Under Chromium's standard CSS zoom, `100vh` (`h-screen` on the root, `CompactView.tsx:613`, and the menus' `max-h-[calc(100vh-…)]`) is probably scaled too, so the page becomes taller than the window and scrolls | Web (no overflow); desktop 1.6.5 (window scales) |

**Suggested order:** web batch 1 (issues 1a, 1b, 2, 3, 4, the zoom overflow fix, and the layout with a divider) can ship on the 1.6.4 shell; desktop 1.6.5 (default size, window scales with zoom, Private forced on at overlay open) follows. A new ADR (ADR-0085) is needed, because issues 5 and 6 change what ADR-0082 decided (a third-width window with stacked panels).

---

## 1. Private: is every compact-view window excluded from capture?

The per-call consent tick stays exactly as it is. Nothing in this plan touches it.

### What is right today (CONFIRMED in code)

- **Every Electron window is protected as it is created.** `app.on('browser-window-created', …) → shield.attach(window)` (`apps/desktop/src/main.ts:534`). `attach()` calls `setContentProtection(wanted)` at once and again on every `show` (`apps/desktop/src/protection.ts:95-101`). The overlay is also attached by its owner (`apps/desktop/src/windows.ts:1336`), and so are the snap-zones window (`main.ts:561-564`), the home panel (`main.ts:731-736`) and the pages and call windows (`main.ts:269`). Windows created later (the player, Ask AI's pages window) are covered by the same `browser-window-created` hook.
- **Turning Private on or off applies to all windows at once** (`protection.ts:90-94`, via `installProtection(…, () => BrowserWindow.getAllWindows(), …)`, `main.ts:631`).
- **The overlay is created hidden** (`show: false`, `windows.ts:657`) and protected before its first `showInactive()` (`windows.ts:1336-1338`). The protection is in place before the first frame.
- **Everything you listed is drawn inside the overlay's own page, so it inherits that window's protection:** bars 1 and 2, the transcript and answer panels, the Rec pill and timer (`overlay/RecordControls.tsx`, `overlay/ControlBar.tsx:326-352`), bar 1's tooltip (an in-page portal, `overlay/BarTooltip.tsx:1-17, :210`), the ⋮ menu, device lists, Rec popover and answer-preferences sheet (in-page `absolute` boxes: `LiveMenu.tsx:197`, `DevicePicker.tsx:33`, `RecordControls.tsx:201`, `AnswerPreferencesSheet.tsx:68`), the warnings and the voice "Listening… (Esc cancels)" line (`overlay/statusLine.ts:69`, shown in the status bar), and the icon mode (`overlay/IconMode.tsx`, the same window made 48 × 48).
- **Private is turned on at every call start** (ADR-0082; `LivePage.tsx:1174-1176`).

### Gaps: what could still show up in a capture

| # | What could show | When | Cause | Status | Fix |
|---|---|---|---|---|---|
| G1 | **The whole overlay**, for the first seconds of a call | The last call ended with Private **off** (the shell remembers the setting: `protection.ts:85`) | The overlay is opened at `LivePage.tsx:1024` (`await openOverlay`) and shown as soon as it is ready (`windows.ts:1338`). `turnPrivateOn()` runs only at `LivePage.tsx:1176`, **after** the whole connect: microphone, cloud speech, capture start. On a slow start that can be several seconds. Same for the full call window, which is on screen at that point. | **CONFIRMED (code)**. The length of the gap is not measured. | **Web:** `await turnPrivateOn()` **before** `openOverlay()` (it is one IPC round trip; no user-visible delay). **Desktop 1.6.5 (backstop):** when the page opens the overlay, or reports `callActive = true` (`main.ts:713-722`), the shell sets Private on for every window before showing it. The page's ⋮ switch can still turn it off for the call. |
| G2 | **Native tooltip windows** (the OS's own small yellow/grey hint boxes) over overlay buttons | Accounts **without account sync** (not in `KITE_SYNC_USERS`) | `platform/desktopDocument.ts` moves every `title` to `aria-description` so no tooltip window opens. It is installed only from `SyncScope` **when syncing** (`features/sync/SyncScope.tsx:103-107`). The overlay still has `title=` on ← → and Clear (`overlay/OverlayAnswer.tsx:96, :110, :134`), the status line, Clear and collapse (`overlay/StatusBar.tsx:120, :260, :268`), and the Private-off line (`PrivateOffWarning.tsx:97`). Chromium on Windows draws these as separate system windows, which `setContentProtection` does not cover (ADR-0042, ADR-0055). | **CONFIRMED (code)** for non-sync accounts. I can't read production's `KITE_SYNC_USERS` (sensitive values can't be pulled), so I don't know whether any team account is affected today. | **Web:** run `keepPopupsInWindow()` for **every** desktop page, whatever the account (move it from `SyncScope` to the platform's desktop start-up, or to `CompactLive` and the call pages). Also replace the overlay's `title=` with `data-tip` / the in-page tooltip, and add a unit test that fails if a file under `features/live/overlay/` uses `title=`. |
| G3 | **A native drop-down list** (the "Screen" picker in the Rec popover) | Accounts without account sync, **screen** recording, **more than one display** | The `<select>` (`overlay/RecordControls.tsx:287`) sits in the Rec popover, which is rendered **beside** bar 1's glass piece, not inside it (`CompactView.tsx:733-743` vs `:621`). The in-page list rule only matches `.k-overlay select` or `.k-desktop select` (`ui/tokens/theme.css:452-456`). The root's class is `k-overlay-root`, which that rule does not match, so the browser opens its own list window. | **CONFIRMED (code)**; narrow trigger | Fixed by G2's change (adds `k-desktop` for all). Belt and braces: add `.k-overlay-root select` to the rule, or use `ui/Select.tsx`. |
| G4 | Windows' **"app is using your microphone"** icon in the taskbar tray (its hover text names the app) | Any full-screen share, whole call | The OS draws it; not a Kite window | By design (CLAUDE.md: never hide from OS indicators) | None. Mention it in the user guide. |
| G5 | Kite's **taskbar button**, and its hover thumbnail or Alt+Tab preview | A full-screen share that shows the taskbar, if the user hovers or presses Alt+Tab | Kept on purpose (CLAUDE.md). Whether Windows draws the protected window's thumbnail as blank or black inside a capture: **NOT VERIFIED** | By design / needs a check | None in code. A manual check is listed below. |
| G6 | A **black box** where the overlay is | Windows 10 before version 2004 | `WDA_EXCLUDEFROMCAPTURE` needs build 19041+ (`protection.ts:16-19, :31-46`) | By design | None; the page already reports "not supported". |
| G7 | The **mouse pointer**, and its shape (move, resize, text cursor) over the overlay | Any share that includes the pointer | Capture tools draw the pointer themselves | Out of Kite's control | None. |
| G8 | The overlay, **after the user turns Private off** in ⋮ during a call | User's choice | — | By design; the warning shows only while Kite records (`PrivateOffWarning.tsx`) | Optional: also show the amber line whenever Private is off during a call, not only while recording (decision D9). |
| G9 | The **update prompt** (a native message box, not protected) | Not during a call: the updater waits until the call ends (`apps/desktop/src/updater.ts:46, :105`) | — | OK | None. |
| G10 | A **Drive notification** (Windows toast) | Drive uploads stop during a call (`apps/desktop/src/drive/upload.ts:83`); a notice could still come from just before the call | Toasts are drawn by the OS | Low | Optional: hold Drive notices until the call ends. |

Aside (not about capture): the snap-zones window uses `skipTaskbar: true` (`apps/desktop/src/snapZones.ts:129`). It is a short-lived drag helper, not an app window, but CLAUDE.md says "never hide from the taskbar". Please confirm this is acceptable.

### How ParakeetAI does it

- **Public claims (verified that they say it):** the website lists "Invisible on Screen Share" and names Zoom, Microsoft Teams, Google Meet, Webex, Lark/Feishu and Amazon Chime as "Verified". It also lists "Invisible in Dock" and "Invisible in Activity Monitor" (macOS). Kite deliberately does **not** do those two (CLAUDE.md).
- **Public user reports (I can't confirm them):** posts on ParakeetAI's feedback board say it was visible in a Teams full-screen share on macOS, and was detected as a screen-sharing session.
- **How it hides tooltips and menus, and whether it has a start-of-call gap: NOT VERIFIED.** Nothing public covers it.

### Tests

**What I can test locally** (with your OK, temp profile, guarded captures; see the end): open a test session's overlay with Private on, then capture the screen three ways: Windows Graphics Capture (the path Teams, Zoom and Chrome use for window or screen share), DXGI desktop duplication, and a GDI copy. Check that the overlay's pixels are absent with the ⋮ menu, a device list, bar 1's tooltip, the Rec popover and the icon open. Also time G1 (overlay visible → Private on) on a call start after a call that ended with Private off. A browser tab's `getDisplayMedia` stands in for Google Meet in the browser.

**What only you can check** (real apps, a second device as viewer): see the manual steps.

### Files to change

- Web: `features/live/LivePage.tsx` (order: Private before overlay); `features/sync/SyncScope.tsx` and `platform/desktop.ts` (popups-in-window for all desktop pages); `features/live/overlay/{OverlayAnswer,StatusBar}.tsx`, `features/live/PrivateOffWarning.tsx` (no `title=`); `ui/tokens/theme.css` (`.k-overlay-root select`); tests in `tests/unit/platform/desktopDocument.test.ts` and a new overlay "no title attribute" test.
- Desktop 1.6.5 (optional backstop): `apps/desktop/src/windows.ts` (`open()`), `apps/desktop/src/main.ts` (call-active), `apps/desktop/src/protection.ts` (a `forceOn()`), and their unit tests.

**Risk:** low. Doing the Private-on step first only reorders one IPC call. `keepPopupsInWindow` for all accounts changes native `<select>` lists to in-page lists on the dashboard pages of non-sync accounts too. That is a visual change; check the pages once.

### Your manual test steps

1. In ⋮, turn Private **off**, then end the call. Start a new call. Share your **entire screen** in Zoom to a second device (a phone in the meeting). From the moment you press Connect, the overlay must **never** appear on the phone.
2. With Private on, open each of these in turn and check the phone shows none of them: the ⋮ menu, a ▾ device list, bar 1's tooltip (rest the pointer on a button), the Rec popover, Answer preferences, the icon (compact), a streaming answer, the transcript, and the voice "Listening…" line (Ctrl+Shift+Space).
3. Repeat step 2 in **Google Meet (Chrome)**: share "Entire screen", then share the **window** of the app behind Kite.
4. Repeat in **Teams** (desktop app): share "Screen", then start a Teams meeting **recording** and play it back.
5. While sharing the entire screen, hover Kite's taskbar button and press Alt+Tab once. Note what the phone shows (G5).
6. Ask one teammate whose account is **not** in account sync (if any) to repeat step 2. That is the G2/G3 case.

---

## 2. Remove the language selector from the compact view

### What's there now (CONFIRMED)

- The status bar (bar 2, and the transcript panel's header) has a language button and list: `overlay/StatusBar.tsx:226-232` → `LanguageControl` (`overlay/parts.tsx:244-310`).
- The ⋮ menu has "Answer language": `overlay/LiveMenu.tsx:264-270`.
- Both send `{ type: 'language' }` (`LiveAnswers.tsx:586`) → `changeLanguage()` (`LivePage.tsx:1447-1451`). That function **changes the session's saved language** (`updateSession(… preferences.language …)`). So one stray click mid-call changes the session setting for this call **and** later ones. Cloud speech picks English or multilingual only at connect (`LivePage.tsx:1038`), so a mid-call change affects the answers, not the transcription.

### How ParakeetAI does it (from your frames; not public docs)

The transcript panel's header has a globe "English ▾" drop-down (`desktop-transcript-panel.png`, `v1.2/compact view.jpeg`), and the ⋮ menu during a call has a "Language" drop-down (catalog entry `desktop-menu-live.png`). Their public FAQ says you pick the language when you start a session, and if you switch mid-call, "update the session language to match". **Removing it is a deliberate move away from ParakeetAI**, which fits English-only calls.

### Recommended design

Remove both selectors from the compact view. Keep the session-level setting (session setup and edit) unchanged. Keep the `language` command in `liveChannel.ts` for now: the full call window still sends it. The status bar gets about 110 px back for the live words.

```
Before (bar 2 / transcript header):  [▮▮▮] [🌐 English ▾] [ live words ……………… ] [Clear] [⤡]
After:                                [▮▮▮] [ live words ………………………………………… ] [Clear] [⤡]
```

**Option (decision D5):** also remove "Answer language" from ⋮ (recommended: one rule, "the compact view never changes the language"), or keep only the ⋮ one as a hidden escape hatch.

### Files to change

`overlay/StatusBar.tsx` (drop `LanguageControl` and its props), `overlay/TranscriptPanel.tsx` (props), `CompactView.tsx` (the `'language'` popup, `languagesElement`, lines 172, 283, 356, 430, 569-574, 597-599, 803-805), `overlay/LiveMenu.tsx:264-270`, `overlay/parts.tsx` (delete `LanguageControl`: StatusBar is its only user), and the tests that mention the language list. **Web only.** **Risk:** very low.

### Your manual test steps

Start a call in a session whose language is English. Check that neither bar 2, the transcript header nor ⋮ shows a language control. End the call, open Edit session, and check the language is still the one you set.

---

## 3. The Transcript toggle must always stay on bar 1

### What's wrong now (CONFIRMED)

- Bar 1's left side gives way in six measured steps (`overlay/ControlBar.tsx:111-127`, `useFitStep` `:447-507`). **Step 4 removes the Transcript pill** (`:118-119`, rendered only while `step < FIT.noTranscript`, `:580`). A narrow window, or zooming in (which narrows the page in CSS pixels; see issue 6), reaches step 4 quickly.
- Even before step 4, the left side is `overflow-hidden` (`:553`), so in a very narrow window the pill can be **clipped** rather than removed.
- **The pill only exists for accounts with account sync:** `CompactView.tsx:657-662` passes `onTranscript` only when `referenceLook` is true, which is `synced` (`CompactLive.tsx:300`). Everyone else has only the status bar's level button.

### How ParakeetAI does it (from your frames)

ParakeetAI's bar 1 has **no** Transcript toggle. The transcript opens from bar 2's level button, or the panel's expand control. Its bars have a fixed width and do not give way (the frames show a full bar every time). **Not verified:** what ParakeetAI does in a narrow window.

### Recommended design

Treat the Transcript switch like ⋮ and Exit: always whole, never clipped. Show it for **every** account.

- **Pinned:** the device icons (they show what is captured), **Transcript** (icon + switch when short of room), compact, ⋮, Exit. While recording, the **Rec pill** too (recommended, D10: the recording indicator should never vanish while recording).
- **Gives way, in this order:**
  1. Rec's key-cap
  2. the words "Transcript" and "Click-through" become icons; the timer's clock icon goes
  3. "Auto" becomes the bolt
  4. the move icon goes (the whole bar still drags)
  5. the Click-through toggle goes (it stays in ⋮ and on Ctrl+Alt+X)
  6. the timer goes (only a picture-in-picture window is that narrow)
- **Smallest window:** the pinned set must fit `COMPACT_MIN_SIZE.width` (440 DIP) at 100 %. Estimate: about 330–360 px, measured from the 1.6.3 narrowest capture. With issue 6's window scaling, the page never gets narrower than 440 CSS px at any zoom.

```
Default (≥ ~760 CSS px):
[🖥▾ 🎙▾] [Transcript ●━] [○ Rec Ctrl+Alt+R] [⚡ Auto •] [🖱 Click-through •]   [✥] [⤡] [🕒 4:12] [⋮] [Exit]

Narrow (~560):
[🖥▾ 🎙▾] [📜 ●━] [○ Rec] [⚡] [🖱]                                            [⤡] [4:12] [⋮] [Exit]

Narrowest (440, or 1.6.4 shell zoomed to 130 %):
[🖥▾ 🎙▾] [📜 ●━] [⚡]                                                                [⤡] [4:12] [⋮] [Exit]
```

**Option (decision D10b):** move the Transcript switch into the right-hand pinned group, next to ⋮. That is simpler code, but it moves a control people have learned. I recommend keeping its place and pinning it.

### Files to change

`overlay/ControlBar.tsx` (FIT steps; a pinned left group; Transcript always rendered), `CompactView.tsx:657-662` (pass `transcriptOpen`/`onTranscript` for all accounts), and `tests/unit/features/live/overlay/ControlBar.test.tsx`. **Web only.** **Risk:** low. Watch the memory note on drag regions: the new pinned group must keep `[-webkit-app-region:no-drag]` on its buttons, and no hover effect may sit on the drag area itself.

### Your manual test steps

Drag the overlay's right edge in until it stops (440). Then press Ctrl+= three times. The Transcript switch must stay visible and clickable at every step, and ⋮ and Exit must stay whole. Repeat at the bottom-right position.

---

## 4. Transcript panel open by default when a call starts

### What's wrong now (CONFIRMED)

`getOverlayPanels()` returns both panels closed when nothing is stored (`core/storage/overlayPrefs.ts:120-127`). After that it remembers the last state per browser profile (that is, per device; `kite.overlayPanels`). It is a device setting, so it survives account switches (ADR-0082). An answer **opening its own panel** is also saved (`CompactView.tsx:419-423` → `onPanels` → `CompactLive.tsx:263-266`). So "answer panel open" is remembered even though the user never chose it.

### How ParakeetAI does it

**NOT VERIFIED.** No frame shows the very start of a call with nothing touched.

### Recommended design

- **Transcript:** open on a device's first call. After that, the user's last **own** choice (the switch, the level button, Ctrl+Alt+T, its collapse button).
- **Answer panel:** not remembered. It starts closed at every call and opens on the first answer, as today. Otherwise a closed answer panel the user never chose to close (or an empty one they never opened) carries over.
- **Existing users (D6):** apply "transcript open" **once** to everyone, including people who have a stored value, via a version key (`kite.overlayPanelsDefault = 2`). Then remember. Otherwise nobody who has used 1.6.x sees the new default.

### Files to change

`core/storage/overlayPrefs.ts` (default, migration, store only the transcript), `CompactView.tsx:419-423` (the auto-open is not a saved choice), `CompactLive.tsx:263-266`, and the `overlayPrefs` and `CompactView` unit tests. **Web only.** **Risk:** low. With the transcript open, the window is taller at call start. On the bottom row it grows upward (existing rule).

### Your manual test steps

1. Start a call: the transcript is open. Close it with the switch. End the call, start another: it is closed. Turn it on, end, start again: it is open.
2. Let an answer open its panel, end the call, start another: the answer panel starts closed.

---

## 5. Transcript left, answers right, side by side

### What's wrong now (CONFIRMED)

- **Side by side already exists** (transcript left, answers right). It needs the overlay's container to be at least **900 CSS px** wide: `panelsLayout()` (`CompactView.tsx:244-249`), with the transcript limited to 38 % (`:793`). Below that the panels stack.
- The 1.6.4 default width is **a third of the work area** (`apps/desktop/src/windows.ts:100, :196-209`; ADR-0082). That is 640 px on a 1920-wide screen, 512 px on a 1920 laptop at 125 % scaling, and 455 → 440 px on a 1366 screen. **So the panels always stack at the default size.** In 1.6.4, both panels open no longer widen the window (`windows.ts:1007-1012`).
- With only the transcript open it is capped at 540 px (`CompactView.tsx:793`), so it leaves a gap in a wider window.

### How ParakeetAI does it

- **From your frames:** the transcript panel takes bar 2's place, centred under bar 1 and narrower than it (`desktop-transcript-panel.png`). The answer panel is **wider than the bars**, even running past the window's edge for code (`desktop-code-answer.png`). **No frame shows both panels open at once, so "transcript left, answers right" is NOT VERIFIED for ParakeetAI's desktop overlay.**
- **Their browser call page** (an older build, `side-by-side/browser-split.png`): transcript on the **left** under the shared-tab preview, answers on the **right**, with a **draggable divider** and a collapse arrow. That is the closest verified precedent for both the order and a divider.
- Their default window size and minimum sizes: **NOT VERIFIED**.

### Recommended design

**Width.** Side by side needs about **600 CSS px** for two readable panels: transcript at least 240, answer at least 340, plus the gap and padding. A third of the screen is not enough on common laptops, so:

> **Default width = 40 % of the work area, at least 640 and at most 960 DIP. Height = half the work area, as now** (the window still shrinks to its content: `fittedHeight`, `windows.ts:304-313`).

| Screen (work area, DIP) | 1/3 today | Proposed | Share of width |
|---|---|---|---|
| 1366 × 728 (laptop, 100 %) | 455 | 640 | 47 % |
| 1536 × 824 (1920 laptop at 125 %) | 512 | 640 | 42 % |
| 1920 × 1032 | 640 | 768 | 40 % |
| 2560 × 1392 | 853 | 960 | 38 % |

Minimum width stays **440**. Below 600 CSS px the panels stack (as now): the transcript nearest the bars, the answer below (top row) or above (bottom row).

**Sharing the width.** A **vertical divider** between the panels, about 8 px wide with a visible 2 px grip. Drag it to resize; double-click resets it to the default (40 % transcript / 60 % answer). Arrow keys move it while focused. The split is remembered per device. Each panel keeps its minimum (240 / 340); a drag stops there. The divider must take clicks: today the space between panels is a **click-through gap** (`data-gap`, `CompactView.tsx:786`), so the divider is marked as one of the bars (`data-bars`) and opts out of window dragging.

**Only one panel open.** It fills the full width under the bars, and the window keeps its size. That's simpler, and the window doesn't jump when a panel opens or closes. Remove the 540 px transcript cap. (Option D4b: the window narrows to one panel's width. Not recommended: the bars would change length on every answer.)

**Bottom row** (unchanged rules): panels sit on the bars, mirrored vertically. Transcript stays left, answer right.

```
Default, top-centre, 1920 × 1080 → window 768 × ≤516
┌──────────────────────────────────────────────────────────────────────────┐
│[🖥▾🎙▾][Transcript ●━][○ Rec][⚡ Auto][🖱 Click-through]   [✥][⤡][4:12][⋮][Exit]│ bar 1
├───────────────────────────┬┬─────────────────────────────────────────────┤
│▮▮▮ Listening…   [Clear][⤡]││ [←][→] 2 of 3                  [Clear][⤡]   │ headers
│ Client 1 · 04:01          ││ ▍ Tell me about a migration you led        │
│ Thanks for joining…       ││ Answer line                                 │
│                 You · 04:02││ • point one                                 │
│        Sure, I've been…   ││ • point two                                 │
│ Client 1 · 04:05 [Answer] ││ ⧉ 👍 👎 ⚑            From your CV · 04:06   │
└───────────────────────────┴┴─────────────────────────────────────────────┘
   transcript ~40 %          ↑ divider (drag / double-click)   answer ~60 %

Only the transcript open:               Bottom row (mirrored vertically):
┌──────────────── bar 1 ─────────────┐  ┌──────────┬┬──────────────────┐
├────────────────────────────────────┤  │transcript││ answer           │
│ transcript, full width             │  ├──────────┴┴──────────────────┤
└────────────────────────────────────┘  └──────────── bar 1 ───────────┘

Narrow (< 600 CSS px): stacked, as today
┌──────── bar 1 ────────┐
├───────────────────────┤
│ transcript            │
├───────────────────────┤
│ answer                │
└───────────────────────┘
```

Zoomed in and out: see issue 6. With the window scaling, the layout above is the same at every zoom; only its size changes.

**Options (judgement calls):**

- D1 default width: **40 % (640–960), recommended**; or keep 1/3 and accept stacking on most laptops; or 50 % (side by side everywhere, but it covers half the meeting).
- D2 narrow fallback: **stack, recommended**; or tabs (Transcript | Answer) in one panel, which needs less height but hides one panel; or auto-widen when both open (the 1.2.0 behaviour; the window would jump).
- D3 divider: **draggable and remembered, recommended**; or a fixed 40/60 split (less code).

### Files to change

- **Web:** `CompactView.tsx` (`panelsLayout` at 600; the divider; one panel full width; the split from prefs), a new `overlay/PanelSplit.tsx`, `core/storage/overlayPrefs.ts` (split ratio, a device setting), and the `CompactView`/`PanelSplit` unit tests. This works on the 1.6.4 shell: anyone who drags the window wider gets side by side.
- **Desktop 1.6.5:** `apps/desktop/src/windows.ts`: `OVERLAY_DEFAULT_SHARE` → width rule above (`overlayDefaultSize`); bump `OVERLAY_DEFAULT_SIZE_VERSION` to 165 so existing overlays take the new size **once** (the same mechanism as 1.6.4, `windows.ts:1287-1309`); `apps/desktop/tests/unit/windows.test.ts`.
- **Docs:** new ADR-0085 (supersedes ADR-0082's "third of the width, stacked"); architecture doc §5 and a version bump; the user guide.

**Risk:** medium. (1) The window covers more of the meeting by default (40 % vs 33 %). (2) The divider must not break click-through or window dragging (memory: glass pieces cover floating UI; no hover over drag areas on Windows). (3) The one-time resize changes everyone's saved width once, as 1.6.4 did.

### Your manual test steps

1. After 1.6.5: start a call on your main screen. The overlay opens about 40 % wide with transcript left and answer right after the first answer.
2. Drag the divider both ways to its stops; double-click to reset; end and restart the call: the split is kept.
3. Close the answer panel: the transcript fills the width, and the window does not move. Close the transcript: same for the answer.
4. Move to bottom-right (Ctrl+Alt+Down, then Right): the panels sit above the bars, transcript left.
5. Drag the window narrower than about 600: the panels stack; widen again: side by side.
6. With Click-through on (Ctrl+Alt+X), click the divider: it must not pass through, and the app behind must not get the click.

---

## 6. Zoom: the whole window should scale

### What's wrong now

- **CONFIRMED (code):** zoom (Ctrl+= / Ctrl+- / Ctrl+0, ⋮ Zoom; 80–130 % in 10 % steps, `core/storage/appearancePrefs.ts:49`) is CSS `zoom` on `<html>` (`features/appearance/useAppearance.ts:82-85`). The page tells the shell its scale (`OverlayLayout.scale`, `CompactView.tsx:393-401`), but the shell uses it **only for heights** (`windows.ts:273-289, :304-313`). The **width never changes** (`applyLayout`, `windows.ts:986-1022`). At 130 % a 640 px window is only 492 CSS px wide, so bar 1 gives way (and drops Transcript, issue 3) and the panels stack.
- **LIKELY (needs a measurement):** the scrollbar and overlap. The root is `h-screen` = `100vh` (`CompactView.tsx:613`), and the menus use `max-h-[calc(100vh-3.75rem)]` (`LiveMenu.tsx:197`, `DevicePicker.tsx:33`, `AnswerPreferencesSheet.tsx:68`). Electron 44's Chromium uses standard CSS zoom, under which viewport units inside a zoomed element appear to be scaled by the zoom. If so, at 130 % the root is 1.3 × the window's height: the bottom runs out of the window, `<html>` scrolls, and the shell's content-height measurement (`CompactView.tsx:373-391`) chases a height that keeps growing with it. At 80 % the opposite happens: a gap at the bottom. **To confirm:** at 130 %, compare `document.documentElement.scrollHeight` and `getComputedStyle(root).height` with `innerHeight`.
- **LIKELY:** at the 440 minimum and 130 %, the page is 338 CSS px wide. That is narrower than bar 1's pinned right-hand group plus the device icons, so the bar overflows its glass piece.

### How ParakeetAI does it

**From your frames:** ParakeetAI's ⋮ menu has "Zoom + / − / reset", and the controls disable at their limits (`desktop-menu-idle.png`, `desktop-menu-live.png` in the catalog). **NOT VERIFIED:** whether its window grows with the zoom, its range, or its keys. No public documentation covers it.

### Recommended design

**Zoom scales the whole window, so the layout inside is the same at every zoom.**

- **Width:** when the zoom changes from z₀ to z₁, the shell sets width = width × z₁ / z₀. Height already follows the content × zoom.
- **Anchor:** follows the position. Top row: the top edge stays. Bottom row: the bottom edge stays. Left column: the left edge stays. Centre: the centre stays. Right column: the right edge stays. If the window sits exactly at one of the six positions, it is put back there at its new size (`positionPlace`, as `goTo` does today). After a drag elsewhere, it grows from the same anchors.
- **Inside the screen:** always kept inside the work area. If the scaled window would be wider than the work area minus 2 × 16 DIP, the width stops there and the page reflows (panels stack below 600 CSS px).
- **The width you dragged to is remembered at 100 %:** stored as width ÷ zoom, so a drag at 120 % followed by a reset to 100 % returns to the size you chose.
- **Minimum size scales too:** 440 × zoom wide (so the page is never narrower than 440 CSS px), and heights × zoom (already done).
- **Range:** keep **80–130 %** in 10 % steps (D7). 130 % of the 960 maximum is 1248 DIP: fine on 1920, and stops at the screen edge on 1366.
- **The overflow fix (web, also for 1.6.4 shells):** the root takes the window's height in a zoom-safe way: `height: 100%` through `html`/`body`, or `calc(100dvh / zoom)`; the spike picks the one that measures right. The menus' `max-h` uses the same value. No scrollbar at any zoom.
- **Considered and not recommended:** the shell's own page zoom (`webContents.setZoomFactor`). Chromium applies page zoom per site, so it would also zoom the home panel and the call window, which share Kite's site.

```
1920 × 1080, top-centre (anchor: top edge, centre)

80 %  → 614 × ≤413          100 % → 768 × ≤516                     130 % → 998 × ≤671
      ┌──── bars ────┐      ┌─────────── bars ───────────┐   ┌──────────────── bars ────────────────┐
      ├─────┬┬───────┤      ├──────────┬┬────────────────┤   ├──────────────┬┬──────────────────────┤
      │trans││answer │      │transcript││ answer         │   │ transcript   ││ answer               │
      └─────┴┴───────┘      └──────────┴┴────────────────┘   │ (same layout,││ (same layout,        │
                                                              │  bigger)     ││  bigger)             │
  same layout, smaller                                        └──────────────┴┴──────────────────────┘

1366 laptop at 130 % (640 × 1.3 = 832 fits): same layout, bigger.
A dragged 1500-wide window at 130 % (1950 > 1888): width stops at 1888; the page is 1452 CSS px, still side by side.

Bottom-right at 130 %: the bottom-right corner stays put; the window grows up and to the left.
```

**On a 1.6.4 shell (web fix only):** the window stays the same size, the content zooms within it, bar 1 gives way (Transcript stays, issue 3), the panels may stack, and there is **no scrollbar or overlap**. It is acceptable until 1.6.5.

### Files to change

- **Web:** `features/appearance/useAppearance.ts` (zoom stays on `<html>`; expose the zoom as a CSS variable), `CompactView.tsx:613` (root height), `overlay/{LiveMenu,DevicePicker,AnswerPreferencesSheet}.tsx` (menu max height), `overlay/BarTooltip.tsx` (already zoom-aware; re-check), and tests.
- **Desktop 1.6.5:** `apps/desktop/src/windows.ts` (`applyLayout`: track the last scale and scale the width about the anchor; `minFor` × scale; store the width ÷ zoom), `apps/desktop/src/positions.ts` (an anchor helper), `apps/desktop/src/store.ts` (width saved at 100 %, with a version so older values are read correctly), and `apps/desktop/tests/unit/windows.test.ts`. **No new bridge method:** `OverlayLayout.scale` already carries the zoom, so the memory rule about listing bridge methods in two places does not come into play.

**Risk:** medium. (1) Heights already scale. Width scaling must not fight `fittedHeight` or the bottom-row rule (unit-test all six positions × three zooms). (2) The zoom keys are held globally during a call (ADR-0082), so Ctrl+= pressed in the meeting app resizes the overlay. That is intended, but say so in the guide. (3) A zoom step during a slide: `finishSlide()` first, as other moves do.

### Your manual test steps

1. At top-centre, press Ctrl+= three times (130 %): the window grows wider and taller about its top centre, nothing overlaps, no scrollbar, the same layout only bigger. Ctrl+- five times (80 %): smaller, same layout. Ctrl+0: back to the exact size.
2. Repeat at bottom-right: the bottom-right corner stays put.
3. Drag the window to 900 wide at 120 %, press Ctrl+0: about 750 wide. Ctrl+= twice: 900 again.
4. On a laptop screen at 130 % with a wide window: it stops at the screen edge, stays fully on screen, and the panels stack if it gets narrow.
5. Open ⋮ at 130 %: the whole menu fits in the window, with no scrollbar on the page.

---

## Measured results (15 Nov 2026)

Real desktop shell (dev build of this branch; before = `main`), temporary profile, the overlay rig with invented call content, a 1920 × 1200 laptop screen at 150 % (work area 1280 DIP wide). Tool: `apps/desktop/tests/visual/compact-view-check.ts` (page pictures only; the shell's OS windows listed with `window-affinity.ps1`). No paid API calls.

| What | Before (1.6.4 + main) | After (1.6.5 + this branch) |
|---|---|---|
| Overlay protected when first shown, after a call that left Private off | **No** (protected at show: false) | **Yes** |
| Shell windows' capture setting with Private on (every visible OS window of the shell) | 0x11 (left out) for the 3 windows | 0x11 for the 3 windows; also with the real pointer resting on Clear answers |
| Native tooltip window with the pointer on a titled button (account without sync) | none appeared in this run (the overlay was not the active window), so G2 stayed **confirmed in code only**: 6 `title` attributes and no `k-desktop` class | 0 `title` attributes, `k-desktop` set, for both kinds of account |
| Language controls in the compact view | 1 | 0 |
| Transcript open at call start (first call on a device) | no | yes |
| Default window (this screen) | 440 × 440, panels **stacked**, bar 1 at fit step 4, **no Transcript switch** | 640 wide, panels **side by side**, fit step 2, Transcript switch whole |
| 80 % | width 440 (not scaled), stacked | 512 (× 0.80), same layout, no hidden text |
| 130 % | width 440 (not scaled), page **739 px tall in a 568 px window: scrollbar**, fit step 6, Transcript switch gone | 832 (× 1.30), top centre kept, same layout, no scrollbar, no hidden text |
| Ctrl+0 after 130 % | 440 | back to exactly 640 |
| Bottom-right at 130 % | not scaled | bottom-right corner kept, on screen |
| Narrowest (440 at 100 %; 572 at 130 %) | Transcript switch gone; scrollbar at 130 % | Transcript switch whole, ⋮ / Exit whole, no scrollbar |

Corrections found while measuring, fixed in the same change:
- **Panels and width.** The 1.2.0 to 1.6.4 "both panels widen the window" memory pushed a window narrowed with both panels open back to its earlier width. In 1.6.5 the panels never change the width.
- **Zoom timing.** The zoom reaches `<html>` after the overlay measures its height, so at 80 % and 130 % the window was fitted to the old wrapping and the answer scrolled. The page now measures again on the next frame and whenever the panels' content changes size.
- **Scrollbar loop.** A scrollbar that appeared once narrowed the text, which wrapped onto one more line and kept the panel scrolling. The scroll areas now keep room for the scrollbar.
- **Transcript header.** In the narrower transcript panel the header's key-caps followed the window's width. The panel is now a container of its own.

Pictures: `docs/testing/v1.6.5-screenshots/{before,after}/` (default, 80 %, 130 %, bottom centre).

## Release plan

| Batch | Contents | Needs |
|---|---|---|
| Web 1 | 1 (Private first; popups in window for all accounts; no `title=`), 2, 3, 4, 5 (layout at 600, divider, one panel full width), 6 (no overflow at any zoom) | Web deploy; checks; works on the 1.6.4 shell |
| Desktop 1.6.5 | 5 (40 % default, one-time resize), 6 (window scales with zoom, anchored), 1 (backstop: Private on before the overlay shows) | Desktop release and install-check; ADR-0085 and an architecture bump in the same PR |

## Live measurements I would run (with your OK)

All in a **temp profile** with the extracted program, not an installer. Every capture is guarded and read before it is kept. Invented content only. No paid API calls: an empty test session never asks Claude. I'll start these only once the other session has finished with the repo, or you say it's safe.

1. **Zoom:** at 80 / 100 / 130 %, record `innerHeight`, root height and `scrollHeight`, then capture the overlay. This confirms or rules out the `100vh` cause.
2. **Bar 1 widths:** the narrowest width at which the pinned set fits, at 100 % and 130 %.
3. **Private:** screen captures via Windows Graphics Capture, DXGI duplication and GDI with each popup open; the G1 gap in ms; one non-sync account (a local test account) for G2 and G3.

## Decisions I need from you

Decided by the developer on 15 Nov 2026: D1 as recommended (40 %, 640–960, side by side from 600 with a draggable divider); D5 remove both; D6 yes (transcript once for existing users; the answer panel not remembered); D7 80–130 %; Private: both gaps fixed for all accounts, OS indicators out of scope; the Transcript switch pinned for all accounts. All others: as recommended. D13 changed in practice: web and desktop 1.6.5 shipped together.

| # | Decision | My recommendation |
|---|---|---|
| D1 | Default overlay width | 40 % of the screen, at least 640 and at most 960; height half the screen (as now) |
| D2 | Window too narrow for side by side (< 600) | Stack, as today |
| D3 | Divider between the panels | Draggable, double-click resets, remembered per device |
| D4 | Only one panel open | It fills the width; the window keeps its size |
| D5 | Language: also remove "Answer language" from ⋮ | Yes, remove both (the session setting stays) |
| D6 | Transcript open by default: also once for existing users? And stop remembering the answer panel? | Yes and yes |
| D7 | Zoom range | Keep 80–130 % in 10 % steps; the window scales |
| D8 | Private at call start | Web fix now, plus the shell backstop in 1.6.5 |
| D9 | Show the amber "Private is off" line whenever Private is off in a call (today: only while recording) | Yes |
| D10 | Bar 1: keep the Rec pill pinned while recording; keep Transcript where it is (pinned) rather than moving it beside ⋮ | Yes; keep its place |
| D11 | Snap-zones window's `skipTaskbar: true` | Keep (a drag helper, not an app window); confirm |
| D12 | Run the live measurements above, and when | After the other session finishes |
| D13 | Ship web batch 1 first, then desktop 1.6.5 | Yes |

## Sources (public)

- [ParakeetAI website](https://www.parakeet-ai.com/): "Invisible on Screen Share", the platforms it lists as verified, and the language chosen at session start (fetched 15 Nov 2026).
- ParakeetAI feedback board (user reports, not verified): [It is visible on screen sharing](https://parakeetai.featurebase.app/p/it-is-visible-on-screen-sharing), [Parakeet AI got detected in MS Teams entire screen share](https://parakeetai.featurebase.app/p/parakeet-ai-got-detected-in-ms-teams-entire-screen-share), [Visible on Mac OS](https://parakeetai.featurebase.app/p/visible-on-mac-os), [Feature request: better answer window for live interviews](https://parakeetai.featurebase.app/p/feature-request-better-answer-window-for-live-interviews).
