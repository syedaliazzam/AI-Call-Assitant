/**
 * Tests for apps/web/src/server/passwords.ts, generateTemporaryPassword():
 * 14 characters, only readable characters (no 0/O/1/l/I), and different every time.
 */
import { describe, expect, it } from 'vitest';
import {
  generateTemporaryPassword,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
} from '@/server/passwords';

describe('generateTemporaryPassword', () => {
  it('is 14 characters long', () => {
    expect(TEMP_PASSWORD_LENGTH).toBe(14);
    expect(generateTemporaryPassword()).toHaveLength(14);
  });

  it('uses only characters from the readable alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      for (const char of generateTemporaryPassword()) {
        expect(TEMP_PASSWORD_ALPHABET).toContain(char);
      }
    }
  });

  it('never contains look-alike characters', () => {
    for (const char of ['0', 'O', '1', 'l', 'I']) {
      expect(TEMP_PASSWORD_ALPHABET).not.toContain(char);
    }
  });

  it('meets the 10-character minimum used by Better Auth', () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(10);
  });

  it('produces a different password each time', () => {
    const passwords = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()));
    expect(passwords.size).toBe(500);
  });
});
