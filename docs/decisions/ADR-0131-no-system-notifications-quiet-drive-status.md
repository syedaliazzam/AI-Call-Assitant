# ADR-0131: No system notifications or unrequested pop-ups; Drive upload status shows quietly on the session

- **Status:** Accepted (27 Nov 2026; branch `no-system-notifications`; web, plus desktop Mac 1.8.2 / Windows 1.7.6)
- **Date:** 2026-11-27
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (dashboard, desktop "Your sessions"), §7.3 (desktop `drive/`, `updater.ts`), §10 (updates) (version 4.69.0)
- **Supersedes / superseded by:** amends ADR-0072 (the "saved" notification and in-app notice), ADR-0028 and ADR-0127 (when the restart question is shown), ADR-0106 (the background-upload notification)

## Context

After a call ends, the user may still be sharing their screen in the meeting. Screen-share protection (`setContentProtection`, "Private") covers only Kite's own windows. **System notifications are not covered:** a Windows toast, macOS Notification Center, the browser Notification API, and native message boxes are separate windows drawn by the system. Everyone in the meeting sees them.

Kite showed **"Recording and transcript saved — Acme – Backend Engineer"** as a native notification when a call's Drive upload finished. That is usually a minute or two after the call, while the meeting may still be shared.

An audit of every system notification and pop-up both apps can show found three that appear without the user asking:

| # | What | Where it came from | When |
|---|---|---|---|
| 1 | "Recording and transcript saved — <session>", "Open in Drive" | Web uploader (`core/drive/uploader.ts`, `callUploader.ts`) → `platform.drive.notify()` → bridge `showNotice` → desktop `drive/notice.ts` (Electron `Notification`) | Each call's Drive upload finishing, minutes after the call |
| 2 | "A new version of Paramount AI is ready." **Restart now / Later** (native message box) | Desktop `updater.ts` `maybeAsk()` | **The moment a call ended** if an update had downloaded; also on download, or when Drive uploads finished |
| 3 | "Uploading 1 recording to Drive. Paramount AI will close when it's done." | Desktop `drive/background.ts` → Electron `Notification` | The user exits with Drive uploads left, often right after a call |

There was also an in-app "saved" banner at the bottom of the dashboard and the desktop launcher (`DriveNotices.tsx`). It did not show on the call page, but it popped up over the dashboard.

## Decision

**Rule:** Kite shows no system notification. It opens no native message box the user did not ask for. Status goes in the page: on the session, in the dashboard and in the desktop session list.

### Web (live after the production deploy; desktop apps pick it up on restart)

1. **No "saved" notification.**
   - The uploaders no longer have a `notice` dependency, and `runner.ts` passes none.
   - The platform's Drive host no longer has `notify` (`platform/drive.ts`, `platform/types.ts`). The page cannot ask the shell for one.
   - This removes item 1 on **every** desktop version already installed, because the old shells only showed it when the page asked.
2. **No "saved" banner.** `DriveNotices.tsx` keeps only the admin "Google Drive needs an admin to reconnect it" notice. That notice is in the dashboard page itself, and never on a call page.
3. **Quiet status on the session.** The status line on each session card (`DriveSessionStatus.tsx`) is the only place an upload's outcome shows. The same card is used in the dashboard and in the desktop launcher's "Your sessions". It says:
   - **"Uploading…"**: queued; "Uploading… 42%" while sending; "Uploading… paused for the call" during a call.
   - **"Saved to Drive ✓"**: links to the session's Drive folder.
   - **"Upload failed —" Retry**: the reason is the tooltip.
   - What to fix in Settings, with a **Settings** link (reconnect, folder, saving off), as before.

   The words are `driveStatusWords()`, a pure function. The session page's per-call list (`CallsList.tsx`) uses the same words.

### Desktop shell (Mac 1.8.2 / Windows 1.7.6)

4. **The notice channel shows nothing.**
   - `drive/notice.ts` is deleted.
   - `kite:show-notice` stays registered, for the Kite origin only, so an older cached page gets an answer instead of an error. It always answers `false`.
