/**
 * Tests for apps/web/src/core/voice/micSession.ts (item 8, ADR-0038), with a fake engine and
 * microphone: the engine is created once and reused; text is passed on only while listening and
 * only from the "you" channel; stop() closes the microphone but keeps the model; a refused
 * microphone or a failed model gives a sentence to show and leaves nothing open; a stop during
 * loading closes the microphone that opens late; close() ends the engine.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SttEngineOptions } from '@/core/stt/sttEngine';
import { createMicSession, micErrorMessage, type MicSessionDeps } from '@/core/voice/micSession';

/**
 * A fake microphone stream with one track whose stop() is recorded.
 *
 * @returns The stream and its track.
 */
function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

/**
 * Fake engine and microphone.
 *
 * @param options.ready   The engine's ready promise (default resolved).
 * @param options.openMic The microphone (default a fake stream).
 * @returns The deps, the engine options the session gave, and the fakes.
 */
function setup(options: { ready?: Promise<never>; openMic?: () => Promise<MediaStream> } = {}) {
  const engineOptions: SttEngineOptions[] = [];
  const engine = {
    ready: options.ready ?? Promise.resolve({} as never),
    attach: vi.fn(async () => undefined),
    detach: vi.fn(),
    stop: vi.fn(),
  };
  const mic = fakeStream();
  const deps: MicSessionDeps = {
    createEngine: (given) => {
      engineOptions.push(given);
      return engine;
    },
    openMic: options.openMic ?? (async () => mic.stream),
  };
  const callbacks = {
    onPartial: vi.fn(),
    onFinal: vi.fn(),
    onError: vi.fn(),
    onState: vi.fn(),
  };
  return { deps, engine, engineOptions, mic, callbacks };
}

describe('createMicSession', () => {
  it('loads once, listens, and passes on only the "you" text while listening', async () => {
    const { deps, engine, engineOptions, callbacks } = setup();
    const session = createMicSession(callbacks, deps);
    await session.start();
    expect(session.state()).toBe('listening');
    expect(engine.attach).toHaveBeenCalledWith('you', expect.anything());
    const { onPartial, onFinal } = engineOptions[0]!;
    onPartial?.({ channel: 'you', text: 'hello', tStart: 1 });
    onFinal?.({
      channel: 'you',
      text: 'hello there',
      reason: 'pause',
      tStart: 1,
      tEnd: 2,
      speechEnd: 2,
      latencyMs: 0,
    });
    onPartial?.({ channel: 'them', text: 'ignored', tStart: 1 });
    expect(callbacks.onPartial).toHaveBeenCalledWith('hello');
    expect(callbacks.onPartial).toHaveBeenCalledTimes(1);
    expect(callbacks.onFinal).toHaveBeenCalledWith('hello there');

    session.stop();
    expect(session.state()).toBe('idle');
    onPartial?.({ channel: 'you', text: 'after stop', tStart: 3 });
    expect(callbacks.onPartial).toHaveBeenCalledTimes(1);

    await session.start();
    expect(engineOptions).toHaveLength(1);
  });

  it('stop() closes the microphone and keeps the model', async () => {
    const { deps, engine, mic, callbacks } = setup();
    const session = createMicSession(callbacks, deps);
    await session.start();
    session.stop();
    expect(mic.track.stop).toHaveBeenCalled();
    expect(engine.detach).toHaveBeenCalledWith('you');
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('reports a refused microphone and stays idle', async () => {
    const refused = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const { deps, callbacks } = setup({ openMic: () => Promise.reject(refused) });
    const session = createMicSession(callbacks, deps);
    await session.start();
    expect(session.state()).toBe('idle');
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('microphone'));
  });

  it('drops a model that failed to load, so the next try loads it again', async () => {
    const failed = Object.assign(new Error('x'), { code: 'download-network' });
    const { deps, engine, engineOptions, callbacks } = setup({ ready: Promise.reject(failed) });
    const session = createMicSession(callbacks, deps);
    await session.start();
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('speech model'));
    expect(engine.stop).toHaveBeenCalled();
    await session.start();
    expect(engineOptions).toHaveLength(2);
  });

  it('closes a microphone that opens after stop()', async () => {
    let open: (stream: MediaStream) => void = () => undefined;
    const late = fakeStream();
    const { deps, engine, callbacks } = setup({
      openMic: () => new Promise((resolve) => (open = resolve)),
    });
    const session = createMicSession(callbacks, deps);
    const starting = session.start();
    await Promise.resolve();
    await Promise.resolve();
    session.stop();
    open(late.stream);
    await starting;
    expect(late.track.stop).toHaveBeenCalled();
    expect(engine.attach).not.toHaveBeenCalled();
    expect(session.state()).toBe('idle');
  });

  it('close() ends the engine and the session', async () => {
    const { deps, engine, callbacks } = setup();
    const session = createMicSession(callbacks, deps);
    await session.start();
    session.close();
    expect(engine.stop).toHaveBeenCalled();
    await session.start();
    expect(session.state()).toBe('idle');
  });
});

describe('micErrorMessage', () => {
  it('names the problem without technical detail', () => {
    expect(micErrorMessage({ name: 'NotFoundError' })).toMatch(/No microphone/);
    expect(micErrorMessage(new Error('anything'))).toMatch(/Voice input could not start/);
  });
});
