/**
 * File: apps/web/src/core/sync/prefs.ts
 * Purpose: The account preferences that sync (ADR-0049, developer decision 5): company suggestions,
 *          the auto-answer default and the coding language. They live in local storage like every
 *          other preference; with account sync they travel as one record ('prefs', id 'account'),
 *          read from and written back to the same keys, so the settings pages need no change.
 * Used by: src/core/sync/engine.ts
 * Depends on: src/core/storage/companyPrefs.ts, autoAnswer.ts, answerPrefs.ts (the key names)
 * Architecture: ADR-0049
 */
import { CODING_LANGUAGE_KEY } from '../storage/answerPrefs';
import { AUTO_ANSWER_KEY } from '../storage/autoAnswer';
import { COMPANY_SUGGESTIONS_KEY } from '../storage/companyPrefs';

/** The synced preferences: the record field → its local storage key. */
const KEYS = {
  companySuggestions: COMPANY_SUGGESTIONS_KEY,
  autoAnswer: AUTO_ANSWER_KEY,
  codingLanguage: CODING_LANGUAGE_KEY,
} as const;

/** The synced preferences as stored: each key's raw value, or null when unset (its default). */
export type AccountPrefs = Record<keyof typeof KEYS, string | null>;

/**
 * Reads the account preferences from local storage.
 *
 * @param storage The storage (default localStorage; tests pass one).
 * @returns Each key's raw value or null.
 * Called from: engine.ts (push)
 */
export function readAccountPrefs(storage: Storage = localStorage): AccountPrefs {
  const read = (key: string) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  return {
    companySuggestions: read(KEYS.companySuggestions),
    autoAnswer: read(KEYS.autoAnswer),
    codingLanguage: read(KEYS.codingLanguage),
  };
}

/**
 * Writes the account preferences from the account into local storage (a value that is not a string
 * removes the key, which means its default).
 *
 * @param record  The account's record.
 * @param storage The storage (default localStorage; tests pass one).
 * Called from: engine.ts (pull)
 */
export function writeAccountPrefs(
  record: Record<string, unknown>,
  storage: Storage = localStorage,
): void {
  for (const [field, key] of Object.entries(KEYS)) {
    const value = record[field];
    try {
      if (typeof value === 'string') storage.setItem(key, value);
      else storage.removeItem(key);
    } catch {
      // Storage blocked: the preference keeps this device's value.
    }
  }
}
