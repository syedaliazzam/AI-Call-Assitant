# ADR-0049: Call data is stored in the account

- **Status:** Accepted (lead approval of server storage, 8 Nov 2026) · **Shipped to everyone in release 1.3.0 (9 Nov 2026).** The accountSync switch stays in the code until 16 Nov 2026 as a kill switch.
- **Date:** 2026-11-08
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2, §7.4, §8.1, §8.3, §14 (item 1)
- **Supersedes / superseded by:** **supersedes ADR-0024** (call data on the device only). Rolled out behind the accountSync switch.

## Context

In real use, the browser and the desktop app kept separate dashboards with different sessions. A third computer signed in to the same account showed no sessions at all. ADR-0024 kept call data in each device's IndexedDB, and ADR-0045's file hand-off was the only bridge. The team wants one dashboard and the same sessions on every device signed in to an account. Audio must still never leave the device.

## Decision

### The server is the source of truth

- **Each device keeps a cache** in IndexedDB (`kite-u-<userId>`, one per account) plus an outbox of changes not yet sent. The app reads from the cache, so screens stay instant and work offline.
- **What syncs:** sessions, documents (as text), transcript lines, answers, notes, lesson decisions, library items, question banks, Ask AI chats, default preferences, and three account preferences: company suggestions, the auto-answer default and the coding language.
- **What stays on the device:**
  - audio (never stored at all);
  - screenshots (never stored);
  - the speech model;
  - device preferences: theme, overlay layout and opacity, microphone, hints, Private.

### One table, encrypted

- **`call_record`** has one row per record, keyed by (account, kind, id). The kinds are in `SYNC_KINDS` in `packages/shared/src/sync.ts`.
- **Readable columns** hold ids, the session a record belongs to, the revision, the tombstone flag, the key version, Save transcript (sessions only) and the time. No text from a call is in them.
- **The record itself is in `content`,** encrypted with AES-256-GCM. Every free-text field of a record (company, role, description, instructions, document text, lines, questions, answers, notes, chats) is inside that ciphertext. No free-text column exists in readable form.
- **Each ciphertext is bound to its row** (account, kind, id, key version) as GCM additional data, so a moved ciphertext does not decrypt.
- **The keys are `KITE_DATA_KEY_V1`, `V2`, …** (32 random bytes, base64), set with `vercel env add` and kept in the company password manager. New rows use the highest version. Each row records its version, so a key can be rotated without re-encrypting everything at once.
- **Why one table** rather than one per store (as first proposed): all content is ciphertext, so typed columns would add nothing. One table gives one ownership filter, one pull query, one tombstone rule and one additive migration.

### Ownership

- **Every route takes the account from the signed-in session,** read from the database on each call, never from the request.
- **Every statement is filtered by that account.** The primary key includes it, so the same id in another account is simply a different row.
- **Another account's record is 404** on `/api/sync/record`, absent from `/api/sync/pull`, and untouched by `/api/sync/push`.

### Sync model

- **Push** (`POST /api/sync/push`) applies operations in order:
  - `put` is accepted only when the server's copy is still at the revision the device last saw (`baseRev`); otherwise the reply is `conflict` with the server's copy.
  - `insert` adds a record only if it is missing (the one-time upload).
  - `delete` removes a record; a session takes its documents, lines, answers, notes and question bank, but not its lessons.
  - `clearLines` and `deleteAll` work as their names say.
- **Every operation can be repeated safely,** so a device simply retries a push until it gets results.
- **Conflict rule:** the device merges the server's copy with only the fields it changed itself, then sends it again. So two devices editing different fields both keep their change; on the same field, the later arrival wins.
- **A delete always wins:** a deleted record leaves a tombstone, its content removed, and is never revived by a later put.
- **Pull** (`GET /api/sync/pull`) returns changes in (time, kind, id) order, one page at a time. Each pull starts 60 s before the previous one's server time, so a change still committing is never missed. Records seen twice are applied once, by revision. There is no background polling: a device pulls on open, on focus and after a push.
- **Answer speed is unaffected.** `/api/answer` does not change and never touches the database: answers are still built from the device's cache.
  - Transcript lines are sent in batches every 15 s or 50 lines.
  - Batches wait while an answer streams.
  - Failures are retried with backoff.
  - On End and on leaving the page, a final flush is sent with `keepalive`.

### Save transcript off

- Lines stay in memory, as before. The device sends nothing about them.
- The server also refuses any line for a session whose stored setting is off.
- Turning the setting off deletes the lines already stored, on the server too.
- Answers and notes are still kept. An answer's question quotes the other person, and the privacy text says so.

### Deleting

- **One session:** the session and its children, as above.
- **Delete all my data:** everything for the account. It replaces "Delete all local data" when sync is on.
- **The account:** its rows go by foreign key cascade.
- Deleted rows stay in Neon's point-in-time restore window until it expires. The privacy text says so.

### Rollout

- **`KITE_SYNC_USERS`** (comma-separated user ids, or `*` for everyone) switches on sync and everything built on it:
  - the one-time upload (Phase 4);
  - the desktop launcher (ADR-0051);
  - link codes and removing the file hand-off (ADR-0052);
  - the new privacy text.
- **Accounts without it get 404 from the sync routes** and see exactly today's app.

## Consequences

- **The same sessions on every device** signed in to an account, and data survives a lost laptop.
- **Customer documents, transcripts and answers now live on Neon in the US,** encrypted, with the key on Vercel. Anyone with both the database and the Vercel settings can read them; the database alone does not reveal them. This was approved by the lead on 8 Nov 2026.
- **Losing every copy of a data key makes its rows unreadable.**
- **Storage:** about 0.1–0.5 MB per session. For 3 users and about 100 sessions, the Neon free plan is enough.
- **Two more round trips to the database** per sync call (session check and write). Sync runs in the background and never on the answer path.

## Alternatives considered

- **One table per store, with readable columns:** more migrations and more places to get ownership wrong. Readable columns would also put call text in the database.
- **Vercel Blob for documents:** documents are already text, with caps (100,000 characters each, 150,000 per session). A second store would add a second deletion path for no gain.
- **Neon's disk encryption only:** it protects disks, not a database dump or someone reading the console.
- **Last write wins for whole records:** a device ticking a live call's activity time would erase another device's edit of the session.

## Validation

- **Unit tests against PGlite** with the committed migrations: `tests/unit/server/calldata/` (`store`, `api`, `crypto`, `flag`). They cover:
  - cross-account isolation on every route;
  - conflicts, and tombstones that never revive;
  - the session cascade;
  - Save transcript off;
  - encryption at rest, its binding to the row, and key versions;
  - paging.
- **Production, test account only:** a push, pull and delete round trip once the key and migration are in place.
- **Phase 3 and 4 checks** are listed in their pull requests.
