/**
 * Tests for apps/web/src/core/turn/turnDetector.ts (v1.4, ADR-0065) with a fake worker: a judgment returns
 * the worker's probability; a failed request, a failed load and a timeout give null (auto-answer then uses
 * its word rule); the audio is sent as a copy; stop() ends the worker and the waiting requests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTurnDetector, TURN_TIMEOUT_MS, type TurnWorkerLike } from '@/core/turn/turnDetector';
import type { FromTurnWorker, ToTurnWorker } from '@/core/turn/turn.worker';

/**
 * A fake worker that answers each judgment with the given reply.
 *
 * @param reply What to answer (null: never answer).
 * @returns The worker and what it received.
 */
function fakeWorker(reply: ((id: number) => FromTurnWorker) | null) {
  const sent: ToTurnWorker[] = [];
  const worker: TurnWorkerLike = {
    onmessage: null,
    postMessage(message) {
      sent.push(message);
      if (message.type === 'judge' && reply) {
        const answer = reply(message.id);
        queueMicrotask(() => worker.onmessage?.({ data: answer }));
      }
    },
    terminate: vi.fn(),
  };
  return { worker, sent };
}

afterEach(() => vi.useRealTimers());

describe('createTurnDetector', () => {
  it('returns the probability, and sends a copy of the audio', async () => {
    const { worker, sent } = fakeWorker((id) => ({
      type: 'result',
      id,
      probability: 0.83,
      ms: 40,
    }));
    const detector = createTurnDetector(() => worker);
    const audio = new Float32Array([0.1, 0.2]);
    expect(await detector.judge(audio)).toBe(0.83);
    const request = sent.find((message) => message.type === 'judge');
    expect(request?.type === 'judge' && request.audio).not.toBe(audio);
  });

  it('gives null for a failed request or a failed load', async () => {
    const failing = fakeWorker((id) => ({ type: 'request-failed', id }));
    expect(await createTurnDetector(() => failing.worker).judge(new Float32Array(4))).toBeNull();
    const broken = fakeWorker(() => ({ type: 'failed' }));
    const detector = createTurnDetector(() => broken.worker);
    expect(await detector.judge(new Float32Array(4))).toBeNull();
    // After a failed load nothing more is sent.
    expect(await detector.judge(new Float32Array(4))).toBeNull();
    expect(broken.sent.filter((message) => message.type === 'judge')).toHaveLength(1);
  });

  it('gives null after the timeout, and stop() ends the worker', async () => {
    vi.useFakeTimers();
    const { worker } = fakeWorker(null);
    const detector = createTurnDetector(() => worker);
    const pending = detector.judge(new Float32Array(4));
    vi.advanceTimersByTime(TURN_TIMEOUT_MS + 1);
    expect(await pending).toBeNull();
    detector.stop();
    expect(worker.terminate).toHaveBeenCalled();
  });
});
