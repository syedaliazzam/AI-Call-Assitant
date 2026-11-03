/**
 * File: apps/desktop/src/accurate/worker.ts
 * Purpose: The accurate-transcription engine (ADR-0034), run in an Electron utility process so a
 *          native crash or a slow decode never touches the windows or the live engine. It loads
 *          sherpa-onnx's offline recognizer with the Parakeet model once ('load'), then transcribes
 *          one finished utterance per 'decode' message and posts the text back. It never logs or
 *          keeps audio or text.
 * Used by: src/accurate/host.ts (utilityProcess.fork of dist/accurate-worker.js)
 * Depends on: the staged native runtime (native/sherpa-onnx, scripts/stage-native.mjs),
 *             src/accurate/model.ts (file names)
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md
 */
import { createRequire } from 'node:module';
import path from 'node:path';

/** Messages from the host. */
export type ToWorker =
  | {
      /** Load the model (once). */
      type: 'load';
      /** The model folder. */
      modelDir: string;
      /** The staged native runtime folder (holds node_modules/sherpa-onnx-node). */
      nativeDir: string;
      /** Decoding threads (4, as measured in the ADR-0027 trial). */
      threads: number;
    }
  | {
      /** Transcribe one utterance. */
      type: 'decode';
      /** Matches the reply to the request. */
      id: number;
      /** Mono 16 kHz audio, -1…1. */
      samples: Float32Array;
    };

/** Messages to the host. */
export type FromWorker =
  | {
      /** The model is loaded. */
      type: 'loaded';
      /** Load time, in ms. */
      ms: number;
    }
  | {
      /** One utterance transcribed. */
      type: 'result';
      /** The request's id. */
      id: number;
      /** The text (never logged). */
      text: string;
      /** Decoding time, in ms. */
      ms: number;
    }
  | {
      /** Loading (id null) or one decode failed. */
      type: 'failed';
      /** The request's id, or null for a failed load. */
      id: number | null;
      /** The error's message (no audio or text in it). */
      message: string;
    };

/** The part of sherpa-onnx-node's API used here. */
interface Sherpa {
  /** The non-streaming recognizer (one decode per finished utterance). */
  OfflineRecognizer: new (config: unknown) => {
    createStream: () => {
      acceptWaveform: (wave: { sampleRate: number; samples: Float32Array }) => void;
    };
    decode: (stream: unknown) => void;
    getResult: (stream: unknown) => { text: string };
  };
}

/** The loaded recognizer, or null before 'load'. */
let recognizer: InstanceType<Sherpa['OfflineRecognizer']> | null = null;

/**
 * Loads the recognizer.
 *
 * @param message The load message.
 * @returns The load time, in ms.
 * @throws When the native runtime or the model cannot be loaded.
 */
function load(message: Extract<ToWorker, { type: 'load' }>): number {
  const started = Date.now();
  // createRequire, so the bundler leaves this runtime path alone (it is outside the bundle).
  const requireNative = createRequire(__filename);
  const sherpa = requireNative(
    path.join(message.nativeDir, 'node_modules', 'sherpa-onnx-node'),
  ) as Sherpa;
  const file = (name: string) => path.join(message.modelDir, name);
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: file('encoder.int8.onnx'),
        decoder: file('decoder.int8.onnx'),
        joiner: file('joiner.int8.onnx'),
      },
      tokens: file('tokens.txt'),
      numThreads: message.threads,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
    decodingMethod: 'greedy_search',
  });
  return Date.now() - started;
}

/**
 * Handles one message from the host.
 *
 * @param message The message.
 * @param post    Sends a reply.
 * Called from: the parentPort listener below; tests
 */
export function handle(message: ToWorker, post: (reply: FromWorker) => void): void {
  if (message.type === 'load') {
    try {
      post({ type: 'loaded', ms: load(message) });
    } catch (error) {
      post({ type: 'failed', id: null, message: error instanceof Error ? error.message : 'load' });
    }
    return;
  }
  if (!recognizer) {
    post({ type: 'failed', id: message.id, message: 'not loaded' });
    return;
  }
  try {
    const started = performance.now();
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: 16_000, samples: message.samples });
    recognizer.decode(stream);
    const text = recognizer.getResult(stream).text.trim();
    post({ type: 'result', id: message.id, text, ms: Math.round(performance.now() - started) });
  } catch (error) {
    post({
      type: 'failed',
      id: message.id,
      message: error instanceof Error ? error.message : 'decode',
    });
  }
}

/** The utility process's link to the host (absent when this file is imported by a test). */
const parentPort = (
  process as unknown as {
    parentPort?: {
      /** Receives the host's messages. */
      on: (event: 'message', listener: (event: { data: ToWorker }) => void) => void;
      /** Replies to the host. */
      postMessage: (message: FromWorker) => void;
    };
  }
).parentPort;
parentPort?.on('message', (event) => handle(event.data, (reply) => parentPort.postMessage(reply)));
