# ADR-0106: Recording uploads finish after the user exits the desktop app

- **Status:** Accepted (19 Nov 2026, the developer's brief)
- **Date:** 2026-11-19
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.3, §7.4 (version 4.45.0)
- **Supersedes / superseded by:** extends ADR-0072 (Drive saving), ADR-0074 (server-side upload sessions) and ADR-0077 (per-call jobs); keeps ADR-0028's update rules and adds one

## Context

A call's recording stopped uploading to Google Drive because the user exited the desktop app right after the call. When they opened the app again, the upload resumed and finished.

So the queue survives a restart, but exiting stops the upload. The reasons:

- The Drive queue lives in the page: IndexedDB jobs, plus the after-call runner that writes the notes and then queues the upload. It runs in whichever Kite window holds a Web Lock.
- The shell only sends the bytes.
- Closing the last window quits the app, and that stops everything.

Two more gaps:

1. **Expired tickets fail for good.** The server signs each upload with a ticket that lasts 6 days (`TICKET_TTL_MS`, just under Google's week-long upload sessions). An upload resumed after that got `403 bad_ticket`, which the page treated as a final failure.
2. **Unclear status words.** The dashboard and Meetings said "Uploading…" or "Waiting to upload to Drive". A person looking from a browser could not tell that only the desktop app on the recording computer can finish the upload.

## Decision

**1. The upload goes on after an exit (desktop 1.7.2).**

- **The page reports the work left.** It tells the shell how much Drive work this computer still has (`DriveQueueReport`: calls, recording files, bytes sent and total; no ids or content). The report goes over the new bridge method `reportDriveQueue` after every change (`core/drive/localWork.ts`).
  - Counted: uploads that move by themselves (queued, uploading, paused for a call, an error that is retried by itself), and this device's recent calls whose upload is not queued yet (their notes are still being written).
  - Not counted: work that waits for the person (Drive not connected, a file that failed too often, a non-retryable error).
- **What counts as an exit:** the panel's Close button, closing the panel's window when nothing else is open, the tray's Quit, or Cmd+Q.
- **Exit with work left.** The app closes every window except the home panel. The panel's page stays open but hidden: it runs both the after-call runner and the uploader, and it is light. It runs at full timer speed (`setBackgroundThrottling(false)`). The app shows "Uploading 1 recording to Drive. Paramount AI will close when it's done." and keeps its tray icon.
- **Handover.** An upload sent by a window that closes is stopped as its page goes. The panel then resumes it from where Google got to, instead of finding it "busy".
- **It quits by itself** when the report says nothing is left and the shell is sending nothing. It also quits when nothing has moved for 10 minutes (offline, or Google refusing): the queue resumes at the next start, so the app never runs on for nothing.
- **A tray icon is always there.** It shows "Open Paramount AI" and "Quit Paramount AI". While work is left it also shows the progress ("Uploading 1 recording to Drive: 42%"). After an exit it offers **Quit now**, which asks first ("The upload to Google Drive stops now. It resumes the next time you open Paramount AI.").
- **The app is never hidden.** It stays in the tray, the Dock and the process list (CLAUDE.md). A Windows shutdown or sign-out, or macOS powering off, is never held up.
- **Opening the app again** (a second launch, the tray, the Dock, a link, a shortcut) makes it run as usual. The uploads carry on in the panel, and a new call pauses them as before.
- **A call that just ended counts as work for up to 15 seconds,** until its page reports it, so an exit in that moment loses nothing.

**2. Updates wait for the queue.** The restart question waits while Drive work is left, as it already waits for a live call. "Restart now" pressed while an upload started meanwhile also waits. An app finishing uploads after an exit installs the downloaded update when it quits by itself (`autoInstallOnAppQuit`).

**3. Expired tickets and sessions start a new session.** `bad_ticket` from `/api/drive/uploads/offset` (and `/complete`) clears the file's upload address and starts a new upload session for the same file. A file Google already finished is found by its tag (`exists`) and never uploaded twice. Google's own 404/410 for a gone session already did this.

**4. Status words.** A recorded call whose upload is on its way says **"Waiting for the desktop app to finish the upload"** on the session page and in Meetings. After 24 hours with no progress it says **"Upload paused: open the desktop app on the computer used for this call"**, and Meetings offers "Open in desktop app".

Progress is the call record's new `drive.movedAt` (`core/drive/waitWords.ts`):
- the uploading app stamps it with every state it shows, and every 10 minutes during a long recording upload;
- on records written before this change, the record's last change stands in.

A call without a recording keeps the plain words. No migration is needed: the field is optional, inside the encrypted synced record.

**Durability, unchanged and confirmed:**
- Jobs, upload addresses and tickets are in IndexedDB, written after every chunk. Recordings are in the shell's index, finalised at the next start if a crash left them open.
- So a crash, a forced quit, a reboot or an update resumes from Google's offset at the next start (the uploader runs 4 s after a page opens).
- A job left "uploading" by a crash is picked up as active.

## Consequences

- The app may run with no window for as long as an upload takes. The tray icon and the notification say so, and "Quit now" is always there.
- The panel's page is kept for uploads. In a build where the web app has no `/home` (a rollback), there is no panel and the app quits as before.
- An upload whose page closes for any other reason (a reload, a closed window) now stops and is resumed by the next page, instead of running on unseen.
- Production check (19 Nov 2026, `pnpm --filter web drive-stuck-uploads`, read-only, ids and counts only):
  - no call's email record was waiting ('collecting') for more than 30 minutes;
  - in the last 7 days: 21 call emails and 3 recording emails sent, 4 not set up, none closed by the 24-hour "Recording not uploaded" rule.
  - A call whose app closed before its first file reached Drive has no server record yet. The server cannot see it (call records are encrypted); it finishes when its computer opens the updated app.

## Alternatives considered

- **Run the whole queue in the main process.** Rejected: it would duplicate the page's job logic, the server calls with the user's session, and the notes writing. The page already does all of it.
- **Hide every window and keep them all.** Rejected: it keeps the call window's memory, and a reopened app would find a hidden main window in an odd state. Only the panel is kept; everything else closes.
- **Quit and resume at the next start (as before).** Rejected by the brief: a recording can wait days for the next start.
