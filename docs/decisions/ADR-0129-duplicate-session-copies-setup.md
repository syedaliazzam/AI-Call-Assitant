# ADR-0129: Duplicate session copies the setup only, as "Copy of <name>", from every session menu

- **Status:** Accepted (27 Nov 2026; branch `session-duplicate-and-mac-keys`, web only)
- **Date:** 2026-11-27
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Dashboard, Session review, desktop "Your sessions"), §7.4 (data model) (version 4.68.0)
- **Supersedes / superseded by:** extends ADR-0029 (the dashboard's Duplicate); amends ADR-0071 (the desktop app's session menu: copying now there too)

## Context

The dashboard's session menu already had **Duplicate** (`duplicateSession()` in `core/storage/sessions.ts`, also used to save a mock interview). It copied the whole session record except id, creation time, status and last activity, and the documents as new rows. But:

1. It also carried over fields that belong to the original's calls or device: `lastCallMs` (the last call's length, shown on the card), `handoffAt` (a desktop hand-off time) and `documentsSummary` (the summary written from the documents).
2. It did not copy the **question bank**, which is setup the user prepared for this kind of call.
3. The copy had the **same name** as the original: two identical cards.
4. It was only in the dashboard. The desktop app's "Your sessions" menu (ADR-0071: View in dashboard, Delete) and the session page (`/sessions/[id]`: Dashboard, Delete session) had none.

Documents could not simply be shared: each document row belongs to one session (`StoredDocument.sessionId`), and the account server deletes every row with a session's id when that session is deleted (`server/calldata/store.ts`). A copy pointing at the original's rows would lose them with the original. The developer chose to copy the text (27 Nov 2026), as the library's "attach" already does, over a new shared-document model (a server and data-model change).

A session has no name of its own: its card shows the company (the topic for a regular call). Putting "Copy of" into the company or topic would send it to Claude ("Company: Copy of Acme"), make it a speech hotword, and name the Drive folder.

## Decision

Web only. No change to the desktop shell, the server or the sync protocol; old sessions are unchanged.

1. **One Duplicate.** `duplicateSession(id, now, { name })` is extended in place, and every menu uses it through `features/dashboard/duplicate.ts` `duplicateAsCopy()`: the dashboard's cards (as before), the desktop app's "Your sessions" ⋮ menu (new: View in dashboard ↗, **Duplicate**, Delete), and the session page's header (new **Duplicate** button, which then opens the copy's page). The copy appears in the list by itself (live queries).
2. **Setup only, decided field by field.** `DUPLICATE_FIELDS` lists every `Session` field as `copy`, `new` or `drop`, checked by the compiler (`satisfies Record<keyof Session, …>`), so a field added later cannot be copied or left out without a decision.
   - **Copied:** type, company, logo domain, role / topic, description, AI instructions, preferences (language, model, answer style with STAR, key terms), save transcript, auto answer, contact name, Drive "also notify" list. Objects are copied as new objects.
   - **New:** id, creation time, status `not-started`, no activity, the name.
   - **Dropped:** `lastCallMs`, `handoffAt`, `documentsSummary` (written again from the copy's documents when first needed).
   - **Documents** are copied as text into new rows of the copy (a long document split into parts again, ADR-0069). The copy holds exactly the original's text, so it is within ADR-0117's 500,000-character limit whenever the original is; no file is read again, so the 20 MB file limit does not come into it.
   - **The question bank** is copied with the copy's id (and its original writing time).
   - **Never copied:** transcript lines, answers, notes, calls and their notes, Drive jobs, recording records, Ask AI chats (not per session), desktop link codes (server-side, per sign-in).
3. **"Copy of <name>" as a display name.** `Session.name` (optional, synced with the session) is the card's title when present: on the dashboard, the home and desktop lists (`sessionCardTitle()`), and the session page. `copyName()` words it as "Copy of" and the original's card title ("Copy of Acme", "Copy of Pilot review", "Copy of Interview call"), clipped to 200 characters. It is never sent to Claude, never a hotword, never a Drive folder name: the copy answers exactly as the original. **Rename** (company and role) clears it. A saved mock interview gets no name (as before).
4. **Each session owns its rows.** Deleting the original or the copy deletes only its own documents and bank; the other keeps its own.
5. **Sync.** The copy is written in one IndexedDB transaction (session, document rows, bank); the change capture queues each as a new record, so it reaches the account and the user's other devices like a session made in the wizard, and opens in the desktop app normally.

## Consequences

- A copy's text is stored twice (on the device and in the account), as attaching the same library file to two sessions already does. A session holds at most 500,000 characters (about 1.5 MB as JSON), so a copy adds at most that much to the next sync push.
- The copy's first answer that needs the documents summary writes it again (one fast-model request), since the summary is not copied.
- A saved mock interview (which also uses `duplicateSession()`) now gets the question bank and leaves out the last-call length, hand-off time and documents summary; otherwise it is as before.
- Older open pages (before this deploy) ignore `name` and show the company; they keep it when they edit the session, since they write back the whole record they read.

## Alternatives considered

- **Shared documents referenced by both sessions.** Rejected by the developer for now: it needs a server change (no cascade delete while referenced), a migration of every stored document, and changes to listing, summaries, export, wipe and Drive.
- **"Copy of" in the company or topic.** Rejected: it would reach Claude, the speech hotwords and Drive.
- **A second Duplicate function for the menus.** Rejected: one function, one rule (the developer asked to extend the existing one).
- **Copy the documents summary to save a request.** Rejected: the developer listed "summary" among what a copy starts without, and it is cheap to write again.

## Validation

- Unit: `tests/unit/core/storage/duplicate.test.ts` (every setup field copied exactly, the three dropped, new id / time / status / name; documents as new rows with the same text, the long one in parts; the bank copied; no call data; deleting either keeps the other's documents and bank; no name for a mock; long names clipped; preferences are new objects; a missing session writes nothing; Rename's `name: undefined` removes it; in an account database the session, document rows and bank are queued for sync and nothing of the original is), `tests/unit/features/dashboard/duplicate.test.ts` (copyName, a copy's card title and line, duplicateAsCopy keeps company and topic), `tests/unit/core/storage/library.test.ts` (the earlier Duplicate checks still pass).
- Integration: `tests/integration/setup.spec.ts` (the dashboard's Duplicate makes "Copy of Zephyr Labs (invented)", not started).
- Production end-to-end (`tests/e2e-prod/duplicate-and-keys.spec.ts`, disposable test account): the dashboard's Duplicate with a document; the copy on a second Chrome profile and in the desktop app (its Start opens Connect); the session page's and the desktop menu's Duplicate; deleting the original leaves the copy's document.
