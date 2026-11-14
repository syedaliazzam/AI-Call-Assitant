/**
 * Tests for apps/web/scripts/lib/test-accounts.ts (ADR-0081): only kite-e2e…@example.com addresses
 * count as test accounts (so delete-test-accounts can never touch a real person's account), the
 * target list adds .env.local's test addresses and refuses others, the deletion plan covers every
 * table holding a user id and ends with the user row, and the .env.local clean-up removes only the
 * deleted accounts' lines.
 */
import { describe, expect, it } from 'vitest';
import {
  DELETION_PLAN,
  isTestAccountEmail,
  LEGACY_TEST_EMAILS,
  removeTestAccountLines,
  targetEmails,
} from '../../../scripts/lib/test-accounts';

describe('isTestAccountEmail', () => {
  it('accepts the test addresses only', () => {
    expect(isTestAccountEmail('kite-e2e@example.com')).toBe(true);
    expect(isTestAccountEmail('Kite-E2E-Admin@Example.com')).toBe(true);
    expect(isTestAccountEmail('kite-e2e-run-2@example.com')).toBe(true);
    expect(isTestAccountEmail('someone@example.com')).toBe(false);
    expect(isTestAccountEmail('kite-e2e@gmail.com')).toBe(false);
    expect(isTestAccountEmail('kite-e2e@example.com.evil.test')).toBe(false);
    expect(isTestAccountEmail('x.kite-e2e@example.com')).toBe(false);
    expect(isTestAccountEmail('')).toBe(false);
  });
});

describe('targetEmails', () => {
  it('starts with the two legacy accounts and adds test addresses from .env.local', () => {
    expect(targetEmails([undefined, undefined])).toEqual({
      emails: [...LEGACY_TEST_EMAILS],
      refused: 0,
    });
    expect(targetEmails(['KITE-E2E-run-3@example.com', 'kite-e2e@example.com'])).toEqual({
      emails: [...LEGACY_TEST_EMAILS, 'kite-e2e-run-3@example.com'],
      refused: 0,
    });
  });

  it('refuses any other address and never acts on it', () => {
    const result = targetEmails(['real.person@company.test', '']);
    expect(result.refused).toBe(1);
    expect(result.emails).not.toContain('real.person@company.test');
  });
});

describe('DELETION_PLAN', () => {
  it('covers every table that holds a user id, and deletes the user last', () => {
    expect(DELETION_PLAN.map((step) => step.table)).toEqual([
      'verification',
      'session',
      'account',
      'usage_day',
      'call_record',
      'google_drive',
      'drive_member',
      'drive_notification',
      'drive_company',
      'user',
    ]);
    expect(DELETION_PLAN.at(-1)!.sql).toBe('DELETE FROM "user" WHERE id = ANY($ids)');
    // The company Drive connection is kept: only its "connected by" link is cleared.
    expect(DELETION_PLAN.find((step) => step.table === 'drive_company')!.sql).toMatch(
      /^UPDATE drive_company SET connected_by = NULL/,
    );
    // The plan names no account: ids are a parameter.
    expect(DELETION_PLAN.every((step) => step.sql.includes('$ids'))).toBe(true);
  });
});

describe('removeTestAccountLines', () => {
  const file = [
    'DATABASE_URL=fake',
    '',
    '# Production end-to-end test account (tests/e2e-prod). Disable it at /admin/users.',
    'KITE_E2E_EMAIL=kite-e2e@example.com',
    'KITE_E2E_PASSWORD=fake-one',
    '',
    '# Production end-to-end test account (tests/e2e-prod), role admin. Delete it after the run.',
    'KITE_E2E_ADMIN_EMAIL=kite-e2e-admin@example.com',
    'KITE_E2E_ADMIN_PASSWORD=fake-two',
    'KITE_E2E_URL=https://preview.example.test',
    '',
  ].join('\n');

  it('removes the given accounts lines and their comments, and keeps the rest', () => {
    const { text, removed } = removeTestAccountLines(file, ['KITE_E2E', 'KITE_E2E_ADMIN']);
    expect(removed).toBe(6);
    expect(text).toContain('DATABASE_URL=fake');
    expect(text).toContain('KITE_E2E_URL=https://preview.example.test');
    expect(text).not.toMatch(/KITE_E2E(_ADMIN)?_(EMAIL|PASSWORD)=/);
  });

  it('removes only the user account when asked for it alone', () => {
    const { text, removed } = removeTestAccountLines(file, ['KITE_E2E']);
    expect(removed).toBe(3);
    expect(text).not.toContain('KITE_E2E_EMAIL=');
    expect(text).toContain('KITE_E2E_ADMIN_EMAIL=');
    expect(text).toContain('KITE_E2E_ADMIN_PASSWORD=');
    // The admin account's comment stays with its lines.
    expect(text).toContain('role admin. Delete it after the run.');
  });
});
