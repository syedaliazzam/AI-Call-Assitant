/**
 * Tests for apps/web/src/core/recording/format.ts (desktop 1.5.0, ADR-0068): hardware H.264 in Matroska
 * at the chosen quality; VP8 in WebM at Standard without a hardware encoder (High is never used then);
 * Opus in WebM for sound only; null when nothing can be recorded; the WebCodecs check answers false
 * without VideoEncoder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseFormat, hasHardwareH264 } from '@/core/recording/format';

afterEach(() => vi.unstubAllGlobals());

/**
 * Checks that accept everything, with or without a hardware encoder.
 * @param hardware True when the computer has hardware H.264.
 * @returns The checks.
 */
const deps = (hardware: boolean) => ({
  isTypeSupported: () => true,
  hardwareH264: async () => hardware,
});

describe('chooseFormat', () => {
  it('uses hardware H.264 in Matroska at the chosen quality', async () => {
    const standard = await chooseFormat('screen', 'standard', deps(true));
    expect(standard).toMatchObject({ container: 'mkv', quality: 'standard' });
    expect(standard?.mimeType).toContain('avc1.42E01F');
    expect(standard?.spec).toMatchObject({ width: 1280, height: 720, frameRate: 15 });
    const high = await chooseFormat('screen', 'high', deps(true));
    expect(high?.mimeType).toContain('avc1.640028');
    expect(high?.spec).toMatchObject({ width: 1920, height: 1080, frameRate: 30 });
  });

  it('falls back to VP8 at Standard without a hardware encoder', async () => {
    const format = await chooseFormat('screen', 'high', deps(false));
    expect(format).toMatchObject({
      mimeType: 'video/webm;codecs=vp8,opus',
      container: 'webm',
      quality: 'standard',
    });
  });

  it('records sound only as Opus in WebM', async () => {
    expect(await chooseFormat('audio', 'high', deps(true))).toMatchObject({
      mimeType: 'audio/webm;codecs=opus',
      container: 'webm',
      quality: null,
      spec: null,
    });
  });

  it('returns null when nothing can be recorded', async () => {
    const none = { isTypeSupported: () => false, hardwareH264: async () => true };
    expect(await chooseFormat('screen', 'standard', none)).toBeNull();
    expect(await chooseFormat('audio', 'standard', none)).toBeNull();
  });
});

describe('hasHardwareH264', () => {
  it('asks WebCodecs for a hardware encoder', async () => {
    const isConfigSupported = vi.fn(async () => ({ supported: true }));
    vi.stubGlobal('VideoEncoder', { isConfigSupported });
    expect(await hasHardwareH264()).toBe(true);
    expect(isConfigSupported).toHaveBeenCalledWith(
      expect.objectContaining({ hardwareAcceleration: 'prefer-hardware' }),
    );
  });

  it('answers false without VideoEncoder, or when the check throws', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    expect(await hasHardwareH264()).toBe(false);
    vi.stubGlobal('VideoEncoder', {
      isConfigSupported: async () => {
        throw new Error('no');
      },
    });
    expect(await hasHardwareH264()).toBe(false);
  });
});