5. **No restart question on its own.**
   - A downloaded update installs when the user quits Paramount AI (`autoInstallOnAppQuit`, as "Later" always did).
   - Nothing asks after a download, at the end of a call, or when uploads finish.
   - **Check for Updates…** (Mac app menu, Windows tray) still asks **Restart now / Later** outside a call and uploads, because the user asked for it.
   - Its messages now say the update "is installed the next time you quit Paramount AI".
   - The Day 6 update test's hook (`KITE_TEST_UPDATE_ACCEPT=1`) still restarts at once.
6. **No background-exit notification.** The app still runs on with its tray icon to finish uploads. The tray's tooltip and menu say what is left, as before.

### Kept: shown only because the user asked, or before any call

| What | Why it stays |
|---|---|
| "Check for Updates…" result box and its Restart now / Later | The user opened it from the menu |
| "Quit now?" while uploading in the background | The user chose Quit |
| Save-recording file dialog | The user chose to save a recording |
| Startup "configuration error" box (`showErrorBox`) | Only when the app cannot start; never during or after a call |
| macOS permission prompts (Microphone, Screen Recording, Accessibility) and the System Settings pages | Drawn by macOS at the first Connect; Kite cannot move them; System Settings opens only on the user's click |
| Overlay toasts: the model switch, the click-through notice | Inside the overlay window, which Private protects |
| Admin → AI settings "Leave without saving?" (`window.confirm`, `beforeunload`) | Admin page in the browser, not a call screen |
| Dashboard "reconnect Google Drive" notice | In the dashboard page; never on a call page |

**Nothing uses the browser Notification API.** The desktop shell also denies the notification permission to every page (`security.ts` `isPermissionAllowed()`).

## Consequences

- Nobody in a shared meeting sees "saved to Drive" or an update question after a call.
- People learn an upload's result on the session card. The "saved" email (ADR-0072/0073) still arrives as before.
- **Updates spread more slowly.** A downloaded version is installed at the next quit, or sooner through Check for Updates…. Apps left open for days update at their next restart.
- **The first update to 1.8.2 / 1.7.6 is still announced the old way, once.** Apps on Mac 1.8.1 / Windows 1.7.5 and earlier run the old updater: when they download 1.8.2 / 1.7.6, they show the old Restart now / Later box, outside a call or at its end. From 1.8.2 / 1.7.6 on, no update question appears on its own. Item 3 (the background-exit notification) also stays on old shells until they update.
- **Still outside the apps:** the "saved" email can make the user's own mail app (Outlook, Gmail in a browser tab) show its own notification while the screen is still shared. Kite does not control that.

## Alternatives considered

- **Keep the notification, but only when screen sharing has stopped:** Kite cannot tell whether the meeting app is still sharing, and a toast that comes "later" is still a toast.
- **Move the restart question into the dashboard (a bridge for "update ready" and "restart now"):**
  - Better discovery, but more surface: new bridge methods in both lists, preload and smoke tests.
  - Install-at-quit and Check for Updates… cover it with no new bridge.
  - Could be added later.
- **Show the "saved" banner only in the dashboard, not on the launcher:** it is still a pop-up over a window that may be shared. The card status says the same quietly.

## Validation

- Unit (web):
  - `tests/unit/features/drive/driveSessionStatus.test.tsx`: the words, and no "saved" banner;
  - `core/drive/uploader.test.ts`, `runner.test.ts`: no `notice` dependency;
  - `platform/drive.test.ts`: the host never calls `showNotice`, and works without it;
  - `features/review/callsList.test.ts`.
- Unit (desktop):
  - `updater.test.ts`: nothing asks after a download or when a call ends; only Check for Updates… asks;
  - `drive.test.ts`: `kite:show-notice` answers `false`, even for Kite;
  - `background.test.ts`: no notification.
- Integration: `launcher.spec.ts`, `answers.spec.ts`, `live.spec.ts`, `review.spec.ts`.
- Production e2e after the web deploy, with a disposable account.
- On the real apps: end a call with Drive saving on, while sharing the screen. No toast. The card goes "Uploading…" → "Saved to Drive ✓".
