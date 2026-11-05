/**
 * File: apps/web/src/core/storage/companyPrefs.ts
 * Purpose: The "Company suggestions" setting (Settings → Privacy, ADR-0048): on by default. Off means
 *          nothing goes to Brandfetch: the company field suggests from past sessions only, and session
 *          cards show their letter tiles, because loading a logo also tells Brandfetch the domain.
 *          Kept in localStorage: it belongs to this device.
 * Used by: src/features/settings/CompanySuggestionsSetting.tsx,
 *          src/features/session-setup/CompanyField.tsx, src/features/dashboard/CompanyTile.tsx
 * Depends on: localStorage
 * Architecture: docs/decisions/ADR-0048-company-suggestions-from-brandfetch.md
 */

/** The localStorage key: only the word 'off' turns it off. */
const KEY = 'kite.companySuggestions';

/**
 * Whether company suggestions are on. Blocked storage reads as off: someone who turned this off must
 * never be sent to Brandfetch because their choice could not be read.
 *
 * @returns True when Brandfetch may be used.
 * Called from: the components above; tests
 */
export function companySuggestionsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return false;
  }
}

/**
 * Saves the setting.
 *
 * @param on True for on.
 * Called from: CompanySuggestionsSetting.tsx; tests
 */
export function setCompanySuggestionsOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: companySuggestionsOn() already reads as off.
  }
}
