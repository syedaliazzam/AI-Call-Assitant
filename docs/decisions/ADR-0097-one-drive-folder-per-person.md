# ADR-0097: One Google Drive folder per person, shared with that person only

- **Status:** Accepted
- **Date:** 2026-11-17
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2, §8, §10.1 (version 4.37.0)
- **Supersedes / superseded by:** changes ADR-0096's sharing (one Viewer share per session folder) to one share per person; extends ADR-0074 (company Drive account). Session folder names, subfolders, file names, uploads and the "Call saved" emails are unchanged.

## Context

Every session folder sat directly in the company folder ("Paramount AI Calls"), tagged with its owner's account (ADR-0074). ADR-0096 shared each session folder with its owner, one Viewer share per session folder. The developer asked for one folder per person inside the company folder, named after the person, shared with that person only, with their session folders inside it, and for the existing session folders to be moved into it.

The app works with the `drive.file` scope: it can only see and change what it made and the company folder an admin picked. Each session folder's `kiteSession` tag is a hash of the account and the session (ADR-0072), so a folder's owner can be proven only by recomputing that hash for every (account, session) pair the server knows.

## Decision

1. **A person's folder.** In the company folder, the server makes one folder per person, the first time they save a call (`POST /api/drive/session-folder`). Its name is the person's display name (control characters removed, at most 100 characters; "Unnamed user" when empty); its tags are `kiteOwner` = a hash of the account with a fixed label, and `kiteFolder` = `user`. It is found by those tags only, oldest first (two made at once by two devices resolve to the same). It is made only for the signed-in account; no request names a person.
2. **One share per person.** When the folder is made, it is shared with the person's sign-in email as **Viewer** with `sendNotificationEmail=false`. `POST /api/drive/call-access` asks for the same share again (no change at Google when it is there) and reports the outcome; "refused" (an email that is not a Google account) still shows "Ask an admin for Drive access". The company folder and other people's folders are never shared with anyone. The company account keeps full access as owner.
3. **New session folders** go inside the person's folder, with the same names, Recordings and Transcripts subfolders and file names as before. Lookups (uploads, small files, call-access) look in the person's folder first, then in the company folder itself, so a session folder made before this change is still found and used where it is. A session folder still in the company folder (not moved) is shared by itself, as ADR-0096 did, so it stays open to its owner.
4. **One-time move.** `POST /api/cron/drive-user-folders` (under `api/cron/` because, like the daily job, it has no sign-in cookie and checks its own secret): open only while `KITE_DRIVE_MOVE_SECRET` (at least 32 characters, Production only) is set; 404 otherwise. It lists the session folders in the company folder itself, matches each `kiteSession` tag against every (account, session) pair from `call_record` (synced sessions, and records that name a session) and `drive_notification`, and:
   - without `apply` (the dry run): replies with counts only: folders found, matched, unmatched, and per person (as an ordinal, most folders first) how many folders and whether their folder exists;
   - with `apply`: per person, finds or makes their folder and shares it with them; removes the person's own per-session Viewer share (only a share for their email, role reader, that is the folder's own) when their folder's share is in place; then **moves** the folder (one `PATCH` with `addParents` / `removeParents`). Ids, links and contents stay the same; nothing is copied or uploaded again. If a move fails the per-session share is put back. At most `limit` folders (default 40) per request; it says how many remain and can be run again safely.
   - A folder that matches no known pair stays where it is.
   The per-session share is removed just before the move, while it is the folder's own share only, rather than after: Drive's handling of removing a share that is also inherited from the new parent is not something we rely on. The end state is the one asked for.
   Replies and logs carry counts only, never a name, email, account, session or Drive id. After the move the secret is removed from Vercel, which closes the route.
5. **No schema change.** No migration; nothing new is stored on the server.

## Consequences

- Each person sees one folder of their own in Drive ("Shared with me"), holding all their calls; adding a call needs no new share.
- "Open in Drive" / "Watch in Drive" links and the links in earlier emails keep working: a move keeps every id.
- A display name changed later does not rename the folder (it is named once).
- One more Drive lookup (the person's folder) per upload request; a session folder never moved costs one more lookup.
- Settings → Google Drive still links to the company folder, which only admins (the company account) can open.

## Alternatives considered

- **Copy into new folders:** rejected; new ids would break every saved link and double the storage.
- **Keep per-session shares:** what ADR-0096 did; one share per person is simpler and is what the developer asked for.
- **Move lazily on the next request:** rejected; the move runs once, after the developer approves its dry run.
- **A local script for the move:** the data keys and the Google client secret are Production-only and sensitive, so it cannot run from a developer machine; it runs on the server behind a temporary secret.
