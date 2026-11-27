# ADR-0110: A Mac key set that leaves the Mac's text-editing and window keys alone

- **Status:** Accepted (19 Nov 2026, the developer's brief: "Mac shortcut set that doesn't take over text-editing keys")
- **Date:** 2026-11-19
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.3 (hotkeys) (version 4.48.0)
- **Supersedes / superseded by:** updates ADR-0082 (ParakeetAI's call keys, held globally during a call) and ADR-0095 (the jumps on Ctrl+Shift+Arrows) for macOS only; Windows is unchanged. **Amended 25 Nov 2026** (see the end): the keys were reviewed and stay; Settings and the call say what a key another app holds still does. **Amended 27 Nov 2026** (Mac 1.8.1, ADR-0127): the same keys as Windows with Control (⌃); this replaces the Mac key set below.

## Context

Since desktop 1.6.4 (ADR-0082), the desktop app holds these keys globally for the whole call:
- Clear answers, Clear transcript, previous / next answer;
- the zoom keys;
- the jumps between the overlay's six positions (Ctrl+Shift+Arrows since 1.7.0, ADR-0095).

Every key was written as `CommandOrControl`, so on a Mac it became ⌘. Those are the Mac's core editing and window keys:

| Key on a Mac | What every Mac app uses it for |
|---|---|
| ⌘← / ⌘→ | start / end of the line |
| ⌘⌫ | delete to the start of the line |
| ⌘⇧⌫ | Empty Trash in Finder |
| ⌘= / ⌘- / ⌘0 | zoom (browsers, Zoom, Teams, editors) |
| ⌘⇧ with arrows | select to the line's or document's edge |
| ⌘⌥H | Hide Others (every app's menu) |

During a call these would stop working in every app. That is worse than on Windows, where Ctrl+arrows only move by word.

## Decision

**1. On a Mac, these keys change.** Every other key stays as on Windows, with ⌘ for Ctrl.

| Action | Windows | Mac |
|---|---|---|
| Clear answers | Ctrl+Backspace | ⌃⌥⌫ |
| Clear transcript | Ctrl+Shift+Backspace | ⌃⌥⇧⌫ |
| Previous / next answer | Ctrl+← / → | ⌃⌥← / → |
| Zoom in / out / 100 % | Ctrl+= / - / 0 | ⌃⌥= / - / 0 |
| Show or hide the overlay | Ctrl+Alt+H | ⌃⌥H |
| Jump to the next position | Ctrl+Shift+Arrows | ⌃⌘ with arrows |

Unchanged on a Mac:
- Answer ⌘↵, Screenshot ⌘⇧↵, the voice question ⌘⇧Space, the screenshot and voice question ⌘⌥↵;
- script bar ⌘⌥S, Click-through ⌘⌥X, Record ⌘⌥R, Transcript ⌘⌥T, Ask AI ⌘⌥K;
- the nudge ⌘⌥⇧ with arrows.

**Why ⌃⌥:** the Control key is the Mac's equivalent of Windows' Ctrl for these keys, but ⌃← / ⌃→ alone switch desktops (Mission Control). Adding ⌥ makes a combination no Mac text field or system shortcut uses. The jumps use ⌃⌘ with arrows, because ⌃⌥ with arrows is already previous / next.

**2. One definition, used everywhere.** `packages/shared/src/hotkeys.ts` holds:
- `MAC_HOTKEY_CHANGES` and `MAC_GLOBAL_HOTKEYS`;
- `globalHotkeys(mac)` and `focusedHotkeys(mac)`;
- `hotkeyAccelerator(hotkey, mac)` and `hotkeyRows(mac)`, for Settings.

The labels show ⌃ for `Control` and ⌘ for `Command`.

**Who uses it:**
- **The desktop shell** registers `globalHotkeys(process.platform === 'darwin')`.
- **The page's own key handling** (`platform/keymap.ts`, `macHotkeyFor()`) uses the Mac keys in the Mac desktop app and in a browser on a Mac. It matches ⌃⌥ keys by the key's place (`e.code`), because Option changes the typed character (⌥= types "≠"). ⌘⌫, ⌘← / ⌘→ and ⌘= / - / 0 are no longer taken in the page either.
- **The labels** use the Mac keys on a Mac: Settings → Hotkeys, the key caps, the overlay's tooltips and `aria-keyshortcuts`, the conflict messages, and the Help guide's new Mac column.

## Consequences

- During a call on a Mac, other apps keep line-start / line-end, delete-to-line-start, zoom, selection to the edges and Hide Others.
- Mac users learn a few different keys from Windows users. The Help guide lists both columns side by side.
- **VoiceOver:** ⌃⌥ is VoiceOver's own key (VO). With VoiceOver on, during a call its VO+⌫, VO+← / →, VO+= / - / 0 and VO+H go to Paramount AI. VoiceOver can use Caps Lock as its key instead (VoiceOver Utility → General).
- **Other apps' shortcuts:** window managers (Rectangle, Magnet) use ⌃⌥ with arrows by default. Electron then cannot hold those keys, and Settings → Hotkeys says "In use by another app", as it already does for any taken key.
- **Non-US layouts:** the page matches ⌃⌥ keys by place. The shell's global keys follow Electron's key mapping. A layout where `=` or `-` sits elsewhere may need the key at its US place; this is checked in the real-Mac test.
- No change on Windows: `globalHotkeys(false)` is `DEFAULT_GLOBAL_HOTKEYS`, and a test checks it.

## Alternatives considered

- **Keep ⌘ (ParakeetAI parity as in ADR-0082).** Rejected by the brief: it takes the Mac's editing keys from every app for the whole call.
- **Hold these keys only while Paramount AI is in front, on a Mac.** Rejected: the Mac app should work like the Windows one, where these keys work from any app during a call.
- **⌃ alone.** ⌃← / ⌃→ switch desktops and ⌃↑ opens Mission Control (system shortcuts).
- **⌘⌥ with arrows for previous / next.** That is "previous / next tab" in Chrome, Safari and VS Code: the meeting's own browser would lose it.

## Validation

- Unit tests:
  - the Mac set never contains a Mac editing or window key, changes nothing else, and has no two actions on the same keys;
  - labels read ⌃ ⌥ ← and ⌃ ⌘ ↑;
  - the shell holds the Mac keys and forwards each press;
  - the page matches ⌃⌥ keys by place and leaves ⌘⌫, ⌘← / ⌘→ and ⌘= / - / 0 alone;
  - Settings lists the Mac keys;
  - Windows is unchanged.
- The real-Mac test (`docs/testing/mac-release-test.md`):
  - during a call, ⌘← moves to the start of a line in TextEdit;
  - ⌃⌥← shows the previous answer;
  - ⌃⌥H hides the bars;
  - ⌃⌘↑ moves them to the top row;
  - Settings → Hotkeys shows the Mac keys.

## Amendment (25 Nov 2026): the keys reviewed; what a taken key still does

**Review.** The developer asked for the Mac keys to match Windows wherever that clashes with no macOS system shortcut (Spotlight, Mission Control, input sources, screenshots) and no Zoom, Meet or Teams shortcut, keeping the deliberate differences. Every key was checked (investigation `docs/investigations/2026-11-25-mac-windows-parity-and-backlog.md`, Part B).

- **11 of the 23 call shortcuts already match Windows**, with ⌘ for Ctrl: Answer, Screenshot, the voice question, the screenshot and voice question, the script bar, Click-through, Rec, the four nudges, plus Ask AI, Transcript and Esc.
- **The other 12 (6 actions) stay different.** Matching Windows would clash with a Mac text, Finder or system key (⌘ for Ctrl) or a Mission Control key (⌃ for Ctrl):

| Action | Windows | Mac (kept) | ⌘ for Ctrl would take | ⌃ for Ctrl would take |
|---|---|---|---|---|
| Previous / next answer | Ctrl+← / → | ⌃⌥← / → | start / end of the line | Mission Control: move a space |
| Clear answers | Ctrl+⌫ | ⌃⌥⌫ | delete to line start; Finder's Move to Trash | delete backward (text) |
| Clear transcript | Ctrl+⇧+⌫ | ⌃⌥⇧⌫ | Finder's Empty Trash | — (kept with Clear answers) |
| Zoom in / out / reset | Ctrl+= / - / 0 | ⌃⌥= / - / 0 | every app's zoom, Chrome's (Meet) and Teams' | — (kept with the ⌃⌥ set) |
| Show or hide overlay | Ctrl+Alt+H | ⌃⌥H (the same keys pressed) | Hide Others in every app | — |
| Jump between the six positions | Ctrl+⇧+arrows | ⌃⌘ arrows | select to the line's or document's edge | select to the line's edge (⌃⇧ arrows) |

- **No key changes**: there was nothing left to align. `apps/web/tests/unit/shared/hotkeys.test.ts` now pins the whole table on both systems, and checks that no Mac key takes a macOS system key (Spotlight, input sources, Character Viewer, Mission Control, screenshots) or a published Zoom, Meet or Teams key. On Windows the one known clash is kept in the test: show or hide (Ctrl+Alt+H) is Google Meet's raise hand. That is the developer's decision, and changing it needs a Windows release.

**What a key another app holds still does** (web only):
- The page handles some shortcuts itself (`PAGE_HANDLED_HOTKEYS` in `packages/shared/src/hotkeys.ts`): Answer, Screenshot, the voice questions, Clear, previous / next, zoom, the script bar, Ask AI, Transcript, Esc. Held by another app, these still work with Paramount AI in front.
- The others (show or hide, the jumps and nudges, Click-through, Rec) are only the desktop app's global shortcuts. Held by another app, they do not work at all.
- The call's warning now says which is which ("…so it does not work during this call"); it said "works only while Paramount AI is in front" for all of them.
- Settings → Hotkeys says the same on each taken row.
- In a browser, Settings marks the desktop-only shortcuts "Desktop app only". It said all of them work in a browser.
- On a Mac, Settings adds a note: macOS may not tell Paramount AI that another app uses the same keys (unverified on a real Mac; the release test checks it with Rectangle), so it suggests checking window tools such as Rectangle or Magnet (⌃⌥ arrows) and VoiceOver.

## Amendment (27 Nov 2026, Mac 1.8.1): the same keys as Windows, with Control (⌃)

**Decision (the developer's brief, ParakeetAI parity; ADR-0127):**
- A Mac now uses every Windows key with **Control (⌃) for Ctrl** and Option (⌥) for Alt.
- No Paramount AI shortcut uses ⌘ any more, so every ⌘ key keeps its Mac meaning in every app.
- Show or hide becomes **Ctrl+Alt+Y / ⌃⌥Y** on both systems (ADR-0127 §3; Ctrl+Alt+H is Google Meet's raise hand on Windows).
- This replaces the 19 Nov 2026 decision above and the 25 Nov review.

**Before and after.** "Mac 1.8.0" is the key set above; "Mac 1.8.1" is this amendment (and the web app on a Mac).

| Action | Windows 1.7.4 | Windows 1.7.5 | Mac 1.8.0 | Mac 1.8.1 |
|---|---|---|---|---|
| Answer | Ctrl+Enter | Ctrl+Enter | ⌘↵ | ⌃↵ |
| Answer from a screenshot | Ctrl+Shift+Enter | Ctrl+Shift+Enter | ⌘⇧↵ | ⌃⇧↵ |
| Your own last spoken question | Ctrl+Shift+Space | Ctrl+Shift+Space | ⌘⇧Space | ⌃⇧Space |
| Screenshot and voice question | Ctrl+Alt+Enter | Ctrl+Alt+Enter | ⌘⌥↵ | ⌃⌥↵ |
| Previous / next answer | Ctrl+← / → | Ctrl+← / → | ⌃⌥← / → | ⌃← / → |
| Clear answers | Ctrl+⌫ | Ctrl+⌫ | ⌃⌥⌫ | ⌃⌫ |
| Clear transcript | Ctrl+Shift+⌫ | Ctrl+Shift+⌫ | ⌃⌥⇧⌫ | ⌃⇧⌫ |
| Zoom in / out / 100 % | Ctrl+= / - / 0 | Ctrl+= / - / 0 | ⌃⌥= / - / 0 | ⌃= / - / 0 |
| **Show or hide the overlay** | **Ctrl+Alt+H** | **Ctrl+Alt+Y** | **⌃⌥H** | **⌃⌥Y** |
| Script bar | Ctrl+Alt+S | Ctrl+Alt+S | ⌘⌥S | ⌃⌥S |
| Click-through | Ctrl+Alt+X | Ctrl+Alt+X | ⌘⌥X | ⌃⌥X |
| Record | Ctrl+Alt+R | Ctrl+Alt+R | ⌘⌥R | ⌃⌥R |
| Jump between the six positions | Ctrl+Shift+arrows | Ctrl+Shift+arrows | ⌃⌘ arrows | ⌃⇧ arrows |
| Nudge | Ctrl+Alt+Shift+arrows | Ctrl+Alt+Shift+arrows | ⌘⌥⇧ arrows | ⌃⌥⇧ arrows |
| Ask AI (always) | Ctrl+Alt+K | Ctrl+Alt+K | ⌘⌥K | ⌃⌥K |
| Transcript (bars focused) | Ctrl+Alt+T | Ctrl+Alt+T | ⌘⌥T | ⌃⌥T |
| Cancel a voice question | Esc | Esc | Esc | Esc |

**Clashes on a Mac (1.8.1),** checked against Apple's lists and Zoom Workplace, Google Meet and Microsoft Teams (read 27 Nov 2026). Each one is pinned in `apps/web/tests/unit/shared/hotkeys.test.ts`.

| Mac key | What else uses it | What happens during a call | How Settings → Hotkeys warns (`MAC_SYSTEM_CLASHES`) |
|---|---|---|---|
| ⌃← / ⌃→ (previous / next) | macOS Mission Control: move a space left / right (on by default) | macOS takes them first: they switch desktops and do not reach Paramount AI | Previous / next row: "macOS uses ⌃ ← and ⌃ → to move between desktops… turn off Move left / right a space in System Settings › Keyboard › Keyboard Shortcuts › Mission Control, or use the ← → buttons on the answer panel." |
| ⌃0 (zoom 100 %) | Microsoft Teams on a Mac: reset zoom | Resets the overlay's zoom instead of Teams' | Zoom row: "Microsoft Teams on a Mac uses ⌃ 0 to reset its own zoom…" |
| ⌃⌫ (Clear answers), ⌃⇧← / → (jumps) | macOS text editing: delete backward; select to the line's edge | In other apps' text boxes these edit nothing during a call | Clear and jump rows: "In text boxes of other apps, these keys also edit text…" |
| Every ⌃⌥ key (screenshot and voice, script bar, Click-through, Record, show or hide, nudges, Ask AI, Transcript) | VoiceOver's VO key, only while VoiceOver is on | VoiceOver gets them first | Those rows: "⌃ ⌥ is VoiceOver's key… VoiceOver Utility › General can use Caps Lock instead." |
| ⌃Space / ⌃⌥Space (input sources), ⌃↑ / ⌃↓ (Mission Control), ⌃⌘Space, ⌃⌘F, ⌃⌘Q | macOS | Not used by Paramount AI | — |
| Zoom: ⌃\, ⌃P, ⌃N, ⌃⇧R, ⌃⇧G, ⌃⇧ letters, ⌃⌥⌘H, ⌃⌥⇧V | Zoom Workplace | Not used by Paramount AI | — |
| Meet: ⌘D, ⌘E, ⌃⌘ letters | Google Meet in Chrome | Not used (Meet's Mac keys are ⌃⌘) | — |
| Teams: ⌘⇧ letters, ⌃⌘ letters, ⌃L, ⌃1–9, ⌥Space | Microsoft Teams | Not used | — |

- Window tools (Rectangle, Magnet) may use ⌃⌥ with arrows. Paramount AI no longer holds ⌃⌥ with arrows alone; the nudges are ⌃⌥⇧ arrows.
- The general note stays: macOS may not report a key another app holds.

**Until a Mac updates:**
- Mac 1.8.0 keeps holding its old keys, which all still work.
- Settings → Hotkeys shows the keys the app reports (`rowKeys()`).
- The overlay's tooltips and the Help guide already show the 1.8.1 keys.

**Validation:**
- Unit:
  - `hotkeys.test.ts`: the table and the clashes;
  - `keymap.test.ts`: ⌃ keys in the page, ⌃⌥ letters by place, ⌘ keys left alone;
  - `apps/desktop/tests/unit/hotkeys.test.ts`: the shell holds no ⌘ key, and Ask AI is ⌃⌥K;
  - `HotkeyList.test.ts`: the notes, and a 1.8.0 app's own keys.
- Real Mac (runbook "Desktop 1.8.1 / 1.7.5"):
  - ⌃↵ answers;
  - ⌃⌥Y hides;
  - ⌘← still goes to the line's start in TextEdit during a call;
  - ⌃← with Mission Control's shortcut turned off shows the previous answer.
