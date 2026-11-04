/**
 * File: apps/web/src/core/punctuation/punctuator.ts
 * Purpose: The page's side of the offline punctuation pass (v1.1.0, ADR-0044): starts the worker,
 *          sends it finished lines and puts the written text in the transcript. It is an extra: when
 *          the files are missing, the worker fails or a line takes too long, the line simply stays as
 *          the engine wrote it. Logs ids and timings only, never text.
 * Used by: src/features/live/LivePage.tsx; tests
 * Depends on: src/core/punctuation/punct.worker.ts, src/core/transcript/transcript.ts
 * Architecture: docs/decisions/ADR-0044-transcript-auto-punctuation-cleanup.md
 */
import type { Transcript } from '../transcript/transcript';
import type { FromPunctWorker, ToPunctWorker } from './punct.worker';

/** How long one line may wait, in ms: enough for the first load on a slow connection. */
export const PUNCTUATE_TIMEOUT_MS = 30_000;

/** The parts of a Web Worker used here. */
export interface PunctWorkerLike {
  /** Sends a message. */
  postMessage(message: ToPunctWorker): void;
  /** Receives a message. */
  onmessage: ((event: { data: FromPunctWorker }) => void) | null;
  /** Told of a worker that cannot start. */
  onerror: (() => void) | null;
  /** Stops the worker. */
  terminate(): void;
}

/** The punctuation pass. */
export interface Punctuator {
  /** Loads the model now, so the first line of a call does not wait for it. */
  warm(): void;
  /**
   * Writes a line with marks and capitals.
   *
   * @param text The line. Never logged.
   * @returns The written line, or null when the pass could not do it.
   */
  punctuate(text: string): Promise<string | null>;
  /** Stops the worker. Lines still waiting give null. */
  dispose(): void;
}

/**
 * Creates the punctuation pass. Nothing is started until it is first used.
 *
 * @param createWorker Starts the worker (a fake in tests).
 * @param setTimer     Runs a callback later (a fake in tests).
 * @returns The pass.
 * Called from: LivePage.tsx; tests
 */
export function createPunctuator(
  createWorker: () => PunctWorkerLike = () =>
    // Classic worker (no { type: 'module' }): the runtime's loader needs importScripts.
    new Worker(new URL('./punct.worker.ts', import.meta.url)) as unknown as PunctWorkerLike,
  setTimer: (callback: () => void, ms: number) => () => void = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
): Punctuator {
  let worker: PunctWorkerLike | null = null;
  /** True once the pass has failed for good: lines then stay as they are. */
  let failed = false;
  let nextId = 1;
  const waiting = new Map<number, { resolve: (text: string | null) => void; cancel: () => void }>();

  /**
   * Answers one waiting line.
   *
   * @param id   The line's request id.
   * @param text The written line, or null.
   */
  const finish = (id: number, text: string | null) => {
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    entry.cancel();
    entry.resolve(text);
  };

  /** Gives up for good: every waiting line stays as it is. */
  const giveUp = () => {
    failed = true;
    console.info('punctuation: not available');
    worker?.terminate();
    worker = null;
    for (const id of [...waiting.keys()]) finish(id, null);
  };

  /**
   * The worker, started the first time.
   *
   * @returns The worker, or null when it cannot be started.
   */
  const ensure = (): PunctWorkerLike | null => {
    if (worker || failed) return worker;
    try {
      worker = createWorker();
    } catch {
      giveUp();
      return null;
    }
    worker.onerror = giveUp;
    worker.onmessage = ({ data }) => {
      if (data.type === 'failed') giveUp();
      else if (data.type === 'line-failed') finish(data.id, null);
      else if (data.type === 'loaded') console.info('punctuation: loaded', { ms: data.ms });
      else finish(data.id, data.text);
    };
    return worker;
  };

  return {
    warm() {
      ensure()?.postMessage({ type: 'load' });
    },
    punctuate(text) {
      const target = ensure();
      if (!target) return Promise.resolve(null);
      const id = nextId++;
      return new Promise((resolve) => {
        const cancel = setTimer(() => finish(id, null), PUNCTUATE_TIMEOUT_MS);
        waiting.set(id, { resolve, cancel });
        target.postMessage({ type: 'punctuate', id, text });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const id of [...waiting.keys()]) finish(id, null);
    },
  };
}

/**
 * Puts a finished line's marks and capitals in the transcript.
 *
 * @param punctuator The pass.
 * @param transcript The call's transcript.
 * @param lineId     The final line's id (from addFinal).
 * @param heard      The live engine's words for this utterance.
 * @returns True when the line was changed.
 * Called from: LivePage.tsx (onFinal); tests
 */
export async function punctuateLine(
  punctuator: Pick<Punctuator, 'punctuate'>,
  transcript: Pick<Transcript, 'refineFinal'>,
  lineId: string,
  heard: string,
): Promise<boolean> {
  const text = await punctuator.punctuate(heard);
  return text === null ? false : transcript.refineFinal(lineId, heard, text);
}
