# ADR-0098: A live-call lock per session (one device at a time, with Take over)

- **Status:** Accepted
- **Date:** 2026-11-17
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.1, §7.2, §8.1 (version 4.38.0)
- **Supersedes / superseded by:** extends ADR-0041 (one call at a time on a device, a Web Lock) to one device at a time per session; uses ADR-0077's call ids and device ids. Desktop unchanged (no bridge change).

## Context

Account sync (ADR-0049, ADR-0092) shows every session on every device of the account. Nothing stopped the same session from being started on two devices at once: two calls, two transcripts, two sets of notes and Drive uploads for one session. ADR-0041's Web Lock only covers one browser profile. The developer asked for a server-side lock per session, visible on the other devices, that expires on its own after a crash, and a confirmed **Take over** that moves the call.

## Decision

1. **Table `live_call_lock`** (migration 0010, additive): one row per (account, session): the call holding the lock (`call_id`, the call record's id), the device (`device_id`, the browser profile's random id from `core/live/deviceId.ts`), `started_at`, `heartbeat_at`, `released_at` (null while held) and `replaced_call_id` (the call a take-over replaced before it ended). Ids and times only, never call content. Rows are kept after release (one small row per session ever called); the account's deletion removes them.
2. **Held, released, expired.** A lock is held while `released_at` is null and `heartbeat_at` is less than **90 s** old (database clock). Nothing cleans up: an expired lock simply no longer counts (crash, no network, a window closed without End).
3. **`POST /api/live-lock`** (signed in; a page opened for another account gets 409 `account_changed`, as the sync routes):
   - `start` `{ sessionId, callId, deviceId, takeOver }`: one `INSERT … ON CONFLICT DO UPDATE … WHERE` statement, so racing devices are settled by Postgres. The row is replaced only for the same call (a Reconnect), the same device (its earlier call died: a device runs one call at a time, ADR-0041), a released or expired lock, or `takeOver: true`. Otherwise **409 `live_elsewhere`**. A replaced call that had not ended is kept in `replaced_call_id`.
   - `beat` `{ sessionId, callId, deviceId }`: every **15 s** while the call runs. `held`; `moved` when the row names another call and `replaced_call_id` is this call (a take-over, or a start after this call's lock expired), or when another device's call holds it; otherwise (expired or released with nobody else on the session: this device was offline) the call takes the lock again. A beat arriving after the call's own End returns `released` and never revives the lock.
   - `end` `{ sessionId, callId }`: releases only while this call holds the lock (a moved call changes nothing).
   - Logs: action and outcome only (`held`, `takeOver`, "moved"); never a session, call, device or account id. Held heartbeats are not logged.
4. **`GET /api/live-lock`** (device in the `x-kite-device` header, never in a URL): the account's held locks as `{ sessionId, here }`; `here` is the asking device's own call, shown as usual.
5. **The live page** (`LivePage.tsx`, the one place calls start): Connect takes the Web Lock, then the server lock, before the overlay and the capture (a 3 s timeout keeps the overlay inside the click's activation). The call id is made first, so the lock and the call record share it. A refusal shows "This session is live on another device." with **Take over**; with no answer (offline, an error) the call starts anyway and its heartbeat takes the lock once the server is reached (fail open: a call is never lost to the lock service). A capture that fails gives a new call's lock back. End stops the heartbeat and releases the lock first, then ends as before.
6. **Take over** (dashboard and desktop cards, the browser Connect view, the desktop Connect card): a confirmation "This ends the call on the other device and starts it here.", then the session's normal start. The choice travels to Connect as a note in localStorage (`kite-take-over`, one session, 10 minutes, taken once), so it reaches the desktop app's call window from its small window; Connect sends `takeOver: true`. The other device is not touched until Connect actually starts here.
7. **The moved call** hears it on its next heartbeat (at most about 15 s) or Reconnect, and ends exactly as at End (call record, transcript, notes, recording, Drive), then shows "This call was moved to another device." (the browser's Connect view; the desktop app's small window through a `kite-call-moved` BroadcastChannel).
8. **Other devices' view** (`core/live/liveSessions.ts`, `useLiveElsewhere`): dashboard and desktop cards show a red dot and "Live on another device", Start / Start again disabled with that tooltip (the dashboard's ⋮ Start again disabled with it), and Take over; Meetings marks the session's folder. Sessions still open to view as before. The store asks `GET /api/live-lock` while a card is shown: every 20 s only while the page is visible **and focused**, and at once on focus, on becoming visible and on reconnecting; a background window asks nothing.

## Consequences

- One session runs on one device at a time; other sessions of the account are unaffected; no one is signed out.
- After a crash or a closed window, the session can start elsewhere 90 s later at most (immediately on the same device).
- A take-over leaves both devices running for up to one heartbeat (about 15 s) before the old one ends.
- Each running call costs one small request every 15 s, and each focused list one every 20 s. Polling keeps the free Neon database awake only while someone is looking at a list or running a call (it already is during calls).
- Fail open: while the server cannot be reached, two devices could start the same session; the second learns it on its first heartbeat that reaches the server and ends with "moved".
- Chrome may delay a hidden tab's timers to once a minute; that is still inside the 90 s expiry.

## Alternatives considered

- **Store the live state in the synced session record:** rejected; sync pulls only on open, focus and reconnect, and a crashed device would leave it "live" forever with nothing to expire it.
- **A cron to delete stale rows:** unnecessary; expiry is decided from `heartbeat_at` when read (and Vercel Hobby crons run daily at most).
- **Refuse the call when the server is unreachable:** rejected; transcription and notes work offline, and a lost call is worse than a short double start.
- **End the other call at the take-over confirmation:** rejected; if the person then does not connect, a call ended for nothing. The take-over happens at Connect.
- **Poll whenever a list is open:** rejected for the free database's compute; focus asks first, and the server refuses a start anyway.

## Validation

Unit tests (PGlite with the committed migrations): `tests/unit/server/liveLock.test.ts` (start, refusal, reconnect, same device, expiry at 90 s, release, take-over and moved (also after the new call ended), offline past expiry, late beat after End, other sessions and accounts, handlers' 401/403/409/400); `tests/unit/core/live/liveLock.test.ts`, `liveSessions.test.ts`, `callStart.test.ts`. Manual two-device check after deploy (steps in the stage summary).
