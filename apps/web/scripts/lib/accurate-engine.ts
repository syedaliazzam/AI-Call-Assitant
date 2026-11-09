/**
 * File: apps/web/scripts/lib/accurate-engine.ts
 * Purpose: Runs the desktop app's accurate-transcription engine (Parakeet, ADR-0034) for the synthetic call
 *          harness (v1.4 Phase 5a, ADR-0066): the very worker the desktop app starts
 *          (apps/desktop/dist/accurate-worker.js, built by `pnpm --filter @kite/desktop build`), in a Node
 *          child process as the app runs it in a utility process, with the same native runtime
 *          (apps/desktop/native/sherpa-onnx) and one decode at a time, as host.ts does. It reports each
 *          decode's time and the process's CPU time, so a thread count can be measured during a call.
 * Used by: scripts/stt-calls.ts (--accurate)
 * Depends on: apps/desktop/dist/accurate-worker.js, apps/desktop/native/sherpa-onnx, a Parakeet model folder
 * Architecture: docs/decisions/ADR-0066-accurate-on-them-by-default.md
 *
 * Text is never printed; only times and counts.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The desktop app's folder in this checkout. */
const DESKTOP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'desktop',
);

/** One decode as measured. */
export interface AccurateDecode {
  /** Which channel's line. */
  channel: 'you' | 'them';
  /** The line's audio length, in seconds. */
  seconds: number;
  /** Decoding time reported by the engine, in ms. */
  ms: number;
  /** From the request to the reply, queue included, in ms. */
  waitMs: number;
}

/** A running engine. */
export interface AccurateEngineRun {
  /** Loading time of the model, in ms. */
  loadMs: number;
  /**
   * Transcribes one line (queued behind earlier ones, as host.ts does).
   *
   * @param channel Whose line (for the statistics only).
   * @param samples Mono 16 kHz audio, -1…1.
   * @returns The text, or null when the engine failed.
   */
  transcribe: (channel: 'you' | 'them', samples: Float32Array) => Promise<string | null>;
  /** Every decode so far. */
  decodes: AccurateDecode[];
  /**
   * The engine process's CPU time so far (user + system), in ms.
   *
   * @returns The CPU time.
   */
  cpuMs: () => Promise<number>;
  /** Stops the process. */
  stop: () => void;
}

/** The child's code: the desktop worker's handle(), fed over Node IPC instead of Electron's parentPort. */
const CHILD = `
const { handle } = require(process.env.KITE_ACCURATE_WORKER);
process.on('message', (message) => {
  if (message.type === 'cpu') {
    const usage = process.cpuUsage();
    process.send({ type: 'cpu', ms: (usage.user + usage.system) / 1000 });
    return;
  }
  handle(message, (reply) => process.send(reply));
});
`;

/**
 * Starts the engine and loads the model.
 *
 * @param threads  Decoding threads (the desktop app's THREADS).
 * @param modelDir A folder with Parakeet's encoder/decoder/joiner .int8.onnx and tokens.txt.
 * @param tempDir  A folder for the child's small script.
 * @returns The running engine.
 * @throws When the desktop build, the native runtime or the model is missing, or loading fails.
 * Called from: record() in stt-calls.ts
 */
export async function startAccurateEngine(
  threads: number,
  modelDir: string,
  tempDir: string,
): Promise<AccurateEngineRun> {
  const workerPath = path.join(DESKTOP_DIR, 'dist', 'accurate-worker.js');
  const nativeDir = path.join(DESKTOP_DIR, 'native', 'sherpa-onnx');
  if (!existsSync(workerPath))
    throw new Error('Build the desktop app first: pnpm --filter @kite/desktop build');
  if (!existsSync(path.join(modelDir, 'encoder.int8.onnx')))
    throw new Error(`No Parakeet model in ${modelDir}`);
  const arch = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
  const dllDir = path.join(nativeDir, 'modules', `sherpa-onnx-${arch}`);
  const childPath = path.join(tempDir, 'accurate-child.cjs');
  writeFileSync(childPath, CHILD);
  const child: ChildProcess = fork(childPath, [], {
    // Typed arrays cross intact (structured clone), as with Electron's utility process.
    serialization: 'advanced',
    env: {
      ...process.env,
      KITE_ACCURATE_WORKER: workerPath,
      // Windows finds the engine's DLLs through PATH (as host.ts sets it).
      PATH: `${dllDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  });
  const listeners = new Set<(message: Record<string, unknown>) => void>();
  child.on('message', (message) => {
    for (const listener of listeners) listener(message as Record<string, unknown>);
  });
  /**
   * Waits for the first reply that matches.
   *
   * @param match Picks the reply.
   * @returns The reply.
   */
  const next = (match: (message: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const listener = (message: Record<string, unknown>) => {
        if (!match(message)) return;
        listeners.delete(listener);
        resolve(message);
      };
      listeners.add(listener);
    });
  const loadedReply = next((message) => message.type === 'loaded' || message.id === null);
  child.send({ type: 'load', modelDir, nativeDir, threads });
  const loaded = await loadedReply;
  if (loaded.type !== 'loaded') {
    child.kill();
    throw new Error(`The accurate engine did not load: ${String(loaded.message)}`);
  }
  const decodes: AccurateDecode[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let nextId = 1;

  const transcribe = (channel: 'you' | 'them', samples: Float32Array): Promise<string | null> => {
    const askedAt = performance.now();
    const run = queue.then(async () => {
      const id = nextId++;
      const reply = next((message) => message.id === id);
      child.send({ type: 'decode', id, samples });
      const message = await reply;
      if (message.type !== 'result') return null;
      decodes.push({
        channel,
        seconds: samples.length / 16_000,
        ms: Number(message.ms),
        waitMs: Math.round(performance.now() - askedAt),
      });
      return String(message.text);
    });
    queue = run.catch(() => undefined);
    return run;
  };

  const cpuMs = async () => {
    const reply = next((message) => message.type === 'cpu');
    child.send({ type: 'cpu' });
    return Number((await reply).ms);
  };

  return {
    loadMs: Number(loaded.ms),
    transcribe,
    decodes,
    cpuMs,
    stop: () => {
      child.kill();
    },
  };
}
