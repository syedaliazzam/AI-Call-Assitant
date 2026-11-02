/**
 * Tests for apps/desktop/src/updater.ts (Day 6 Stage 3): nextUpdateStep() asks to restart only
 * when an update has downloaded, no call is live and the user has not been asked yet; during a
 * call it waits.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, dialog: {} }));
vi.mock('electron-updater', () => ({ autoUpdater: {} }));

const { CHECK_EVERY_MS, nextUpdateStep } = await import('../../src/updater');

describe('nextUpdateStep', () => {
  it('asks only after a download, outside a call, once', () => {
    expect(nextUpdateStep({ downloaded: false, callActive: false, asked: false })).toBe('none');
    expect(nextUpdateStep({ downloaded: true, callActive: false, asked: false })).toBe('ask');
    expect(nextUpdateStep({ downloaded: true, callActive: false, asked: true })).toBe('none');
  });

  it('waits while a call is live', () => {
    expect(nextUpdateStep({ downloaded: true, callActive: true, asked: false })).toBe('wait');
  });

  it('checks every 6 hours', () => {
    expect(CHECK_EVERY_MS).toBe(21_600_000);
  });
});
