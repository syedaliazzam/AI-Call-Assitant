/**
 * Tests for apps/web/src/core/stt/sttEngine.ts, with a fake Worker and fake Web Audio objects:
 * the engine posts one 'load' with the resolved file URLs and the formatted (upper-case)
 * hotwords; `ready` resolves on 'ready' and rejects with the error code on an early error;
 * partial, final, progress and stats messages reach the callbacks; attach() builds one worklet
 * per channel and hands its port to the worker; detach() and setHotwords() post the right
 * messages; stop() ends the worker and ignores later messages; a final line's latency is
 * measured on the page from its end of speech.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSttEngine, type SttEngineDeps } from '@/core/stt/sttEngine';
import type { FromWorker, ToWorker } from '@/core/stt/protocol';

/**
 * A fake worker that records posted messages and lets the test send replies.
 *
 * @returns The worker, the messages posted to it, and reply() to answer as the worker.
 */
function fakeWorker() {
  const posted: { message: ToWorker; transfer: Transferable[] }[] = [];
  const worker = {
    onmessage: null as ((event: MessageEvent<FromWorker>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: vi.fn((message: ToWorker, transfer: Transferable[] = []) => {
      posted.push({ message, transfer });
    }),
    terminate: vi.fn(),
  };
  const reply = (message: FromWorker) =>
    worker.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  return { worker, posted, reply };
}

/**
 * A fake AudioContext with the calls the engine makes (worklet module, nodes, close).
 *
 * @returns The context.
 */
function fakeAudioContext() {
  return {
    sampleRate: 16_000,
    state: 'running',
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

/** AudioWorkletNode stand-in: records the ports it was given. */
class FakeWorkletNode {
  static created: FakeWorkletNode[] = [];
  port = { postMessage: vi.fn(), close: vi.fn() };
  disconnect = vi.fn();
  constructor() {
    FakeWorkletNode.created.push(this);
  }
}

/**
 * Builds the engine with fakes (worker, AudioContext, a fixed clock).
 *
 * @param options Engine options (the source is always local).
 * @returns The engine, the fakes, and reply() to answer as the worker.
 */
function setup(options: Parameters<typeof createSttEngine>[0] = {}) {
  const fake = fakeWorker();
  const context = fakeAudioContext();
  const deps: SttEngineDeps = {
    createWorker: () => fake.worker as unknown as Worker,
    createAudioContext: () => context as unknown as AudioContext,
    origin: 'http://localhost:3000',
    now: () => 10_000,
  };
  const engine = createSttEngine({ source: 'local', ...options }, deps);
  return { engine, context, ...fake };
}

/** A minimal 'ready' message. */
const READY: FromWorker = {
  type: 'ready',
  load: {
    model: 'zipformer-en-2023-06-21',
    bytes: 1,
    fromCache: true,
    cacheAvailable: true,
    downloadMs: 1,
    runtimeInitMs: 1,
    modelInitMs: 1,
    totalMs: 3,
  },
};

afterEach(() => {
  vi.useRealTimers();
  FakeWorkletNode.created = [];
});

describe('createSttEngine', () => {
  it('posts one load message with resolved URLs and upper-case hotwords', () => {
    const { posted } = setup({ hotwords: 'Bluefin Route :2' });
    expect(posted).toHaveLength(1);
    const load = posted[0]!.message;
    expect(load.type).toBe('load');
    if (load.type !== 'load') return;
    expect(load.hotwords).toBe('BLUEFIN ROUTE :2\n');
    expect(load.runtime.wasm.url).toBe(
      'http://localhost:3000/stt-runtime/v1.13.7/sherpa-onnx-wasm-main-asr.wasm',
    );
    expect(load.files.encoder.url).toBe(
      'http://localhost:3000/models/stt/zipformer-en-2023-06-21/encoder-epoch-99-avg-1.int8.onnx',
    );
  });

  it('resolves ready, and forwards progress, partial, final and stats', async () => {
    const onProgress = vi.fn();
    const onPartial = vi.fn();
    const onFinal = vi.fn();
    const onStats = vi.fn();
    const { engine, reply } = setup({ onProgress, onPartial, onFinal, onStats });
    reply({
      type: 'progress',
      progress: { file: 'a', loadedBytes: 1, totalBytes: 2, fraction: 0.5 },
    });
    reply(READY);
    await expect(engine.ready).resolves.toMatchObject({ fromCache: true });
    reply({ type: 'partial', channel: 'them', text: 'HI', tStart: 5 });
    reply({
      type: 'final',
      channel: 'you',
      text: 'OK',
      reason: 'model',
      tStart: 1,
      tEnd: 9_000,
      speechEnd: 8_400.4,
    });
    reply({
      type: 'stats',
      stats: {
        channels: {},
        combinedRtf: 0.2,
        totalDecodeMs: 2,
        totalAudioMs: 10,
        wasmMemoryBytes: 0,
      },
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ fraction: 0.5 }));
    expect(onPartial).toHaveBeenCalledWith({ channel: 'them', text: 'HI', tStart: 5 });
    expect(onFinal).toHaveBeenCalledWith(
      // now() is 10 000, so end of speech → page is 1 599.6 ms, rounded.
      expect.objectContaining({ channel: 'you', reason: 'model', latencyMs: 1_600 }),
    );
    expect(onStats).toHaveBeenCalledWith(expect.objectContaining({ combinedRtf: 0.2 }));
  });

  it('rejects ready with the error code when loading fails', async () => {
    const onError = vi.fn();
    const { engine, reply } = setup({ onError });
    reply({ type: 'error', code: 'download-checksum', message: 'bad file' });
    await expect(engine.ready).rejects.toMatchObject({ code: 'download-checksum' });
    expect(onError).toHaveBeenCalledWith({ code: 'download-checksum', message: 'bad file' });
  });

  it('attaches a channel through its own worklet and hands the port to the worker', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    const { engine, reply, posted, context } = setup();
    reply(READY);
    await engine.attach('you', {} as MediaStream);
    await engine.attach('them', {} as MediaStream);
    expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(FakeWorkletNode.created).toHaveLength(2);
    const attaches = posted.filter((entry) => entry.message.type === 'attach');
    expect(
      attaches.map((entry) => entry.message.type === 'attach' && entry.message.channel),
    ).toEqual(['you', 'them']);
    expect(attaches[0]!.transfer).toHaveLength(1);

    engine.detach('you');
    expect(posted.at(-1)!.message).toEqual({ type: 'detach', channel: 'you' });
    expect(FakeWorkletNode.created[0]!.disconnect).toHaveBeenCalled();
  });

  it('sets hotwords and resolves when the worker confirms', async () => {
    const { engine, reply, posted } = setup();
    reply(READY);
    const done = engine.setHotwords('Kite');
    await vi.waitFor(() =>
      expect(posted.at(-1)!.message).toEqual({ type: 'set-hotwords', hotwords: 'KITE :1.5\n' }),
    );
    reply({ type: 'hotwords-set', ms: 1800 });
    await expect(done).resolves.toBeUndefined();
  });

  it('stops: posts stop, ends the worker, ignores later messages, refuses new channels', async () => {
    vi.useFakeTimers();
    const onFinal = vi.fn();
    const { engine, reply, posted, worker } = setup({ onFinal });
    reply(READY);
    engine.stop();
    expect(posted.at(-1)!.message).toEqual({ type: 'stop' });
    vi.advanceTimersByTime(300);
    expect(worker.terminate).toHaveBeenCalled();
    reply({
      type: 'final',
      channel: 'you',
      text: 'LATE',
      reason: 'flush',
      tStart: 1,
      tEnd: 2,
      speechEnd: 2,
    });
    expect(onFinal).not.toHaveBeenCalled();
    await expect(engine.attach('you', {} as MediaStream)).rejects.toThrow(/stopped/);
  });
});
