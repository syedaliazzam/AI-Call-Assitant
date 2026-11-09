/**
 * File: apps/web/src/core/turn/turn.worker.ts
 * Purpose: Runs the end-of-turn model (v1.4, ADR-0065) in a worker of its own: for the last 8 s of the
 *          other person's audio it answers how likely it is that they have finished speaking (rather
 *          than paused mid-question). Loads ONNX Runtime's WebAssembly build (the punctuation pass's,
 *          from our own origin) and the Smart Turn model once, on first use.
 * Used by: src/core/turn/turnDetector.ts (new Worker(new URL('./turn.worker.ts', import.meta.url)))
 * Depends on: src/core/turn/features.ts, src/core/turn/model.ts, src/core/punctuation/model.ts (runtime)
 * Architecture: docs/decisions/ADR-0065-end-of-question-and-none-replies.md
 *
 * A classic worker, like the speech and punctuation workers: importScripts loads the runtime as a plain
 * file. Audio arrives in memory and is dropped after each answer; only numbers are posted back.
 */
import { PUNCT_RUNTIME_FILES, PUNCT_RUNTIME_PATH } from '../punctuation/model';
import { N_FRAMES, N_MELS, turnFeatures } from './features';
import { TURN_INPUT_NAME, TURN_MODEL_FILE, TURN_PUBLIC_PATH } from './model';

/** A request to the worker. */
export type ToTurnWorker =
  | {
      /** Load the model now (before the first request). */
      type: 'load';
    }
  | {
      /** Judge one stretch of audio. */
      type: 'judge';
      /** The request's id. */
      id: number;
      /** 16 kHz samples, ending where the speaker paused. */
      audio: Float32Array;
    };

/** A reply from the worker. */
export type FromTurnWorker =
  | {
      /** The model is ready. */
      type: 'loaded';
      /** How long loading took, ms. */
      ms: number;
    }
  | {
      /** Loading failed: no request can be judged. */
      type: 'failed';
    }
  | {
      /** One answer. */
      type: 'result';
      /** The request's id. */
      id: number;
      /** How likely the speaker has finished, 0…1. */
      probability: number;
      /** How long it took, ms. */
      ms: number;
    }
  | {
      /** One request failed. */
      type: 'request-failed';
      /** The request's id. */
      id: number;
    };

/** An output tensor. */
interface OrtTensor {
  /** The values. */
  data: Float32Array;
}

/** The parts of ONNX Runtime used here (its global, from the runtime's loader). */
interface Ort {
  /** The runtime's settings. */
  env: {
    /** The WebAssembly settings. */
    wasm: {
      /** Where its files are. */
      wasmPaths: string;
      /** How many threads to use. */
      numThreads: number;
    };
  };
  /** Builds a tensor. */
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  /** The model's session. */
  InferenceSession: {
    /** Loads a model. */
    create(
      model: Uint8Array,
      options: { executionProviders: string[] },
    ): Promise<{
      /** The model's output names. */
      outputNames: readonly string[];
      /** Runs the model. */
      run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
    }>;
  };
}

/** The worker's global scope, as used here. */
const scope = globalThis as unknown as {
  /** Loads a plain script. */
  importScripts: (...urls: string[]) => void;
  /** ONNX Runtime, once its loader has run. */
  ort: Ort;
  /** Where this worker runs. */
  location: {
    /** This origin. */
    origin: string;
  };
  /** Sends a reply. */
  postMessage: (message: FromTurnWorker) => void;
  /**
   * Receives requests.
   *
   * @param type     Always 'message'.
   * @param listener Called with each request.
   */
  addEventListener: (type: 'message', listener: (event: { data: ToTurnWorker }) => void) => void;
};

/**
 * Loads the runtime and the model.
 *
 * @returns A function that judges one stretch of audio.
 * @throws When a file cannot be fetched or the runtime cannot start.
 * Called from: model()
 */
async function load(): Promise<(audio: Float32Array) => Promise<number>> {
  const started = performance.now();
  const base = `${scope.location.origin}${PUNCT_RUNTIME_PATH}/`;
  scope.importScripts(`${base}${PUNCT_RUNTIME_FILES.loader.name}`);
  const ort = scope.ort;
  ort.env.wasm.wasmPaths = base;
  // One thread: the pages are not cross-origin isolated; one judgment takes tens of milliseconds.
  ort.env.wasm.numThreads = 1;
  const response = await fetch(`${TURN_PUBLIC_PATH}/${TURN_MODEL_FILE.name}`);
  if (!response.ok) throw new Error('end-of-turn model missing');
  const session = await ort.InferenceSession.create(new Uint8Array(await response.arrayBuffer()), {
    executionProviders: ['wasm'],
  });
  scope.postMessage({ type: 'loaded', ms: Math.round(performance.now() - started) });
  const output = session.outputNames[0]!;
  return async (audio) => {
    const features = turnFeatures(audio);
    const result = await session.run({
      [TURN_INPUT_NAME]: new ort.Tensor('float32', features, [1, N_MELS, N_FRAMES]),
    });
    // The model ends in a sigmoid: its one output is already the probability.
    return result[output]!.data[0] ?? 0;
  };
}

/** The model while it loads and afterwards; null until something asks for it. */
let loading: Promise<(audio: Float32Array) => Promise<number>> | null = null;

/**
 * Gets the model, loading it the first time. A failed load is told once, and every later request fails.
 *
 * @returns The judge function.
 * Called from: the message listener below
 */
function model(): Promise<(audio: Float32Array) => Promise<number>> {
  loading ??= load().catch((error: unknown) => {
    scope.postMessage({ type: 'failed' });
    throw error;
  });
  return loading;
}

scope.addEventListener('message', ({ data }) => {
  if (data.type === 'load') {
    model().catch(() => undefined);
    return;
  }
  const started = performance.now();
  model()
    .then((judge) => judge(data.audio))
    .then((probability) =>
      scope.postMessage({
        type: 'result',
        id: data.id,
        probability,
        ms: Math.round(performance.now() - started),
      }),
    )
    .catch(() => scope.postMessage({ type: 'request-failed', id: data.id }));
});
