# ADR-0111: The Mac desktop app at parity with Windows (permissions, full-screen meetings, screenshots, menus, Private)

- **Status:** Accepted (19 Nov 2026, the developer's brief for stage 4: "full parity with Windows"). Verified in code and unit tests only; the real-Mac test (stage 6) confirms it on a Mac.
- **Date:** 2026-11-19
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §4, §7.3 (version 4.48.0)
- **Supersedes / superseded by:** builds on ADR-0109 (the Mac release) and ADR-0110 (the Mac keys); extends ADR-0042 and ADR-0085 (Private), ADR-0043 (screenshots leave Kite out), ADR-0068 (recording), ADR-0106 (exit with uploads); amended by ADR-0120 (no page zoom in the Mac menu; a Mac wording for "Private is off" on the warning line; the snap zones join every Space)

## Context

Nobody had run the desktop app on a Mac. A code review of every macOS path (19 Nov 2026) found these gaps.

**Permissions**
- macOS needs two permissions: the Microphone, and Screen & System Audio Recording.
- The app never told anyone in advance. Each one failed only at Connect, with a message.
- After Screen Recording is turned on, macOS applies it only once the app has been reopened, and no message said so.

**The other side's sound**
- The shell offered it from macOS 13.
- Electron 44's docs describe only the CoreAudio Tap path, which needs macOS 14.2. The older path's switch was removed upstream.
- So macOS 13 to 14.1 would have shown a permission message that could not help.

**Full-screen meetings**
- macOS gives a full-screen app its own desktop space.
- The always-on-top overlay did not join that space, so the bars stayed behind on the normal desktop.

**Screenshots**
- They leave Kite's own windows out with `setContentProtection` (ADR-0043).
- On recent macOS the screen capture Electron uses (ScreenCaptureKit) ignores it, so the answer would describe Kite itself.

**Menus**
- The app set no menu, so macOS showed Electron's default one.
- On a Mac the app menu's shortcuts reach every window, including the frameless overlay. ⌘R would reload a call's page, ending the call; ⌘W would close the overlay; ⌥⌘I would open the developer tools.
- On Windows the overlay has no menu, so none of this happens there.

**Menu bar icon**
- The logo was scaled to a single 18 px picture, which macOS draws blurry on a Retina screen.

**Private**
- On recent macOS, apps built on ScreenCaptureKit (Chrome, so Google Meet; recent Zoom and Teams) can still show Kite's windows in a whole-screen share (Electron docs).
- The app only said "some capture apps may still show them" in an info tooltip.

**Messages**
- The microphone, the browser's share and the recording-folder failures named Windows' settings or "site settings", never macOS's own.
- The permission texts said "The audio stays on this Mac". Since ADR-0101, the audio goes to the cloud transcription service during the call.

**Checked, and fine as they are**
- **⌘Q** goes through `before-quit`, so the exit with Drive work left (ADR-0106) behaves as on Windows.
- Closing the last window leaves the app in the Dock and the menu bar, as Mac apps do.
- The tray (menu bar) menu opens on a click.
- **Recordings** use H.264 through the Mac's hardware encoder (VideoToolbox, found by WebCodecs) and the same JavaScript finaliser (Mediabunny).

## Decision

**1. A permission screen (desktop 1.8.0).**
- **New shell module:** `src/macPermissions.ts`. It reads both states (`systemPreferences.getMediaAccessStatus`), asks for one, opens System Settings at that permission's page, and quits and reopens the app.
  - The microphone uses macOS's own question (`askForMediaAccess`).
  - Screen recording lists the screens once, which adds Paramount AI to System Settings and shows macOS's prompt.
  - Quit and reopen goes through the usual exit, so uploads finish first.
- **Bridge methods:** `macPermissions`, `requestMacPermission`, `openMacPrivacySettings`, `relaunchApp`.
  - The page sends only a permission's name.
  - Only the Kite page may ask.
  - System Settings opens only at two fixed addresses.
- **In the web app:** `features/permissions/MacPermissions.tsx`.
  - **Where it shows:**
    - on the home panel before the first call, until both are on (with **Later** for this run);
    - in place of the start whenever **Connect** finds one missing (home panel and call window).
  - **Each row's button:**
    - **Allow** the first time;
    - **Open System Settings** once refused;
    - nothing when allowed;
    - "ask IT" when a device policy blocks it.
  - While Screen Recording is off, the card says to turn on Paramount AI there and **quit and reopen**, with that button.
  - Only in the Mac desktop app (`platform.macPermissions`). Nothing changes elsewhere.
- **Start-up log:** the shell logs both states at each start, the words only (ADR-0109 §5).

**2. The other side's sound needs macOS 14.2 or later** (`canCaptureSystemAudio`). On older versions the app says "macOS 14.2 or later is needed; use Chrome and share the meeting tab". Every Screen Recording message now ends "quit and reopen Paramount AI and connect again".

**3. The overlay floats over full-screen meetings on a Mac.** It calls `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`.
- Electron switches the app's type for a moment to do it, so the Dock icon blinks once when the bars open.
- The app is never hidden (CLAUDE.md).

**4. Screenshots on a Mac make Kite's windows fully see-through for the capture** (`hideByOpacity`, about 120 ms), then put back each window's own opacity (the overlay's slider sets it). Windows keeps content protection.

**5. A Mac application menu** (`src/macMenu.ts`):
- **Paramount AI:** About, Services, Hide, Hide Others, Show All, Quit.
- **Edit:** a Mac needs it for ⌘C / ⌘V / ⌘X / ⌘A / ⌘Z in text boxes.
- **View:** the page zoom and Full Screen.
- **Window:** Zoom and Bring All to Front.
- Nothing that reloads, closes or minimises the overlay, or opens the developer tools. Windows keeps Electron's default.

**6. The menu bar icon** holds the logo at 18 px and 36 px (Retina). It keeps its colours: a monochrome "template" icon needs the designer's artwork (added to the Day 6 design list).

**7. Private on a Mac.**
- While Private is on, Mac users see **"On Mac, share a single window or tab, not your entire screen."** It is a line under the Private switch in both ⋮ menus, the first sentence of the Settings hint, and in the Help guide.
- The Mac info text says what macOS allows, names the apps that can still show the windows, and says the app stays in the Dock.
- No status-bar line: Private is on at the start of every call (ADR-0085), so a line would replace the live transcript line on every Mac call.

**8. Mac words for Mac problems.**
- **A refused microphone** names System Settings → Privacy & Security → Microphone: Paramount AI in the desktop app, the browser in a browser.
- **A browser share without sound on a Mac** says only a browser tab shares its sound: join the meeting in a Chrome tab, not the Zoom or Teams app, or use the desktop app.
- **Chrome refused by macOS** suggests sharing the meeting's tab (no permission needed).
- **A recording that cannot create its files** names the Documents folder permission.
- **The Info.plist texts** no longer say the audio stays on the Mac. A Documents folder text is added (macOS asks before the first recording is saved).

## Consequences

- A Mac user is told which permissions are missing and how to turn them on before the first call, and again at Connect, instead of a failed Connect.
- macOS 13.0 to 14.1 can no longer try the desktop app's system audio. They are pointed to Chrome, the only path that works there.
- The Dock icon blinks once as the bars open on a Mac (Electron's documented behaviour for full-screen spaces).
- A screenshot on a Mac makes Kite's windows invisible for about 120 ms. On Windows nothing changes.
- The Mac menu has no Reload and no developer tools. To reload a page, close and reopen its window.
- Nothing here can be checked without a Mac. Every item is on the stage-6 checklist (`docs/testing/mac-release-test.md`).

## Alternatives considered

- **Ask macOS for both permissions as the app starts.** Rejected: questions with no context, before the person knows why. The card explains first, then asks on a button.
- **Hide the app's Dock icon for the overlay** (the common recipe for floating over full-screen apps). Rejected: CLAUDE.md never hides the app from the Dock.
- **Hide Kite's windows (hide()) for a screenshot.** Rejected: it can move focus and make the windows flicker in the window list. Opacity changes only the pixels.
- **Keep Electron's default menu.** Rejected: ⌘R and ⌘W would reach the overlay, which on Windows has no menu.
- **A status-bar line for the Private advice.** Rejected: it would replace the live words on every Mac call (see §7).

## Validation

- Unit tests:
  - the permission module (states, requests, the two System Settings pages, refusals, Windows does nothing) and the bridge lists (unit and smoke);
  - the permission card and Connect's check;
  - `canCaptureSystemAudio` from 14.2;
  - `floatOverFullScreen`, `hideByOpacity`, `menuBarImage` and `macMenuTemplate`;
  - the Private note and Mac hint;
  - the Mac messages (microphone, browser share, Chrome refused, capture).
- The real-Mac test (stage 6) checks each item on macOS 14.2 or later, on Apple-chip and, where possible, Intel Macs.
