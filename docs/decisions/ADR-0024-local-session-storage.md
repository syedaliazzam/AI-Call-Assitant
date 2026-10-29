# ADR-0024: Call sessions, documents and transcripts are stored on the device (IndexedDB)

- **Status:** Accepted
- **Date:** 2026-10-29 (Day 3)
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` (version 3.3.0) §7.1 (`core/storage`), §7.3 (`security.ts`), §7.4 (data model), §8.1 (where data lives), §8.3 (controls), §14 (sync in the backlog)
- **Supersedes / superseded by:** none. It records the storage decision that ADR-0021 ("call data stays on the device") left open.

## Context

Kite needs to keep a user's call sessions between visits:
- the session details (type, company, role or topic, description, preferences, key terms, instructions);
- the documents attached to a session, as text, so they can be sent to Claude with each answer;
- the transcript of earlier calls (when the session saves it), and later the answers and notes.

Constraints:
- **Privacy.** CLAUDE.md and §8.1: call data stays on the user's device. The server only sees the text of one answer request, and keeps none of it. The accounts database (Neon) holds accounts and sign-in sessions **only**.
- **One code base.** The browser (Chrome or Edge) and the desktop app (Electron, which loads the same web app) must use the same storage code. All platform differences live in `src/platform/`.
- **Size.** A session can hold up to 150,000 characters of document text (§7.2), and a long call can produce thousands of transcript lines.
- **No server work on Day 3.** A server-side store would need encryption at rest, retention rules and approval for storing customer documents.

## Decision

1. **IndexedDB through Dexie 4.4.6** (pinned exactly), in one database named `kite`.
   - Stores: `sessions`, `documents`, `utterances`, `answers`, `notes` (schema version 1) and `settings` (version 2, the default preferences). Fields and indexes are in architecture §7.4; the types, with a comment on every field, are in `apps/web/src/core/storage/types.ts`.
   - The code is in `apps/web/src/core/storage/` (`db.ts`, `sessions.ts`, `documents.ts`, `utterances.ts`, `settings.ts`, `persist.ts`, `wipe.ts`). Feature components never touch IndexedDB directly.
   - Schema changes add a new Dexie version; an existing version is never edited.
   - Documents are stored as **extracted text only**. The original file is read in the browser (pdf.js, mammoth) and never kept or uploaded.
2. **Separate data per browser profile and per desktop app.** IndexedDB belongs to one origin in one browser profile. The desktop app has its own Electron profile, so it has its own database. A session created in Chrome does **not** appear in the desktop app, and the other way round. This is expected behaviour in v1 and is said in the README and in §8.1.
3. **No sync in v1.** Syncing sessions between the browser and the desktop app needs a server database for call data. That is a different privacy decision, and it is on the backlog (§14 item 1).
4. **Ask for persistent storage.** When the first session is saved, Kite calls `navigator.storage.persist()` (`persist.ts`), so the browser does not clear Kite's data when the disk is short of space.
   - **Desktop:** Electron routes `persist()` through the session's permission handlers as `'persistent-storage'` (Electron session documentation, checked 2026-10-28). Without a grant it always fails in the desktop app. `apps/desktop/src/security.ts` therefore grants `persistent-storage` **to the Kite origin only**, like the microphone and display capture. Every other origin and permission stays denied. A desktop unit test (`apps/desktop/tests/unit/security.test.ts`) covers the grant.
   - **Browser:** Chrome decides by itself (for example from how much the site is used). If it says no, the data is still kept as long as there is disk space.
5. **Delete all local data** (Settings): after a confirmation, deletes the whole `kite` database (sessions, documents, transcripts, answers, notes and the default preferences) and shows what was deleted. It deliberately **keeps** the downloaded speech model (Cache Storage `kite-stt-v2`). That cache holds only public, checksum-pinned files and no personal data, and deleting it would make the next call download 204 MB again.
6. **Deleting one session** removes its documents, transcript lines, answers and notes in the same transaction.
7. **Status that cannot get stuck.** A session is stored as `not-started`, `live` or `ended`, and has `lastActiveAt` (set on Connect, refreshed every 60 s during a call). A session stored as `live` whose `lastActiveAt` is more than **12 hours** old is shown as Ended (`shownStatus()` in `sessions.ts`). This covers a window that was closed or crashed during a call.

## Consequences

**Positive**
- Call data never reaches Kite's server storage; only the text of an answer request passes through Vercel to Claude.
- The browser and the desktop app share one storage implementation, with no `if (desktop)`.
- Sessions open instantly and work without a server round trip.
- The unit tests run the real Dexie code against an in-memory IndexedDB (fake-indexeddb 6.2.5).

**Negative and risks**
- **Local data is not encrypted by Kite.** The IndexedDB files in the browser or desktop profile can be read by anyone who can use that operating-system account, or who has the disk of a lost laptop. Mitigations:
  - the operating system's disk encryption (FileVault on macOS, BitLocker on Windows), which company laptops should have on;
  - "Delete all local data" in Settings;
  - sign-in sessions expire after 30 days, after which the app asks for the password before showing any screen. This protects the screens, not the files on disk.
- **No sync:** a user who works in both the browser and the desktop app sees two separate session lists. This is documented as expected behaviour.
- **Data can be lost** if the user clears site data in the browser, deletes the desktop app's profile, or (without persistent storage) the browser evicts it when the disk is full. There is no backup in v1.
- **Each browser profile is separate**, so a second Chrome profile starts with an empty session list.

## Alternatives considered

- **A server database for call data (Neon).** Rejected for v1: it would move customer documents and transcripts onto Kite's server, which needs encryption at rest, retention rules and internal approval. It is the way to add sync later (backlog §14).
- **`localStorage`.** Rejected: about 5 MB per origin, synchronous (it blocks the page), and strings only. A single document can be larger than that.
- **Raw IndexedDB without a library.** Rejected: more code for transactions, versioning and queries. Dexie is small and well established, and its schema versions make upgrades explicit.
- **Files on disk through the desktop shell.** Rejected: desktop only, so the browser would need a second implementation, and the shell must stay thin (ADR-0021).
- **Encrypting the database with a key from the password.** Deferred: the key would have to be kept somewhere on the device or the password asked for again on every visit. Disk encryption by the operating system protects a lost laptop without that cost.

## Validation

- Unit tests (`apps/web/tests/unit/core/storage/`, fake-indexeddb): create, list and filter, update, cascade delete, the 12-hour rule, the per-session document total, transcript lines replaced on merge and deleted one by one (the transcript saver, tested in `tests/unit/core/transcript/saver.test.ts`, deletes a saved line that turns out to be an echo), default preferences, the persistence request, and delete all.
- Desktop: `apps/desktop/tests/unit/security.test.ts` covers the `persistent-storage` grant for the Kite origin and its refusal for any other origin.
- Day 3 checks by the developer: sessions and documents survive a reload in the browser and in the desktop app; the two have separate lists; Delete all local data works. Results go in the Day 3 pull request.
