/**
 * Tests for apps/web/src/features/meetings/FilesTab.tsx (25 Nov 2026): the note under a call's files when a
 * screen recording is in Google Drive says that Drive may show low quality for a while after upload, and how
 * to get full quality.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({ getPlatform: () => ({}), isMacComputer: () => false }));
const { DRIVE_QUALITY_NOTE } = await import('@/features/meetings/FilesTab');

describe('the Drive playback note', () => {
  it('says Drive may show low quality for a while, and how to see full quality', () => {
    expect(DRIVE_QUALITY_NOTE).toBe(
      'Google Drive may show low quality for a while after upload — download it or play it in Paramount AI for full quality.',
    );
  });
});
