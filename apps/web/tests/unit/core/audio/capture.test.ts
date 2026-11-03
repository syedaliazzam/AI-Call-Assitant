/**
 * Tests for apps/web/src/core/audio/capture.ts, with the platform, engine and Web Audio mocked:
 * startCallCapture() asks for the other side FIRST (user gesture), then the microphone, and
 * attaches them as two separate channels; a platform CaptureError becomes a CallCaptureError on
 * 'them' and the microphone is not opened; a microphone failure becomes a CallCaptureError on
 * 'you' and releases the other side; meter levels are measured per channel; a track that ends
 * detaches its channel and emits 'channel-ended'; stop() detaches both, stops every track, the
 * timer and the meter context, once; a meter context that starts suspended (Chrome, background
 * tab) is resumed, so the meters do not stay grey after Reconnect.
 */
import { describe, expect, it, vi } from 'vitest';
import { CallCaptureError, startCallCapture } from '@/core/audio/capture';
import { CaptureError } from '@/platform';

/**
 * A fake audio track that records stop() and lets the test fire 'ended'.
 *
 * @returns The track, with stop() as a spy and end() to simulate the track ending.
 */
function fakeTrack() {
  const listeners: (() => void)[] = [];
  return {
    kind: 'audio',
    stop: vi.fn(),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'ended') listeners.push(listener);
    },
    end: () => listeners.forEach((listener) => listener()),
  };
}

/**
 * A fake stream around one fake track.
 *
 * @param level Loudness (0…1) the fake analyser reports for this stream.
 * @returns The stream and its track.
 */
function fakeStream(level: number) {
  const track = fakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], level };
  return { stream: stream as unknown as MediaStream, track };
}

/**
 * Everything startCallCapture() needs, faked.
 *
 * @param options.themError Error the "Them" capture should throw, if any.
 * @param options.micError  Error the microphone should throw, if any.
 * @returns The fakes, and `order`: which capture was opened first.
 */
function setup(options: { themError?: Error; micError?: Error } = {}) {
  const order: string[] = [];
  const them = fakeStream(0);
  const mic = fakeStream(0.3);
  const platform = {
    getOtherSideStream: vi.fn(async () => {
      order.push('them');
      if (options.themError) throw options.themError;
      return { stream: them.stream, source: 'tab-audio' as const };
    }),
    getMicStream: vi.fn(async () => {
      order.push('mic');
      if (options.micError) throw options.micError;
      return mic.stream;
    }),
  };
  const engine = { attach: vi.fn(async () => {}), detach: vi.fn() };
  let tick: (() => void) | null = null;
  const clearInterval = vi.fn();
  const context = {
    state: 'suspended' as AudioContextState,
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    createAnalyser: () => {
      const analyser = {
        fftSize: 0,
        level: 0,
        getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(analyser.level),
      };
      return analyser;
    },
    createMediaStreamSource: (stream: { level: number }) => ({
      connect: (analyser: { level: number }) => {
        analyser.level = stream.level;
      },
    }),
    close: vi.fn(async () => {}),
  };
  const onLevels = vi.fn();
  const onEvent = vi.fn();
  const start = () =>
    startCallCapture({
      engine,
      platform,
      onLevels,
      onEvent,
      deps: {
        createAudioContext: () => context as unknown as AudioContext,
        setInterval: (callback) => {
          tick = callback;
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
        clearInterval,
      },
    });
  return {
    start,
    order,
    platform,
    engine,
    them,
    mic,
    context,
    onLevels,
    onEvent,
    clearInterval,
    tick: () => tick?.(),
  };
}

describe('startCallCapture', () => {
  it('asks for the other side first, then the microphone, and attaches them separately', async () => {
    const s = setup();
    const capture = await s.start();
    expect(s.order).toEqual(['them', 'mic']);
    expect(s.engine.attach).toHaveBeenCalledWith('them', s.them.stream);
    expect(s.engine.attach).toHaveBeenCalledWith('you', s.mic.stream);
    expect(capture.themSource).toBe('tab-audio');
  });

  it('turns a platform CaptureError into a CallCaptureError on "them" and skips the microphone', async () => {
    const s = setup({ themError: new CaptureError('no-audio-track', 'tick the box') });
    const error = await s.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CallCaptureError);
    expect(error).toMatchObject({
      channel: 'them',
      code: 'no-audio-track',
      message: 'tick the box',
    });
    expect(s.platform.getMicStream).not.toHaveBeenCalled();
  });

  it('turns a refused microphone into a CallCaptureError on "you" and releases the other side', async () => {
    const s = setup({ micError: Object.assign(new Error('denied'), { name: 'NotAllowedError' }) });
    const error = await s.start().catch((e: unknown) => e);
    expect(error).toMatchObject({ channel: 'you', code: 'permission-denied' });
    expect((error as Error).message).toMatch(/microphone/);
    expect(s.them.track.stop).toHaveBeenCalled();
    expect(s.engine.attach).not.toHaveBeenCalled();
  });

  it('measures a level per channel', async () => {
    const s = setup();
    const capture = await s.start();
    s.tick();
    const levels = s.onLevels.mock.calls.at(-1)![0];
    expect(levels.you).toBeGreaterThan(0.3);
    expect(levels.them).toBe(0);
    expect(capture.levels()).toEqual(levels);
  });

  it('detaches a channel whose track ends and reports it', async () => {
    const s = setup();
    await s.start();
    s.them.track.end();
    expect(s.engine.detach).toHaveBeenCalledWith('them');
    expect(s.onEvent).toHaveBeenCalledWith({ type: 'channel-ended', channel: 'them' });
    s.them.track.end();
    expect(s.onEvent).toHaveBeenCalledTimes(1);
  });

  it('stop() releases everything once', async () => {
    const s = setup();
    const capture = await s.start();
    capture.stop();
    capture.stop();
    expect(s.engine.detach).toHaveBeenCalledTimes(2);
    expect(s.mic.track.stop).toHaveBeenCalledTimes(1);
    expect(s.them.track.stop).toHaveBeenCalledTimes(1);
    expect(s.clearInterval).toHaveBeenCalledTimes(1);
    expect(s.context.close).toHaveBeenCalledTimes(1);
    // A track ending after stop() is not reported.
    s.mic.track.end();
    expect(s.onEvent).not.toHaveBeenCalled();
  });

  it('resumes a meter context that starts suspended', async () => {
    const s = setup();
    await s.start();
    expect(s.context.resume).toHaveBeenCalledTimes(1);
    s.tick();
    // Already running now: not resumed again.
    expect(s.context.resume).toHaveBeenCalledTimes(1);
  });
});

describe('CallCapture.reattach (Day 6 Stage 4, stuck-engine restart)', () => {
  it('attaches both live channels to the new engine, keeping the same streams', async () => {
    const s = setup();
    const capture = await s.start();
    const next = { attach: vi.fn(async () => {}), detach: vi.fn() };
    await capture.reattach(next);
    expect(next.attach).toHaveBeenCalledWith('them', s.them.stream);
    expect(next.attach).toHaveBeenCalledWith('you', s.mic.stream);
    // Stopping now detaches the new engine, not the old one.
    capture.stop();
    expect(next.detach).toHaveBeenCalledWith('them');
    expect(next.detach).toHaveBeenCalledWith('you');
    expect(s.engine.detach).not.toHaveBeenCalled();
  });
});
