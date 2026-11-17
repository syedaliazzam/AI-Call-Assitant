# ADR-0096: Meetings becomes a meeting library, with Viewer access to the person's own Drive folders

- **Status:** Accepted
- **Date:** 2026-11-17
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.2, §8 (version 4.36.0)
- **Supersedes / superseded by:** replaces the 1.5.0 Meetings list of ADR-0068 (the desktop player window stays); extends ADR-0074 (company Drive account) and ADR-0077 (every start is a call). Google Drive folders, file names, uploads and the "Call saved" emails are unchanged.

## Context

Meetings listed recording parts only: a call without a recording did not appear, and the transcript, the answers and the notes lived on the session page. The developer asked for one professional, simple place to find and review every call: a library of session folders named as in Google Drive, and for each call its recording, the conversation with Paramount AI's answers, the AI notes and the files. It must work in any browser (from the synced call data, before anything reaches Drive) and in the desktop app (playing the file in the page when it is on this computer).

A recording on another computer can only be watched from Google Drive. Drive's session folders are made by the company account (ADR-0074) and are not shared with the people whose calls they hold, so "Watch in Drive" opened a page they could not see. The brief described a per-person "Paramount AI Calls / <user name>" folder; Drive has none: each session folder sits in the company folder, tagged with its owner's account. The developer chose to share each person's own session folders with them rather than change the folder layout.

Privacy rule from the developer: each person sees only their own sessions and calls, admins included, enforced on the server for every route and file.

## Decision

1. **The library (web only).** `/meetings` shows two panes: the library on the left (search by company, session and the other person's name; a date filter: any date, today, 7 days, 30 days, 3 months, this year; session folders named `"<YYYY-MM-DD> <Company> – <Session>"`, after the session's first call as in Drive, newest first, expandable; one row per call with date and time, length and small icons for recorded, AI notes and transcript) and the chosen call on the right. On narrow screens the list and the call take turns ("All meetings" goes back). The call opened last is remembered per account on this browser (`kite.meetings.lastCall`, an account-tied key). ↑ / ↓ / Home / End move through the list; the call's tabs are ARIA tabs (← / →).
2. **The call.** A header (session, date and time, length, "with <their name>" when known, and the recording status: Recorded, Uploading…, Saved on <computer> only, Not recorded) and four tabs:
   - **Watch:** in the desktop app on the computer that holds the file, the recording plays in the page from `kite-recording://file/<id>` (the scheme is on the default session, so no desktop change), with the call's own transcript beside it, time-aligned to the part (current line highlighted and kept in view, click to jump, search). Elsewhere: **Watch in Drive ↗** to the recording's Drive file, or the status, and in a browser **Open in desktop app** for a computer's recording.
   - **Conversation:** the call as a timeline: the other person's turns, Paramount AI's answer cards (answer line and bullets, collapsible) after the turn they answered, the user's turns; names and mm:ss; "Questions & answers only".
   - **AI notes:** summary, questions with Answered / Partly answered / Not answered, next steps with owners, unclear parts; **Rewrite notes** as on the session page (one notes request).
   - **Files:** the transcript PDF and notes PDF, made on this device with Drive's names and downloadable at once; each recording part (size, length, computer; Show in folder and Save as… on its computer); each file's Drive link once saved; **Open folder in Drive ↗**; the session's upload line.
3. **Drive access (server).** `POST /api/drive/call-access` `{ sessionId, callStartedAt }`: the server finds the session folder **only by the signed-in person's own account tag** (`folderTags(user.id, sessionId)`), gives that person (their sign-in email, from the session, never from the request) **Viewer** access with `sendNotificationEmail=false`, and returns the folder link, the access outcome (`viewer`, `refused`, `unavailable`, `none`) and the call's saved files with links, read from the person's own `drive_notification` records only. A refusal (for example an email that is not a Google account) shows "Ask an admin for Drive access". No folder is ever shared with anyone else.
4. **No schema change.** No migration; nothing new is stored on the server. The page asks once per call and page.

## Consequences

- Every call appears, recorded or not, with its conversation and notes, in any browser of the account.
- People can open their own Drive folders and files from Meetings; the company account adds one Viewer permission per session folder (idempotent at Google).
- The library reads every session's lines and answers from the device's database when it opens; fine for the team's call counts.
- A person who is already a member of the Shared Drive may get "refused" for a lower role; the links still work for them, and the note only suggests asking an admin.
- `groupMeetings()` (recording parts grouped into meetings) is no longer used by the page; the desktop player window is unchanged.

## Alternatives considered

- **A per-person folder ("<company folder>/<user name>/…") shared once.** Rejected by the developer: it changes the folder layout for new sessions and still leaves older folders unshared.
- **Sharing at upload time.** Rejected: it would change the upload path, which must stay as it is, and would not cover sessions already in Drive.
- **Reading the folder's files from Drive on each open.** Rejected: the person's own notification records already hold the verified file ids, with no extra Drive calls.

## Validation

- Unit (server, `tests/unit/server/google/api.test.ts`): the person's own folder is shared as Viewer with no email and the call's files listed; another account with the same session id gets nothing and no permission is made; a refusal says "refused"; signed-out, another site and an unknown field are refused.
- Unit (`tests/unit/core/meetings/library.test.ts`, `tests/unit/core/storage/meetingsPrefs.test.ts`): folders, names and order; search and dates; status words; marks; questions and answers only; transcript search; the remembered call.
- Manual: the steps in the stage summary (browser and desktop app, light and dark, narrow window).
