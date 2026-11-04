/**
 * Tests for apps/web/src/core/punctuation/punctuator.ts (v1.1.0, ADR-0044), with a fake worker: nothing
 * starts until used; warm() loads the model; answers reach the right line; a line that fails or takes too
 * long stays as it was; a worker that fails is given up for good; dispose() answers what is waiting;
 * punctuateLine() puts the result in the transcript, and leaves it when there is no result.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createPunctuator,
  punctuateLine,
  PUNCTUATE_TIMEOUT_MS,
  type PunctWorkerLike,
} from '@/core/punctuation/punctuator';

/**
 * A fake worker.
 *
 * @returns The worker, with what it was sent.
 */
function fakeWorker() {
  const worker: PunctWorkerLike & { sent: unknown[] } = {
    sent: [],
    onmessage: null,
    onerror: null,
    postMessage: (message) => void worker.sent.push(message),
    terminate: vi.fn(),
  };
  return worker;
}

/**
 * A punctuator on a fake worker, with timers the test fires.
 *
 * @returns The punctuator, the worker, the start count and the timers.
 */
function setup() {
  const worker = fakeWorker();
  const createWorker = vi.fn(() => worker);
  const timers: (() => void)[] = [];
  const punctuator = createPunctuator(createWorker, (callback) => {
    timers.push(callback);
    return () => {
      timers.splice(timers.indexOf(callback), 1);
    };
  });
  return { punctuator, worker, createWorker, timers };
}

describe('createPunctuator', () => {
  it('starts nothing until it is used', () => {
    const { createWorker } = setup();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('warm() starts one worker and loads the model', () => {
    const { punctuator, worker, createWorker } = setup();
    punctuator.warm();
    punctuator.warm();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(worker.sent).toEqual([{ type: 'load' }, { type: 'load' }]);
  });

  it('gives each line its own answer, in any order', async () => {
    const { punctuator, worker } = setup();
    const first = punctuator.punctuate('first line');
    const second = punctuator.punctuate('second line');
    expect(worker.sent).toEqual([
      { type: 'punctuate', id: 1, text: 'first line' },
      { type: 'punctuate', id: 2, text: 'second line' },
    ]);
    worker.onmessage!({ data: { type: 'result', id: 2, text: 'Second line.', ms: 3 } });
    worker.onmessage!({ data: { type: 'result', id: 1, text: 'First line.', ms: 4 } });
    await expect(first).resolves.toBe('First line.');
    await expect(second).resolves.toBe('Second line.');
  });

  it('gives null for a line that fails, and carries on', async () => {
    const { punctuator, worker } = setup();
    const line = punctuator.punctuate('a line');
    worker.onmessage!({ data: { type: 'line-failed', id: 1 } });
    await expect(line).resolves.toBeNull();
    const next = punctuator.punctuate('next line');
    worker.onmessage!({ data: { type: 'result', id: 2, text: 'Next line.', ms: 1 } });
    await expect(next).resolves.toBe('Next line.');
  });

  it('gives null for a line that takes too long', async () => {
    const { punctuator, timers } = setup();
    expect(PUNCTUATE_TIMEOUT_MS).toBe(30_000);
    const line = punctuator.punctuate('a line');
    timers[0]!();
    await expect(line).resolves.toBeNull();
  });

  it('clears the time limit once a line is answered', async () => {
    const { punctuator, worker, timers } = setup();
    const line = punctuator.punctuate('a line');
    expect(timers).toHaveLength(1);
    worker.onmessage!({ data: { type: 'result', id: 1, text: 'A line.', ms: 1 } });
    await line;
    expect(timers).toHaveLength(0);
  });

  it('gives up for good when loading fails, and starts no new worker', async () => {
    const { punctuator, worker, createWorker } = setup();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const line = punctuator.punctuate('a line');
    worker.onmessage!({ data: { type: 'failed' } });
    await expect(line).resolves.toBeNull();
    expect(worker.terminate).toHaveBeenCalled();
    await expect(punctuator.punctuate('next')).resolves.toBeNull();
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('gives up when the worker cannot start', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const punctuator = createPunctuator(() => {
      throw new Error('blocked');
    });
    await expect(punctuator.punctuate('a line')).resolves.toBeNull();
  });

  it('logs timings only, never the words', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { punctuator, worker } = setup();
    punctuator.warm();
    worker.onmessage!({ data: { type: 'loaded', ms: 500 } });
    expect(info).toHaveBeenCalledWith('punctuation: loaded', { ms: 500 });
  });

  it('dispose() stops the worker and answers what is waiting', async () => {
    const { punctuator, worker } = setup();
    const line = punctuator.punctuate('a line');
    punctuator.dispose();
    expect(worker.terminate).toHaveBeenCalled();
    await expect(line).resolves.toBeNull();
  });
});

describe('punctuateLine', () => {
  it('puts the written line in the transcript', async () => {
    const refineFinal = vi.fn(() => true);
    await expect(
      punctuateLine(
        { punctuate: async () => 'What does it cost?' },
        { refineFinal },
        'u1',
        'WHAT DOES IT COST',
      ),
    ).resolves.toBe(true);
    expect(refineFinal).toHaveBeenCalledWith('u1', 'WHAT DOES IT COST', 'What does it cost?');
  });

  it('leaves the line when there is no result', async () => {
    const refineFinal = vi.fn(() => true);
    await expect(
      punctuateLine({ punctuate: async () => null }, { refineFinal }, 'u1', 'A LINE'),
    ).resolves.toBe(false);
    expect(refineFinal).not.toHaveBeenCalled();
  });
});
