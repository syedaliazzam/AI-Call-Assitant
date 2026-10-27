/**
 * Tests for apps/web/src/core/stt/sttEngine.ts, with a fake Worker and fake Web Audio objects:
 * the engine posts one 'load' with the resolved file URLs and the formatted (upper-case)
 * hotwords; `ready` resolves on 'ready' and rejects with the error code on an early error;
 * partial, final, progress and stats messages reach the callbacks; attach() builds one worklet
 * per channel and hands its port to the worker; detach() and setHotwords() post the right
 * messages; stop() ends the worker and ignores later messages. Second pass (Day 2 Stage 5): a
 * second worker is created only when it is on; both workers get one end of a MessageChannel;
 * ready waits for both; final lines carry their latency; refined results arrive after their
 * final line (an early one is held back) with their own latency; stats add the second worker's
 * numbers and the RTF of both workers; a second pass that fails to load is reported and leaves
 * the first pass running; setHotwords and stop reach both workers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSttEngine, type SttEngineDeps } from '@/core/stt/sttEngine';
import type { FromSecondPass, FromWorker, ToSecondPass, ToWorker } from '@/core/stt/protocol';

/** A fake worker that records posted messages and lets the test send replies. */
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

/** A fake AudioContext. */
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

/** A fake second-pass worker. */
function fakeSecondWorker() {
  const posted: { message: ToSecondPass; transfer: Transferable[] }[] = [];
  const worker = {
    onmessage: null as ((event: MessageEvent<FromSecondPass>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: vi.fn((message: ToSecondPass, transfer: Transferable[] = []) => {
      posted.push({ message, transfer });
    }),
    terminate: vi.fn(),
  };
  const reply = (message: FromSecondPass) =>
    worker.onmessage?.({ data: message } as MessageEvent<FromSecondPass>);
  return { worker, posted, reply };
}

/** Builds the engine with fakes. The page clock is fixed at NOW. */
function setup(options: Parameters<typeof createSttEngine>[0] = {}) {
  const fake = fakeWorker();
  const second = fakeSecondWorker();
  const context = fakeAudioContext();
  const createSecondPassWorker = vi.fn(() => second.worker as unknown as Worker);
  const deps: SttEngineDeps = {
    createWorker: () => fake.worker as unknown as Worker,
    createSecondPassWorker,
    createAudioContext: () => context as unknown as AudioContext,
    origin: 'http://localhost:3000',
    now: () => NOW,
  };
  const engine = createSttEngine({ source: 'local', ...options }, deps);
  return { engine, context, second, createSecondPassWorker, ...fake };
}

/** The page clock in these tests (Unix ms). */
const NOW = 1_000_000;

/** A final line that ended speaking 800 ms before NOW. */
function finalMessage(text: string, segmentId = 'you-1', secondPass = false): FromWorker {
  return {
    type: 'final',
    channel: 'you',
    text,
    reason: 'model',
    tStart: NOW - 3_000,
    tEnd: NOW - 700,
    segmentId,
    speechEnd: NOW - 800,
    secondPass,
  };
}

/** A minimal second-pass 'ready' message. */
const SECOND_READY: FromSecondPass = {
  type: 'ready',
  load: {
    model: 'moonshine-v2-tiny-en',
    bytes: 2,
    fromCache: true,
    cacheAvailable: true,
    downloadMs: 1,
    runtimeInitMs: 1,
    modelInitMs: 1,
    totalMs: 3,
  },
};

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
    reply(finalMessage('OK'));
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
    // Progress is against the total of every file, known before any download starts.
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ file: 'a', loadedBytes: 1, totalBytes: 204_479_670 }),
    );
    expect(onPartial).toHaveBeenCalledWith({ channel: 'them', text: 'HI', tStart: 5 });
    expect(onFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'you',
        reason: 'model',
        segmentId: 'you-1',
        latencyMs: 800,
      }),
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
    reply(finalMessage('LATE'));
    expect(onFinal).not.toHaveBeenCalled();
    await expect(engine.attach('you', {} as MediaStream)).rejects.toThrow(/stopped/);
  });

  describe('second pass', () => {
    it('creates no second worker when it is off', () => {
      const { createSecondPassWorker, posted } = setup();
      expect(createSecondPassWorker).not.toHaveBeenCalled();
      const load = posted[0]!.message;
      expect(load.type === 'load' && load.secondPassPort).toBeFalsy();
    });

    it('gives each worker one end of a channel, and ready waits for both', async () => {
      const { engine, reply, posted, second } = setup({ secondPass: 'moonshine-v2-tiny-en' });
      const load = posted[0]!.message;
      expect(load.type === 'load' && load.secondPassPort).toBeTruthy();
      expect(posted[0]!.transfer).toHaveLength(1);
      const secondLoad = second.posted[0]!.message;
      expect(secondLoad).toMatchObject({ type: 'load', model: 'moonshine-v2-tiny-en' });
      if (secondLoad.type !== 'load') return;
      expect(secondLoad.runtime.wasm.url).toBe(
        'http://localhost:3000/stt-runtime/v1.13.2/sherpa-onnx-wasm-main-vad-asr.wasm',
      );
      expect(second.posted[0]!.transfer).toEqual([secondLoad.jobs]);

      let settled = false;
      void engine.ready.then(() => (settled = true));
      reply(READY);
      await Promise.resolve();
      expect(settled).toBe(false);
      second.reply(SECOND_READY);
      await expect(engine.ready).resolves.toMatchObject({
        fromCache: true,
        secondPass: { model: 'moonshine-v2-tiny-en' },
      });
    });

    it('passes refined text after its final line, with the latency from the end of speech', async () => {
      const onFinal = vi.fn();
      const onRefined = vi.fn();
      const { reply, second } = setup({
        secondPass: 'zipformer-gigaspeech-en-2023-12-12',
        onFinal,
        onRefined,
      });
      reply(READY);
      second.reply(SECOND_READY);
      const refined = (segmentId: string): FromSecondPass => ({
        type: 'refined',
        segmentId,
        channel: 'you',
        text: 'refined text',
        status: 'refined',
        speechEnd: NOW - 1_400,
        audioMs: 3_000,
        speechMs: 2_500,
        vadMs: 40,
        decodeMs: 350,
        queuedMs: 2,
      });
      reply(finalMessage('first pass', 'you-1', true));
      second.reply(refined('you-1'));
      expect(onRefined).toHaveBeenCalledWith(
        expect.objectContaining({ segmentId: 'you-1', text: 'refined text', latencyMs: 1_400 }),
      );
      // A result that beats its final line (the two workers race) waits for it.
      second.reply(refined('you-2'));
      expect(onRefined).toHaveBeenCalledTimes(1);
      reply(finalMessage('second line', 'you-2', true));
      expect(onRefined).toHaveBeenCalledTimes(2);
      expect(onFinal.mock.invocationCallOrder[1]!).toBeLessThan(
        onRefined.mock.invocationCallOrder[1]!,
      );
    });

    it('adds the second worker to stats: its numbers and the RTF of both workers', () => {
      const onStats = vi.fn();
      const { reply, second } = setup({ secondPass: 'moonshine-v2-tiny-en', onStats });
      second.reply({
        type: 'stats',
        stats: {
          jobs: 1,
          outcomes: { refined: 1, 'no-speech': 0, dropped: 0, failed: 0 },
          audioMs: 3_000,
          speechMs: 2_000,
          vadMs: 50,
          decodeMs: 250,
          queueMsMax: 3,
          wasmMemoryBytes: 537_000_000,
        },
      });
      reply({
        type: 'stats',
        stats: {
          channels: {},
          combinedRtf: 0.3,
          totalDecodeMs: 3_000,
          totalAudioMs: 10_000,
          wasmMemoryBytes: 537_000_000,
        },
      });
      expect(onStats).toHaveBeenCalledWith(
        expect.objectContaining({
          combinedRtf: 0.3,
          allWorkersRtf: (3_000 + 50 + 250) / 10_000,
          secondPass: expect.objectContaining({ wasmMemoryBytes: 537_000_000 }),
        }),
      );
    });

    it('reports a second pass that fails to load, and keeps the first pass', async () => {
      const onError = vi.fn();
      const { engine, reply, second } = setup({ secondPass: 'moonshine-v2-tiny-en', onError });
      reply(READY);
      second.reply({ type: 'error', code: 'runtime', message: 'no SharedArrayBuffer' });
      await expect(engine.ready).resolves.toMatchObject({ secondPass: null });
      expect(onError).toHaveBeenCalledWith({
        code: 'second-pass',
        message: 'Second pass: no SharedArrayBuffer',
      });
    });

    it('sends hotwords and stop to both workers', async () => {
      vi.useFakeTimers();
      const { engine, reply, posted, second, worker } = setup({
        secondPass: 'zipformer-gigaspeech-en-2023-12-12',
      });
      reply(READY);
      second.reply(SECOND_READY);
      await engine.ready;
      const done = engine.setHotwords('Kite');
      await vi.waitFor(() =>
        expect(second.posted.at(-1)!.message).toEqual({
          type: 'set-hotwords',
          hotwords: 'KITE :1.5\n',
        }),
      );
      reply({ type: 'hotwords-set', ms: 1 });
      second.reply({ type: 'hotwords-set', ms: 1 });
      await expect(done).resolves.toBeUndefined();
      engine.stop();
      expect(posted.at(-1)!.message).toEqual({ type: 'stop' });
      expect(second.posted.at(-1)!.message).toEqual({ type: 'stop' });
      vi.advanceTimersByTime(300);
      expect(worker.terminate).toHaveBeenCalled();
      expect(second.worker.terminate).toHaveBeenCalled();
    });
  });
});
