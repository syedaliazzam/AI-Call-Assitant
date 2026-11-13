# ADR-0077: Every start is a call: call records, notes and Drive per call, after-call work outside the call window, two emails per call

- **Status:** Accepted (developer's decisions, 13 Nov 2026, on the production-readiness investigation, Batch B).
- **Date:** 2026-11-13
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` 4.18.0: §5 (Session review, Settings → Google Drive), §7.2 (`/api/drive/notify`, `/api/drive/notifications`, the cron), §7.3 (desktop 1.6.3), §7.4 (`calls`, `callNotes`, `driveCallJobs`, Dexie version 12)
- **Supersedes / superseded by:** amends ADR-0072 and ADR-0073 (Drive: one job per call instead of one per session; two emails per call for new calls; `manualEmail` no longer applies to them) and the Day 5 notes model (one notes row per session becomes read-only legacy).
- **Investigation:** `docs/investigations/2026-11-13-production-readiness.md` (sections A6–A9, F; plan items P0-6, P0-7, P0-8, P0-10)

## Context

The 12–13 Nov 2026 calls showed (investigation A6–A9):

- **"Start again" showed another call's data.** Notes were one row per session, so a call whose notes never saved showed an older call's notes. The session page read this device's copy once, oldest call first.
- **After-call work lived in the call page.** Notes, the "You" rewrite and the Drive queueing ran after End inside the call window; closing it (or a slow rewrite) lost the notes and never queued the call for Drive.
- **Drive was one job per session**, files in one ordered list: a recording that failed or paused stopped every later file, including the next call's transcripts. A call made before Drive was set up was never queued.
- **No email:** sessions from before the combined email were marked "manual email only" per job, so every later call of the session was never emailed; and the email waited for every recording file (or 24 h, checked daily).
- **Desktop:** closing the call window during a call cleared the shell's call flag without telling Drive, so every recording upload answered "paused" until another call.

## Decision

1. **Call record** (`calls`, synced as `call`): one per start of a session, made at Connect (`id`, `sessionId`, `startedAt`, `endedAt`, `durationMs`, `phase` live/ending/ended, `deviceId`, `saveTranscript`, `recording`, `heardLines`, `notesState`, `drive`, `sttEngine`). Lines, answers and recordings carry its id (`callId`; the recording's `meetingId` is the call id). At End the record is written first, before anything else.
2. **Notes per call** (`callNotes`, synced as `callNotes`). The old `notes` row stays, read-only.
3. **After-call runner** (`core/live/afterCall.ts`, mounted in the app layout and the desktop panel): for this device's calls it ends a call whose window closed, writes the notes (from the lines the call page handed over in memory, else the saved ones, else the answers only), tries three times, then queues the call's own Drive job. The call window's Accurate rewrite holds the Drive upload for at most three minutes.
4. **Calls made before records are worked out on read and never written** (`core/review/calls.ts`): lines grouped by the call id inside their ids, answers joined to the call they were given in, the start taken from the answers' (or the old notes') recorded connect time, the old notes row joined to its own call, recordings by time; ids derived from those facts (`legacy-…`), so every device works out the same ones.
5. **Session page:** calls newest first, each with its date, length, notes ("No notes — nothing was heard" when skipped), transcript, answers, recordings and Drive state; it waits for the first sync pull ("Syncing…"), reloads after every pull, and while a call is being finished pulls every 10 s.
6. **Drive per call** (`driveCallJobs`, this device only): files in the order transcript TXT, transcript PDF, notes PDF, recordings (main, then stereo); each file on its own (a failure never stops another file or another call; five failures wait for Retry); the old keys (`call:<start>:…`, `rec:<id>:…`), so the server's tags prevent duplicates. Old `driveUploads` jobs get no new calls and finish their own files. Settings → Google Drive → **Upload N earlier calls** queues this device's calls never saved (call records with Drive off; legacy calls of sessions this device uploaded or recorded, never one overlapping a call already in an upload); they are emailed by hand.
7. **Two emails per call** (calls that end from now on, `emailRule: 'two-step'`): email 1 "Call saved" as soon as the Transcripts files are in (links, the Recordings folder, "Recording: uploading…" when a recording is expected); email 2 "Recording saved" when every recording file is in, only if it was not in email 1; after 24 h without it, "Recording not uploaded: open Paramount AI on <computer>". `manualOnly` is ignored for these calls; the per-call record state prevents duplicates. A failed email stays listed with Retry and is tried again by itself once an hour for three days (never an older call's). Older calls keep the single email and "Send email" by hand.
8. **Desktop 1.6.3:** the call window's `closed` handler tells Drive the call ended; the recording finaliser runs at below-normal priority.

No SQL migration: `call_record.kind` and `drive_notification.session_id` are text. Email 2's record key is `<session>~<call start>~recording`.

## Consequences

- Closing the call window after End loses nothing: the panel (or any Kite window) finishes the notes and the upload; T4.1–T4.3.
- Each call's transcript and notes reach Drive and email 1 before its recording, which may take minutes.
- **Vercel Hobby runs crons once a day only**, so the "hourly cron" is done by every open Kite window asking the server once an hour (`DriveUploader`: the status route sends due and retry emails); the daily cron stays as the backstop. A true hourly server job needs the Pro plan or an external scheduler.
- A call's notes are written once per call; Regenerate on the session page rewrites one call's notes only.
- For on-device (non-Deepgram) calls the Drive upload waits up to three minutes for the Accurate rewrite while the call window is open.
- `exportData` does not include the new stores yet (as recordings were never included).

## Alternatives considered

- **Keep one Drive job per session, reorder its files.** Rejected: a failure or a pause still blocks later calls, and the job's single `manualEmail` flag is what silenced the emails.
- **Write legacy call records once (a migration).** Rejected (investigation F4): each device would invent different ids; deriving on read is deterministic.
- **Run after-call work in a service worker.** Rejected: the desktop panel and every app window already run the layout; a service worker adds a second lifecycle for no gain.
- **Wait for the recording before any email (as before).** Rejected by the developer (A9): people need the transcript and notes within a minute.

## Validation

- Unit tests: the call model and legacy derivation, the after-call runner, per-call Drive order and independence, the earlier-calls upload on the 12–13 Nov session's shape (exactly the 22:25 and 00:49 calls, once), both email rules (server, with PGlite), desktop priority and window-close helpers.
- Integration: review, live, launcher, handoff, sim-calls, answers, db-upgrade specs.
- Manual (developer): T4.1–T4.4 and T5.1 of the investigation.
