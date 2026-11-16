/**
 * File: apps/web/src/server/userList.ts
 * Purpose: Reads a per-account rollout list from an environment variable: comma-separated account ids,
 *          or `*` for everyone. Used by the cloud transcription switch (KITE_STT_DEEPGRAM_USERS,
 *          ADR-0076). It was part of the accountSync switch's module until ADR-0092 removed that switch.
 * Used by: src/server/deepgram.ts
 * Depends on: nothing
 * Architecture: ADR-0076, ADR-0092
 */
import 'server-only';

/**
 * Reads a list of account ids.
 *
 * @param value The variable's value (undefined when unset).
 * @returns 'everyone' for `*`, else the set of account ids (empty when unset); spaces and empty
 *          entries are ignored.
 * Called from: deepgramEnabledFor() in src/server/deepgram.ts; tests
 */
export function parseUserList(value: string | undefined): 'everyone' | ReadonlySet<string> {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.includes('*')) return 'everyone';
  return new Set(entries);
}
