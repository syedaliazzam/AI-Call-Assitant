/**
 * Tests for apps/web/src/features/drive/DriveSessionStatus.tsx driveStatusWords() (ADR-0131): a session's
 * Drive upload shows quietly on its card (the dashboard and the desktop launcher's list) as "Uploading…"
 * (with its share, or "paused for the call"), "Saved to Drive ✓" linking to the folder, or "Upload failed —"
 * with Retry and the reason as the tooltip; reasons fixed in Settings keep their words with a Settings link.
 * Also checks the dashboard has no "saved" banner any more (DriveNotices.tsx). Invented jobs only.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/features/drive/useDrive', () => ({
  // A finished upload whose banner was never closed: before ADR-0131 it showed "… saved — Acme".
  useDriveJobs: () =>
    new Map([
      ['s1', { sessionId: 's1', state: 'done', folderId: 'F1', noticeShown: false, files: [] }],
    ]),
  useDriveSaves: () => true,
}));
vi.mock('@/platform', () => ({ getPlatform: () => ({ openDriveSetup: () => undefined }) }));

const { driveStatusWords } = await import('@/features/drive/DriveSessionStatus');
const { DriveNotices } = await import('@/features/drive/DriveNotices');

describe('driveStatusWords (ADR-0131)', () => {
  it('says "Uploading…" while queued, sending or paused for a call', () => {
    expect(driveStatusWords({ state: 'queued' }, 0)).toEqual({ text: 'Uploading…', live: true });
    expect(driveStatusWords({ state: 'uploading' }, 0).text).toBe('Uploading…');
    expect(driveStatusWords({ state: 'uploading' }, 42).text).toBe('Uploading… 42%');
    expect(driveStatusWords({ state: 'paused' }, 42).text).toBe('Uploading… paused for the call');
  });

  it('says "Saved to Drive ✓" as a link to the folder once done', () => {
    expect(driveStatusWords({ state: 'done', folderId: 'F1' }, 100)).toEqual({
      text: 'Saved to Drive ✓',
      action: 'folder',
      live: false,
    });
  });

  it('says "Upload failed —" with Retry, and the reason as the tooltip', () => {
    const words = driveStatusWords({ state: 'error', reason: 'refused' }, 30);
    expect(words.text).toBe('Upload failed —');
    expect(words.action).toBe('retry');
    expect(words.tip).toContain('refused');
  });

  it('keeps what to fix in Settings, with a Settings link', () => {
    expect(driveStatusWords({ state: 'waiting', reason: 'reconnect' }, 0)).toMatchObject({
      text: 'Reconnect Google Drive',
      action: 'settings',
    });
    expect(driveStatusWords({ state: 'error', reason: 'folder-gone' }, 0).action).toBe('settings');
  });
});

describe('DriveNotices (ADR-0131)', () => {
  it('shows no "saved" banner for a finished upload', () => {
    expect(renderToString(<DriveNotices />)).toBe('');
  });
});
