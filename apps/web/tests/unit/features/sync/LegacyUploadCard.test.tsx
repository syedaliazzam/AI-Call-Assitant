/**
 * Tests for apps/web/src/features/sync/LegacyUploadCard.tsx (privacy fix of 14 Nov 2026): the question
 * says the sessions are this account's own, made on this computer and not synced yet (never "this
 * computer has sessions that are not in your account", which read as an offer of anyone's data); the
 * card renders nothing before it has looked at the account's own local database. Which data is counted
 * and uploaded is covered by tests/unit/core/sync/legacyUpload.test.ts.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The sync engine and the platform are not under test.
vi.mock('@/core/sync/client', () => ({ startAccountSync: () => () => undefined }));
vi.mock('@/platform', () => ({ getPlatform: () => ({ keepPopupsInWindow: () => undefined }) }));
const { LegacyUploadCard, uploadQuestion } = await import('@/features/sync/LegacyUploadCard');

describe('uploadQuestion', () => {
  it("names the sessions as this account's own, not synced yet", () => {
    expect(uploadQuestion({ sessions: 2, other: 0 }, 'a@example.test')).toBe(
      "This computer has 2 sessions from this account that aren't synced yet. Add them to a@example.test?",
    );
    expect(uploadQuestion({ sessions: 1, other: 3 }, 'a@example.test')).toBe(
      "This computer has 1 session from this account that isn't synced yet. Add them to a@example.test?",
    );
    expect(uploadQuestion({ sessions: 0, other: 1 }, '')).toBe(
      "This computer has resumes, documents or lessons from this account that aren't synced yet. Add it to your account?",
    );
  });
});

describe('LegacyUploadCard', () => {
  it('renders nothing before it has looked (and nothing outside a synced page)', () => {
    expect(renderToString(<LegacyUploadCard />)).toBe('');
  });
});
