/**
 * File: apps/web/src/core/turn/turnDetector.ts
 * Purpose: The page's side of the end-of-turn model (v1.4, ADR-0065): sends the last seconds of the other
 *          person's audio to turn.worker.ts and returns how likely it is that they finished speaking.
 *          Loads lazily; when the model cannot load or a request fails, it answers null and auto-answer
 *          falls back to its word rule (core/transcript/complete.ts). No React.
 * Used by: src/features/live/LivePage.tsx (each "Them" final line)
 * Depends on: src/core/turn/turn.worker.ts
 * Architecture: docs/decisions/ADR-0065-end-of-question-and-none-replies.md
 *
 * Audio goes only from the page to this worker, in memory; only times are logged.
 */
import type { FromTurnWorker, ToTurnWorker } from './turn.worker';

/** The parts of a Worker used here (tests pass a fake). */
export interface TurnWorkerLike {
  /** Sends a request (the audio buffer is transferred). */
  postMessage(message: ToTurnWorker, transfer?: Transferable[]): void;
  /** Receives replies. */
  onmessage: ((event: { data: FromTurnWorker }) => void) | null;
  /** Ends the worker. */
  terminate(): void;
}

/** What createTurnDetector() returns. */
export interface TurnDetector {
  /** Starts loading the model (call when a call starts). */
  warm(): void;
  /**
   * How likely the speaker has finished.
   *
   * @param audio 16 kHz samples ending where they paused (the last 8 s are used).
   * @returns 0…1, or null when the model is unavailable or the request failed or took too long.
   */
  judge(audio: Float32Array): Promise<number | null>;
  /** Ends the worker. */
  stop(): void;
}

/** The longest a judgment may take before it counts as failed, ms (it normally takes well under 0.3 s). */
export const TURN_TIMEOUT_MS = 1_500;

/**
 * Creates the detector (the worker starts on first use).
 *
 * @param createWorker Makes the worker (tests pass a fake).
 * @returns The detector.
 * Called from: LivePage.tsx; tests
 */
export function createTurnDetector(
  createWorker: () => TurnWorkerLike = () =>
    new Worker(new URL('./turn.worker.ts', import.meta.url)) as unknown as TurnWorkerLike,
): TurnDetector {
  let worker: TurnWorkerLike | null = null;
  let failed = false;
  let nextId = 1;
  const waiting = new Map<number, (probability: number | null) => void>();

  /**
   * The worker, started on first use.
   *
   * @returns The worker, or null once loading failed.
   */
  const ensure = (): TurnWorkerLike | null => {
    if (failed) return null;
    if (worker) return worker;
    try {
      worker = createWorker();
    } catch {
      failed = true;
      return null;
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'failed') {
        failed = true;
        for (const resolve of waiting.values()) resolve(null);
        waiting.clear();
        console.info('turn: model unavailable');
        return;
      }
      if (data.type === 'loaded') {
        console.info('turn: model loaded', { ms: data.ms });
        return;
      }
      const resolve = waiting.get(data.id);
      waiting.delete(data.id);
      resolve?.(data.type === 'result' ? data.probability : null);
    };
    return worker;
  };

  return {
    warm() {
      ensure()?.postMessage({ type: 'load' });
    },
    judge(audio) {
      const target = ensure();
      if (!target) return Promise.resolve(null);
      const id = nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve(null);
        }, TURN_TIMEOUT_MS);
        waiting.set(id, (probability) => {
          clearTimeout(timer);
          resolve(probability);
        });
        const copy = audio.slice();
        target.postMessage({ type: 'judge', id, audio: copy }, [copy.buffer]);
      });
    },
    stop() {
      worker?.terminate();
      worker = null;
      for (const resolve of waiting.values()) resolve(null);
      waiting.clear();
    },
  };
}
