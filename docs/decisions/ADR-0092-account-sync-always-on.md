# ADR-0092: Account sync is always on; the accountSync switch is removed

- **Status:** Accepted
- **Date:** 2026-11-16
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §7.1, §7.2, §10.1 (version 4.33.0)
- **Supersedes / superseded by:** completes ADR-0049's rollout (the switch was kept as a kill switch until 16 Nov 2026, architecture 4.0.0). Removes what ADR-0024 and ADR-0045 kept for accounts without sync.

## Context

Account sync (ADR-0049) has been on for every account since 9 Nov 2026 (`KITE_SYNC_USERS="*"` in Production). The switch's code was kept for one week as a kill switch, due to go on 16 Nov 2026. Until then, every page carried two paths: one with sync and one without (local data only, a separate desktop panel, a session file to move a session from the browser to the desktop app).

## Decision

**1. One path for every account.** Every signed-in page uses the account's sync cache (`kite-u-<id>`) and runs sync. Nothing reads `KITE_SYNC_USERS` any more.

**2. Removed on the server:**

- `src/server/calldata/flag.ts` (`syncEnabledFor`, `parseSyncUsers`);
- `GET /api/sync/status` and its `SyncStatusResponse` type (it now answers 404);
- the "no account sync → 404" checks in `/api/sync/push`, `/pull`, `/record` and `POST /api/desktop/link-code`.

The "ids or `*`" list reader moved to `src/server/userList.ts`. The cloud transcription rollout list (`KITE_STT_DEEPGRAM_USERS`, ADR-0076) still uses it.

**3. Removed in the browser** (each existed only for accounts without sync):

- `SyncScope`'s `syncUserId` prop, and `selectAccountDatabase()`'s choice of the local database `kite-l-<id>`;
- the classic desktop home panel (`ClassicHomePanel`, `HomeCard.tsx`, `StartSessionCard.tsx`). The desktop window is always the launcher;
- the session-file hand-off: `core/session/handoff.ts`, the "Save it again" link on the hand-off page, the file saved by Choose platform, and the platform and bridge members `pickHandoffFile` / `deleteHandoffFile` / `HandoffPick` (desktop 1.3.0 had already removed its side);
- the overlay's classic 780 px bars (`referenceLook`). The reference look's 980 px bars are now the only look;
- the "pages window" fallbacks for Dashboard, Help, Edit session and Ask AI during a call. They always open the web app in the browser;
- Settings' "Local data" / "Delete all local data". Settings has "Your data" / "Delete all my data" only;
- the "without sync" branches of the dashboard, the call page, the overlay, the review page and Help. The account-and-data help is shown to everyone.

**4. Kept:** the one-time "add the sessions on this computer to your account" card (`LegacyUploadCard`, `core/sync/legacyUpload.ts`). It still reads only the same account's `kite-l-<id>` database. A device may still hold sessions that account made before it had sync (14–15 Nov 2026). "Delete all my data" still deletes that database. The old shared `kite` database stays hidden, as before.

**5. Tests:** the off-mode cases are removed:

- `unflagged.spec.ts` and `sync-everyone.spec.ts` (production e2e);
- the "without the switch" server tests;
- the classic-bar overlay test;
- the session-file tests.

Added:

- a signed-in page always selects the sync cache and never its old local database (`db.test.ts`, `SyncScope.test.tsx`);
- `sync-api.spec.ts` checks that `/api/sync/status` is gone;
- the hand-off page test now checks the one-time code link.

**6. `KITE_SYNC_USERS`** is removed from `.env.example`. It is removed from Vercel only after this deploy is live and verified. The value no longer changes anything.

## Consequences

- No behaviour change for users: every account already had sync.
- Less code and fewer paths to test. The desktop window and the overlay have one look.
- Setting `KITE_SYNC_USERS` no longer turns sync off. Turning sync off would now need a code change.
- A desktop shell older than 1.3.0 can no longer receive a session by file. Such shells were already told to update (ADR-0052).

## Alternatives considered

- **Keep the switch longer.** Rejected: it was planned to go on 16 Nov, sync has run for everyone for a week, and both paths had to be kept working.
- **Remove the one-time upload card too.** Rejected: data an account made before it had sync could still be on a device, and the card is the only way to add it to the account.

## Validation

- Unit tests: lint, typecheck and `pnpm test` pass.
- Integration tests: hand-off, launcher and live suites pass.
- Production after deploy: `GET /api/sync/status` returns 404, and a signed-in pull returns 200.
- `KITE_SYNC_USERS` is removed from Vercel after that check.
