/**
 * File: apps/web/src/server/passwords.ts
 * Purpose: Generates the temporary passwords an admin shares with a new user (or after a reset).
 * Used by: src/server/users.ts, scripts/create-admin.ts
 * Depends on: node:crypto
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2 (ADR-0022)
 */
import 'server-only';
import { randomInt } from 'node:crypto';

/**
 * Characters a temporary password may contain.
 * Look-alike characters are left out (0/O, 1/l/I) because people read these passwords off a
 * screen and type them in. 57 characters x 14 positions gives about 81 bits of randomness.
 */
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Length of a temporary password (Better Auth's minimum for Kite is 10). */
export const TEMP_PASSWORD_LENGTH = 14;

/**
 * Creates a random, easy-to-read temporary password.
 * Uses crypto.randomInt, which is cryptographically secure and has no modulo bias.
 *
 * @returns A 14-character password made from TEMP_PASSWORD_ALPHABET.
 * Called from: createUserAccount() and resetUserPassword() in src/server/users.ts,
 *              scripts/create-admin.ts
 */
export function generateTemporaryPassword(): string {
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    password += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
}
