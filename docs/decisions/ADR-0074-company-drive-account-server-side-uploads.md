# ADR-0074: One company Google Drive account; no Google token ever reaches a client

- **Status:** Accepted (developer, 12 Nov 2026: one company account; the Picker gets its own browser-only token from Google; desktop 1.6.0/1.6.1 recordings wait for 1.6.2) · SQL to be approved before `db:migrate --prod`.
- **Date:** 2026-11-12
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Settings → Google Drive), §7.2 (`/api/google/*`, `/api/drive/*`), §7.3 (desktop `drive/`), §8.1 (`drive_company`, `drive_member`), §10.1
- **Supersedes / superseded by:** replaces ADR-0072's per-person connection and its client-side Drive calls (the access-token route, the page's Drive client); keeps ADR-0072's folders, file names, tags-for-idempotency, notices and the email, and ADR-0073's one email per call.

## Context

ADR-0072 let each person connect their own Google account, and gave the page a short-lived access token (`GET /api/google/access-token`): the page made folders, started uploads and sent the transcript and notes itself, and passed the token to the desktop shell for recordings. The developer's rule now: **never send the company's access token to a client.** The team uses one company project and one Shared Drive.

## Decision

1. **One company account.** An admin connects the company Google account once (Settings → Google Drive → Company Google Drive: Google's consent page, `drive.file`, offline). Its refresh token is stored encrypted (AES-256-GCM, `KITE_DATA_KEY_V<n>`) in `drive_company` (one row), with the chosen folder and the account's address (from Drive's `about`). People no longer connect Drive; each keeps their own switches and team list in `drive_member` (copied from `google_drive` by the migration). Only admins can connect, reconnect, choose the folder or disconnect.
2. **The folder is chosen with Google Picker, on a token the browser gets from Google.** The admin's page asks Google Identity Services for a short-lived `drive.file` token (Google's popup, signed in as the company account, `hint` = its address). It is held in memory for the Picker only; it is never sent to or issued by Kite's server. Picking grants the app (the same OAuth client) access to the folder for that account, so the server's stored token can use it; the server checks it (`files.get`) before storing it and says so when the folder was picked with another account.
3. **The server makes the folders and starts each upload.** With the company token, server-side only:
   - `POST /api/drive/session-folder`: finds or makes the session folder and its `Recordings` and `Transcripts` in the company folder (tags bound to the account and the session, so one person's request never reaches another's folders);
   - `POST /api/drive/uploads`: for one recording file, returns the existing file (by its tag) or starts a resumable upload and returns **only that upload's session address** and a signed ticket (HMAC with `BETTER_AUTH_SECRET`, bound to the account, the address, the file's tag and size), valid for that one file;
   - `POST /api/drive/uploads/offset`: asks Google where that upload got to (restart or resume);
   - `POST /api/drive/uploads/complete`: reads the file with the company token and checks its tag, size and MD5 against the ticket and the client's own MD5 before its Drive id is accepted;
   - `POST /api/drive/files`: the page's own files (transcript TXT and PDF, notes PDF: small) are sent to Kite's server and uploaded from there (multipart, MD5 checked); held in memory only, never stored or logged; at most 4 MB.
   - `POST /api/drive/notify` keeps a reported Drive id only when the company token finds that file with the tag this account and session give it, so an email can only link to this person's saved files.
   - `GET /api/google/access-token` is removed.
4. **The desktop shell (1.6.2) uploads with the session address only**: no token, no `Authorization` header; it starts at the offset the page got from the server, sends 8 MiB chunks, and returns the whole file's MD5. Shells 1.6.0 and 1.6.1 require a token, so their recording files wait ("Update Paramount AI to upload recordings"); their transcripts and notes upload as before. The page tells them apart by the bridge's version.

## Consequences

- No Google token is ever sent to a page or the shell by Kite; the session address is the only credential a client holds, for one file, and Google ends it after a week.
- The transcript and notes now pass through Kite's server in memory on their way to Drive (they never did before); they are not stored or logged.
- Everyone's calls go to one company folder; each session's folder is the person's, by its tags. The company account must be a member (Contributor or more) of the Shared Drive.
- Migration 0004 (additive): `drive_company`, `drive_member`, and the switches copied from `google_drive`. `google_drive` (per-person tokens from the test project, no longer valid) is no longer read; deleting its rows is a separate, approved step.
- Recordings made in 1.6.0/1.6.1 upload once the person updates to 1.6.2.

## Alternatives considered

- **Keep each person's own token, server-side.** Rejected by the developer (one company account).
- **Server-side recording uploads.** Rejected: recordings are hundreds of MB; they go from the shell straight to Google on the session address.
- **A short-lived token for old shells.** Rejected: no token to any client, even temporarily.

## Validation

- Unit (server): admin-only connect and folder; the upload routes (existing file, start, ticket bound to account and address, offset, complete refuses a wrong size, MD5 or tag); small uploads (size cap, MD5); notify drops a Drive id the company token cannot find with this account's tag.
- Unit (page): the uploader never asks for a token; recordings wait on old shells; transcripts go through `/api/drive/files`.
- Unit (desktop): an upload without a token sends no `Authorization` header, starts at the given offset and returns the MD5.
- Release: desktop 1.6.2 install check (the published 1.6.1 → 1.6.2), real-feed update check.
