/**
 * File: apps/web/src/server/calldata/flag.ts
 * Purpose: The accountSync switch (ADR-0049 rollout). Account sync, the one-time upload, the desktop
 *          launcher, desktop link codes and the new privacy text are on only for the accounts listed
 *          in KITE_SYNC_USERS (comma-separated user ids), or for everyone when it is `*`. Everyone else
 *          keeps today's behaviour: local data, the current dashboard and the file hand-off.
 * Used by: src/server/calldata/api.ts (the /api/sync/* routes); later the pages that show flagged UI
 * Depends on: nothing
 * Architecture: ADR-0049 (rollout)
 */
import 'server-only';

/**
 * Reads KITE_SYNC_USERS.
 *
 * @param value The variable's value (undefined when unset).
 * @returns 'everyone' for `*`, else the set of user ids (empty when unset).
 * Called from: syncEnabledFor(); tests
 */
export function parseSyncUsers(value: string | undefined): 'everyone' | ReadonlySet<string> {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.includes('*')) return 'everyone';
  return new Set(entries);
}

/**
 * Whether an account has account sync (and the rest of the flagged features).
 *
 * @param userId The signed-in account's id.
 * @param env    The environment (default process.env; tests pass their own).
 * @returns True when listed in KITE_SYNC_USERS, or when it is `*`.
 * Called from: src/server/calldata/api.ts; pages that show flagged features
 */
export function syncEnabledFor(
  userId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const users = parseSyncUsers(env.KITE_SYNC_USERS);
  return users === 'everyone' || users.has(userId);
}
