/**
 * Tests for apps/web/src/platform/browser.ts (and the shared microphone code in media.ts):
 * getMicStream() calls getUserMedia with the microphone settings, fails clearly without the
 * MediaDevices API, and every not-yet-built method throws NotImplementedError naming its day.
 */
import { describe, expect, it, vi } from 'vitest';
import { browserPlatform } from '@/platform/browser';
import { NotImplementedError } from '@/platform/errors';
import { MIC_CONSTRAINTS } from '@/platform/media';

describe('browserPlatform', () => {
  it('reports kind "browser"', () => {
    expect(browserPlatform.kind).toBe('browser');
  });

  it('getMicStream opens the microphone with getUserMedia', async () => {
    const fakeStream = { id: 'mic' } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    await expect(browserPlatform.getMicStream()).resolves.toBe(fakeStream);
    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
  });

  it('getMicStream fails with a clear error when MediaDevices is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(browserPlatform.getMicStream()).rejects.toThrow(/Microphone access/);
  });

  it.each([
    ['getOtherSideStream', 2, () => browserPlatform.getOtherSideStream()],
    ['captureScreenshot', 5, () => browserPlatform.captureScreenshot()],
    ['openCompactView', 5, () => browserPlatform.openCompactView('s1')],
    ['setShareProtection', 5, () => browserPlatform.setShareProtection(true)],
  ])('%s rejects with NotImplementedError (Day %i)', async (_name, day, call) => {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotImplementedError);
    expect((error as NotImplementedError).day).toBe(day);
  });

  it('onHotkey throws NotImplementedError (Day 4)', () => {
    expect(() => browserPlatform.onHotkey(() => {})).toThrow(NotImplementedError);
    expect(() => browserPlatform.onHotkey(() => {})).toThrow(/Day 4/);
  });
});
