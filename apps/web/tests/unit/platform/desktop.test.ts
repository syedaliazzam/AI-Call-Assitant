/**
 * Tests for apps/web/src/platform/desktop.ts:
 * createDesktopPlatform() reports the shell's version and OS from the bridge, opens the
 * microphone like the browser does, and every not-yet-built method throws NotImplementedError
 * naming its day.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDesktopPlatform } from '@/platform/desktop';
import { NotImplementedError } from '@/platform/errors';

/** Desktop platform built from a fake bridge, as the shell's preload script would expose it. */
const platform = createDesktopPlatform({ version: '1.2.3', os: 'mac' });

describe('createDesktopPlatform', () => {
  it('reports kind, version and os from the bridge', () => {
    expect(platform.kind).toBe('desktop');
    expect(platform.version).toBe('1.2.3');
    expect(platform.os).toBe('mac');
  });

  it('getMicStream opens the microphone with getUserMedia', async () => {
    const fakeStream = { id: 'mic' } as unknown as MediaStream;
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    });
    await expect(platform.getMicStream()).resolves.toBe(fakeStream);
  });

  it.each([
    ['getOtherSideStream', 2, () => platform.getOtherSideStream()],
    ['captureScreenshot', 5, () => platform.captureScreenshot()],
    ['openCompactView', 5, () => platform.openCompactView('s1')],
    ['setShareProtection', 5, () => platform.setShareProtection(true)],
  ])('%s rejects with NotImplementedError (Day %i)', async (_name, day, call) => {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotImplementedError);
    expect((error as NotImplementedError).day).toBe(day);
  });

  it('onHotkey throws NotImplementedError (Day 4)', () => {
    expect(() => platform.onHotkey(() => {})).toThrow(/desktop\.onHotkey.*Day 4/);
  });
});
