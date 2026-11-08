/**
 * Tests for apps/web/src/core/audio/micPreview.ts (ADR-0053), with the platform and Web Audio
 * mocked: microphonePermission() reports the browser's answer and never throws; startMicPreview()
 * opens the chosen microphone (or the default), reports smoothed levels, resumes a suspended meter
 * context, turns a blocked microphone into a CallCaptureError on 'you', and stop() releases the
 * timer, the context and every track, once.
 */
import { describe, expect, it, vi } from 'vitest';
import { CallCaptureError } from '@/core/audio/capture';
import { microphonePermission, startMicPreview } from '@/core/audio/micPreview';

/**
 * Everything startMicPreview() needs, faked.
 *
 * @param options.micError Error the microphone should throw, if any.
 * @param options.level    Loudness (0…1) the fake analyser reports.
 * @returns The fakes and a start() that runs startMicPreview with them.
 */
function setup(options: { micError?: Error; level?: number } = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const platform = {
    getMicStream: vi.fn(async (_deviceId?: string) => {
      if (options.micError) throw options.micError;
      return stream;
    }),
  };
  let tick: (() => void) | null = null;
  const clearInterval = vi.fn();
  const context = {
    state: 'suspended' as AudioContextState,
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    createAnalyser: () => ({
      fftSize: 0,
      getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(options.level ?? 0.3),
    }),
    createMediaStreamSource: () => ({ connect: () => {} }),
    close: vi.fn(async () => {}),
  };
  const onLevel = vi.fn();
  const start = (deviceId?: string) =>
    startMicPreview({
      ...(deviceId !== undefined ? { deviceId } : {}),
      onLevel,
      platform,
      deps: {
        createAudioContext: () => context as unknown as AudioContext,
        setInterval: (callback) => {
          tick = callback;
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
        clearInterval,
      },
    });
  return { start, platform, track, context, onLevel, clearInterval, tick: () => tick?.() };
}

describe('microphonePermission', () => {
  it('passes on granted, prompt and denied', async () => {
    for (const state of ['granted', 'prompt', 'denied'] as const) {
      const nav = { permissions: { query: vi.fn(async () => ({ state })) } };
      await expect(microphonePermission(nav)).resolves.toBe(state);
      expect(nav.permissions.query).toHaveBeenCalledWith({ name: 'microphone' });
    }
  });

  it('is unknown without the Permissions API, for an odd answer, or when the query throws', async () => {
    await expect(microphonePermission({})).resolves.toBe('unknown');
    await expect(
      microphonePermission({ permissions: { query: async () => ({ state: 'odd' }) } }),
    ).resolves.toBe('unknown');
    await expect(
      microphonePermission({
        permissions: {
          query: async () => {
            throw new TypeError('microphone is not a valid permission name');
          },
        },
      }),
    ).resolves.toBe('unknown');
  });
});

describe('startMicPreview', () => {
  it('opens the default microphone, or the chosen one', async () => {
    const s = setup();
    (await s.start()).stop();
    expect(s.platform.getMicStream).toHaveBeenLastCalledWith();
    (await s.start('usb-headset')).stop();
    expect(s.platform.getMicStream).toHaveBeenLastCalledWith('usb-headset');
  });

  it('reports a rising level for sound and resumes a suspended meter context', async () => {
    const s = setup({ level: 0.3 });
    const preview = await s.start();
    expect(s.context.resume).toHaveBeenCalled();
    s.tick();
    s.tick();
    const levels = s.onLevel.mock.calls.map(([level]) => level as number);
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[1]).toBeGreaterThan(levels[0]!);
    preview.stop();
  });

  it('turns a blocked microphone into a CallCaptureError on "you"', async () => {
    const blocked = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const s = setup({ micError: blocked });
    const failure = await s.start().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CallCaptureError);
    expect(failure).toMatchObject({ channel: 'you', code: 'permission-denied' });
  });

  it('stop() releases the timer, the context and the microphone, once', async () => {
    const s = setup();
    const preview = await s.start();
    preview.stop();
    preview.stop();
    expect(s.clearInterval).toHaveBeenCalledTimes(1);
    expect(s.context.close).toHaveBeenCalledTimes(1);
    expect(s.track.stop).toHaveBeenCalledTimes(1);
  });
});
