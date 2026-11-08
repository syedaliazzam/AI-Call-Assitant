/**
 * File: apps/web/src/core/sync/prefsSignal.ts
 * Purpose: Tells account sync that an account preference changed on this device (ADR-0049: company
 *          suggestions, the auto-answer default and the coding language follow the account). Kept
 *          apart from prefs.ts so the preference modules can call it without importing each other.
 * Used by: src/core/storage/companyPrefs.ts, autoAnswer.ts, answerPrefs.ts (setters);
 *          src/core/sync/client.ts (listens)
 * Depends on: nothing
 * Architecture: ADR-0049
 */

/** Who listens (account sync while it runs), or null. */
let listener: (() => void) | null = null;

/**
 * Sets who hears about account preference changes.
 *
 * @param next The listener, or null to stop.
 * Called from: client.ts (start and stop of account sync)
 */
export function onAccountPrefChange(next: (() => void) | null): void {
  listener = next;
}

/**
 * Reports that an account preference changed here. Does nothing without account sync.
 *
 * Called from: setCompanySuggestionsOn(), setAutoAnswer(), setCodingLanguage()
 */
export function accountPrefChanged(): void {
  listener?.();
}
