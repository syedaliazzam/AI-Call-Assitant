# ADR-0127: Desktop Mac 1.8.1 and Windows 1.7.5: Check for Updates, one key table, a new show/hide key, the screen under the pointer

- **Status:** Accepted (27 Nov 2026, the developer's brief "Desktop release batch: Mac 1.8.1 + Windows 1.7.5")
- **Date:** 2026-11-27
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.3 (hotkeys, screenshots), §10 (installation, updates) (version 4.66.0)
- **Supersedes / superseded by:** amends ADR-0110 (the Mac keys; see its amendment of 27 Nov 2026), ADR-0028 (updates: a manual check), ADR-0043 / Day 5 (which screen a screenshot takes), ADR-0055 (amended 26 Nov 2026: the Windows tray's "Turn click-through off" ships in 1.7.5).

## Context

The brief asked for one desktop release on both systems:
1. "Check for Updates…" in the Mac app menu and the Windows tray. Until now an update came only at start and every 6 hours.
2. The same keys on a Mac as on Windows, as ParakeetAI does: Control (⌃) for Ctrl, not ⌘.
3. A new show / hide key. Ctrl+Alt+H is Google Meet's "raise hand" on Windows.
4. The Windows tray's "Turn click-through off" during a call (Mac 1.8.0 has it).
5. Screenshots of the screen under the mouse pointer. The card should show a thumbnail and "Screen 2", and offer "Wrong screen?".
6. Versions: Mac 1.8.1, Windows 1.7.5.

The web app goes live first. It must keep working with Windows 1.7.4 and Mac 1.8.0 until they update.

## Decision

### 1. Check for Updates… (desktop)

- **Where:**
  - Mac: the **Paramount AI** menu, under About, with no shortcut.
  - Windows: the tray menu, under Open. It is not offered in a Microsoft Store install, which the Store updates, or after an exit while uploads finish.
- **What it does** (`updater.ts` `checkNow()` and `manualCheckReply()`; `main.ts` `checkForUpdatesNow()`):
  - It checks at once and shows a message box: **You're up to date** (Paramount AI X is the newest version), **Downloading Paramount AI Y** (it asks to restart when ready, never during a call), **Could not check for updates**, or, in a development run, **Updates are not checked here**.
  - An update that has already downloaded gets the usual **Restart now / Later** question again.
  - During a call, or while Drive uploads are left, it says the question comes when they end.
  - The restart rules are unchanged: never during a call, never with uploads left.

### 2. One key table (shared, web and desktop)

- `MAC_GLOBAL_HOTKEYS` is every Windows key with Control (⌃) for Ctrl and Option (⌥) for Alt (`macKeys()`). Ask AI is ⌃⌥K and Transcript ⌃⌥T (`hotkeyAccelerator(…, true)`).
- No Mac shortcut uses ⌘ any more. The page reads ⌃⌥ letters by the key's place (`keymap.ts` `macPress()`), because Option changes the typed character.
- The full table and every clash are in ADR-0110's amendment of 27 Nov 2026.
- **Settings warnings:** on a Mac, Settings → Hotkeys gives each row the macOS shortcut it shares (`MAC_SYSTEM_CLASHES`, `macSystemNotes()`). macOS does not report these as taken:
  - ⌃← / ⌃→ move between desktops (Mission Control);
  - ⌃0 is Microsoft Teams' reset zoom;
  - ⌃⌫ and ⌃⇧← / → edit text;
  - ⌃⌥ is VoiceOver's key.

### 3. Show or hide: Ctrl+Alt+Y (⌃⌥Y on a Mac)

The candidates were checked against each vendor's published list (read 27 Nov 2026): Google Meet (Windows and Mac), Zoom Workplace, Microsoft Teams, macOS defaults and VoiceOver, and the AltGr layers of the Polish, German, Swiss, French, Spanish, Italian, UK, Czech and Turkish Windows layouts.

| Candidate | Windows meeting apps | Mac (⌃ for Ctrl) | AltGr (= Ctrl+Alt) types a character | Verdict |
|---|---|---|---|---|
| **Ctrl+Alt+Y** | none | none (VoiceOver only while on) | French Standard AZERTY only (`}`) | **Chosen** |
| Ctrl+Shift+\ | none | none | none | Runner-up: the `\` key sits elsewhere, or is missing, on many non-US layouts, and the label would not match the key |
| Ctrl+Alt+J | Meet: fewer tiles | VoiceOver | none | No |
| Ctrl+Alt+B | Teams: meeting chats | VoiceOver | Czech, Polish (214) `{` | No |
| Ctrl+Alt+O | none | VoiceOver | ó (Polish, UK), œ (French) | No |
| Ctrl+Alt+V / G / Q / W / N / D | none | VoiceOver | several layouts | Possible, but more AltGr clashes than Y |
| Ctrl+Alt+I / M / U / L / F / Z / A / E | Meet, Zoom or Teams | VoiceOver | several | No |
| Ctrl+\ | none | Zoom: always show meeting controls | none | No |
| Ctrl+Alt+Shift+H | Zoom: floating meeting controls | VoiceOver | — | No |

Ctrl+Alt+Y also keeps show / hide with the other Ctrl+Alt keys (S, X, R, K, T).

### 4. Windows tray: Turn click-through off (desktop, Windows 1.7.5)

No new code. `tray.ts` (ADR-0055, 26 Nov 2026) is the same on both systems. Windows 1.7.4 was built before it existed; 1.7.5 is the first Windows build with it.

### 5. The screen under the pointer, its name, and "Wrong screen?"

- **Desktop** (`screenshot.ts` `pickDisplay()`):
  - It captures the display under the mouse pointer (`screen.getCursorScreenPoint()`).
  - If the pointer cannot be read, it uses the display of the Paramount AI window with the keyboard. "The active window" means Paramount AI's own window, because Electron cannot see other apps' windows without a native add-on and a macOS permission.
  - Otherwise it uses the overlay's display (as before), then the main display.
  - The result names the screen: `screen: { id, number, count, picked }`. Screens are numbered from the left, then from the top.
  - The page may ask for `{ notDisplayId }`, which takes the next screen in that order. Only a display id made of digits crosses IPC.
  - The log has the number and how it was chosen, never the image.
- **Web:**
  - `CapturedScreenshot` carries `screen`.
  - The card keeps the screen and a small preview, in memory only (`AnswerEntry.screen`, `AnswerEntry.preview`).
  - The preview is a JPEG of at most 240 px (`makePreview()`), made after the answer request has gone, so it never delays an answer. It is small enough for the overlay's state messages.
  - Both cards show the thumbnail. With more than one screen they also show "Screen 2" and **Wrong screen?** (`ScreenshotSource.tsx`). It takes the next screen and asks again on the same card, screen-only as before, or with the card's own question (`retakeScreen()`, trace trigger `screenshot-retake`). The overlay sends `wrong-screen`.
- **Older shells:**
  - Windows 1.7.4 and Mac 1.8.0 ignore the request and send no `screen`.
  - The page then shows the thumbnail only, with no screen name and no "Wrong screen?".
  - This is feature detection by the result, never by version.

### 6. Versions

- `apps/desktop/package.json` has `"version": "1.8.1"` (the Mac; `build.sh` reads it) and `"windowsVersion": "1.7.5"`.
- `dist:win` runs `scripts/dist-win.mjs`, which builds with `-c.extraMetadata.version=1.7.5`, as `build.sh --version` does on a Mac. Each update channel compares only its own versions.

## Consequences

- **Web vs desktop:**
  - From the web deploy on: the page's keys, labels, the Help guide, the Settings notes, the thumbnail and screen name on the cards, and the deferred preview.
  - Only with the new apps: the shell's global keys, Check for Updates…, the Windows tray item, the pointer's screen and "Wrong screen?".
- **Until each app updates:**
  - Mac 1.8.0 keeps holding its old keys and Windows 1.7.4 keeps Ctrl+Alt+H. Every key still works: a global shortcut fires even with Paramount AI in front.
  - Settings → Hotkeys shows the keys the app reports holding (`rowKeys()`).
  - The overlay's tooltips and the Help guide already show the new keys.
- **On a Mac:**
  - ⌃← / ⌃→ do nothing until Mission Control's "Move left / right a space" is turned off. Settings and the Help guide say so, and the answer panel's ← → buttons always work.
  - ⌃0 resets Paramount AI's zoom instead of Teams' during a call.
- **On Windows,** clashes that were there before and are unchanged by this release (pinned in `hotkeys.test.ts`):
  - Teams' sharing toolbar: Ctrl+Shift+Space.
  - Teams: Ctrl+Alt+Enter, Ctrl+Alt+R, Ctrl+Alt+X, Ctrl+Alt+K.
  - Zoom's and Teams' zoom: Ctrl+= / - / 0.
  - Meet: Ctrl+Alt+K (more tiles), Ctrl+Alt+S and Ctrl+Alt+X (screen-reader announcements).
  - These are the developer's call for a later release.

## Alternatives considered

- **Keep the ADR-0110 Mac keys:** rejected by the brief (ParakeetAI parity).
- **Gate the page's keys on the shell's version:** rejected. Labels would need a third key set for a few hours of Mac 1.8.0, every key works either way, and Settings already shows the shell's real keys.
- **An "active window" library (for example `active-win`):** a native dependency, and on macOS it needs Screen Recording access to read window titles. The pointer is what a person looks at, and the retake covers the rest.
- **Make the preview in `prepareScreenshot()`:** measured in the sim-call tests, it delayed every screenshot answer by one JPEG encode (about 1 s in headless Chromium), so it moved to after the request.

## Validation

- Unit (web): `tests/unit/shared/hotkeys.test.ts` (the table on both systems, the clashes, the Settings notes), `platform/keymap.test.ts`, `platform/desktop.test.ts` (`screenOf()`, old and new shells), `features/live/ScreenshotSource.test.tsx`, `core/live/liveChannel.test.ts` (`wrong-screen`), `core/screenshot/prepare.test.ts` (`makePreview()`), `features/settings/HotkeyList.test.ts` (a 1.8.0 or 1.7.4 app's keys; the notes).
- Unit (desktop): `screenshot.test.ts` (`pickDisplay()`, `toScreenshotRequest()`), `hotkeys.test.ts` (⌃ keys, Ask AI ⌃⌥K, Ctrl+Alt+Y), `updater.test.ts` (`checkNow()`, `manualCheckReply()`), `tray.test.ts`, `macMenu.test.ts`, `preload.test.ts`.
- Integration: `sim-calls.spec.ts`, which covers two cases. A 1.7.5-style shell with two screens: "Screen 1 of 2", then "Wrong screen?", then the same card answers from screen 2, screen-only. A 1.7.4-style shell: thumbnail only.
- Real machines: the first-update test plan in `docs/deploy/mac-release-runbook.md` ("Desktop 1.8.1 / 1.7.5").
