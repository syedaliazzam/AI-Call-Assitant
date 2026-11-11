/**
 * File: apps/web/src/core/drive/addresses.ts
 * Purpose: Reads an "Also notify" list typed by the person (ADR-0072): addresses separated by commas,
 *          semicolons, spaces or new lines; lower-cased, repeats removed, at most MAX_ALSO_NOTIFY; and
 *          which entries are not email addresses (shown to the person, never saved). The server checks
 *          the list again.
 * Used by: src/features/drive/GoogleDriveSetting.tsx, src/features/session-setup (draft.ts,
 *          PreferencesStep.tsx)
 * Depends on: @kite/shared (MAX_ALSO_NOTIFY, MAX_EMAIL_CHARS)
 * Architecture: ADR-0072
 */
import { MAX_ALSO_NOTIFY, MAX_EMAIL_CHARS } from '@kite/shared';

/**
 * A plain check for an email address: something@something.something, no spaces. The server's check
 * (zod) is the one that counts; this one gives the person a message before saving.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A parsed list. */
export interface AddressList {
  /** The addresses kept: valid, lower-case, no repeats, at most MAX_ALSO_NOTIFY. */
  valid: string[];
  /** The entries that are not addresses, as typed. */
  invalid: string[];
  /** True when more than MAX_ALSO_NOTIFY valid addresses were typed (the rest are dropped). */
  tooMany: boolean;
}

/**
 * Reads a typed list.
 *
 * @param text The text.
 * @returns The addresses, the entries that are not addresses, and whether there were too many.
 * Called from: GoogleDriveSetting.tsx, session-setup/draft.ts; tests
 */
export function parseAddressList(text: string): AddressList {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const entry of text.split(/[\s,;]+/).filter(Boolean)) {
    const address = entry.toLowerCase();
    if (!EMAIL.test(address) || address.length > MAX_EMAIL_CHARS) invalid.push(entry);
    else if (!valid.includes(address)) valid.push(address);
  }
  return {
    valid: valid.slice(0, MAX_ALSO_NOTIFY),
    invalid,
    tooMany: valid.length > MAX_ALSO_NOTIFY,
  };
}
