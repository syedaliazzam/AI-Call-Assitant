# ADR-0073: Ended sessions start again; one "saved" email per call

- **Status:** Accepted (developer, 12 Nov 2026) · Web only: desktop 1.6.0 and 1.6.1 get it without a new release.
- **Date:** 2026-11-12
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (desktop sessions card), §7.2 (`/api/drive/notify`, `/api/drive/notifications`), §7.4 (`driveUploads`), §8.1 (`drive_notification`)
- **Supersedes / superseded by:** amends ADR-0072 ("one email per session, ever" becomes "one email per call") and ADR-0071 (the desktop card of an ended session offered only View transcript). Desktop 1.6.1's fallback to the sessions card for an ended session's link is removed.

## Context

Before 1.6.0 people started the same session many times: each start is a new call with the same documents and CV. The browser still offers **Start again** (the session's ⋮ menu), and the live page restarts an ended session. But:

- the desktop launcher's card for an ended session offered only **View transcript**, and since 1.6.1 a browser link for an ended session fell back to "Your sessions" instead of its Start card;
- ADR-0072 sends **one email per session, ever** (`drive_notification`'s primary key is the account and the session). A second call's files were uploaded (each call's files already have their own names, by the call's start, in the session folder), but its report only merged into the session's record, which had been sent, so the second call never got an email.

## Decision

1. **Ended sessions start again on the desktop.** A browser link for an ended session opens its Start card (Free / Paid) like any other; only a session that is gone or not in the account falls back to "Your sessions". The desktop card of an ended session shows **View transcript** and **Start again** (the launcher, and the classic panel's card). Each start is a new call in the same session.
2. **One email per call.** Each call is reported on its own: its own files (recordings matched to the call by their start, as files were already planned; recording files now also record their call), the recordings the account knows that call has, the call's own start and length. The server keeps one record per call: the session's first record keeps the plain session id as its key (so every record made before this change stays valid), and each later call's record is `"<session id>~<call start>"` (`server/google/report.ts`: `notificationKey`, `reportKey`). A report goes to the first record when there is none yet or it is about the same call, otherwise to the call's own. Each record waits for its call's recording and sends its call's one email, exactly as ADR-0072 did per session. Settings' Recent notifications lists and retries each call's email (`DriveNotificationItem.call`, `DriveRetryRequest.call`).
3. **No duplicate email for old calls.** Calls queued before this change have no per-call flags. When their job was already reported under the session's single email, they are marked **closed** and never reported again. A job still uploading, or one from before the combined email ("Send email" only), reports each call on its own. A new call (`queueDriveCall`) starts unreported.
4. **No migration.** `drive_notification.session_id` is already text; only what it holds changes. Device storage gains optional fields on calls (`reportedFiles`, `notified`, `closed`) and files (`callStartedAt` on recording files): no schema version change.

## Consequences

- A session started three times sends three emails, each with its own call's date, length and files, all linking to the same session folder.
- Changing folder re-uploads a session's files and reports each (not closed) call once more: an email already sent is not sent again, its record gains the new links.
- A report sent by a page opened before the deploy is a whole-session report: it merges into the session's first record (no new email).
- Two calls of the same session reported for the very first time at the same moment from two computers could both land in the session's first record (one email for both). Calls are reported one after another on a computer, so this needs two computers racing on a new session.

## Alternatives considered

- **Keep one email per session and send a second "updated" email.** Rejected: the developer wants each call's email on its own.
- **A new `call_started_at` column in the primary key.** Rejected: needs a migration and would change every existing row's key; the text key does the same with no migration.
- **Always key by call, also the first.** Rejected: records made before the change (keyed by session) would no longer match their first call's later reports, which could send a duplicate email.

## Validation

- Unit: `uploader.test.ts` (a session started again reports only the second call, with only its files; a call emailed before the change is never reported again), `driveUploads.test.ts` (`withCallFlags`, a new call queued unreported), `report.test.ts` (record keys), `api.test.ts` (each call its own email, once; Retry by call), `launcher.test.ts` (an ended link keeps the Start card).
- Harness: `launcher.spec.ts` (an ended session from the browser's link at a cold start and after a reload, and from its desktop card's Start again).
- Production: start an ended session from the browser and the desktop card; after the call, one email for that call only.
