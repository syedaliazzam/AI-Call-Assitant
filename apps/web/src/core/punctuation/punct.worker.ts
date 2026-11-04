/**
 * File: apps/web/src/core/punctuation/punct.worker.ts
 * Purpose: Web Worker that runs the offline punctuation model (v1.1.0, ADR-0044), so a slow line can
 *          never hold up the page or the speech engine. Loads ONNX Runtime and the model from our own
 *          origin once, then answers one line per message. It never logs text.
 * Used by: src/core/punctuation/punctuator.ts (new Worker(new URL('./punct.worker.ts', import.meta.url)))
 * Depends on: src/core/punctuation/model.ts, src/core/punctuation/restore.ts; the runtime files in
 *             public/punct/ (scripts/fetch-models.ts)
 * Architecture: docs/decisions/ADR-0044-transcript-auto-punctuation-cleanup.md
 *
 * A classic worker, like the speech worker: importScripts loads the runtime as a plain file, so the
 * bundler never tries to pack a 14 MB WebAssembly file.
 */
import {
  PUNCT_MODEL_FILES,
  PUNCT_PUBLIC_PATH,
  PUNCT_RUNTIME_FILES,
  PUNCT_RUNTIME_PATH,
} from './model';
import {
  parseVocab,
  punctuateWith,
  type ModelInput,
  type ModelOutput,
  type PieceTable,
} from './restore';

/** Messages to the worker. */
export type ToPunctWorker =
  | {
      /** Load the runtime and the model now, not at the first line. */
      type: 'load';
    }
  | {
      /** Punctuate one line. */
      type: 'punctuate';
      /** Matches the reply to the request. */
      id: number;
      /** The line. Never logged. */
      text: string;
    };

/** Messages from the worker. */
export type FromPunctWorker =
  | {
      /** The model is loaded. */
      type: 'loaded';
      /** How long it took, in ms. */
      ms: number;
    }
  | {
      /** One line is done. */
      type: 'result';
      /** The request's id. */
      id: number;
      /** The written line. Never logged. */
      text: string;
      /** How long it took, in ms. */
      ms: number;
    }
  | {
      /** Loading failed: no line can be done. */
      type: 'failed';
    }
  | {
      /** One line failed. */
      type: 'line-failed';
      /** The request's id. */
      id: number;
    };

/** An output tensor. */
interface OrtTensor {
  /** The values. */
  data: Float32Array;
  /** The shape. */
  dims: readonly number[];
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
  Tensor: new (type: 'int32', data: Int32Array, dims: number[]) => unknown;
  /** The model's session. */
  InferenceSession: {
    /** Loads a model. */
    create(
      model: Uint8Array,
      options: { executionProviders: string[] },
    ): Promise<{
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
  /** This origin. */
  location: { origin: string };
  /** Sends a reply. */
  postMessage: (message: FromPunctWorker) => void;
  /**
   * Receives requests.
   *
   * @param type     Always 'message'.
   * @param listener Called with each request.
   */
  addEventListener: (type: 'message', listener: (event: { data: ToPunctWorker }) => void) => void;
};

/**
 * The index of each row's largest value.
 *
 * @param tensor A tensor shaped [rows, columns].
 * @returns One index per row.
 * Called from: load()
 */
function bestOfEachRow(tensor: OrtTensor): number[] {
  const rows = tensor.dims[0] ?? 0;
  const columns = tensor.dims[1] ?? 1;
  const best: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    let top = 0;
    for (let column = 1; column < columns; column += 1) {
      if (tensor.data[row * columns + column]! > tensor.data[row * columns + top]!) top = column;
    }
    best.push(top);
  }
  return best;
}

/** What a loaded model can do. */
interface Loaded {
  /** The vocabulary. */
  table: PieceTable;
  /** Runs the model on one piece of a line. */
  run: (input: ModelInput) => Promise<ModelOutput>;
}

/**
 * Loads the runtime and the model.
 *
 * @returns The loaded model.
 * @throws When a file cannot be fetched or the runtime cannot start.
 * Called from: the message listener below
 */
async function load(): Promise<Loaded> {
  const started = performance.now();
  const base = `${scope.location.origin}${PUNCT_RUNTIME_PATH}/`;
  scope.importScripts(`${base}${PUNCT_RUNTIME_FILES.loader.name}`);
  const ort = scope.ort;
  ort.env.wasm.wasmPaths = base;
  // One thread: the pages are not cross-origin isolated, and a line takes milliseconds anyway.
  ort.env.wasm.numThreads = 1;
  const file = (name: string) => fetch(`${PUNCT_PUBLIC_PATH}/${name}`);
  const [modelResponse, vocabResponse] = await Promise.all([
    file(PUNCT_MODEL_FILES.model.name),
    file(PUNCT_MODEL_FILES.vocab.name),
  ]);
  if (!modelResponse.ok || !vocabResponse.ok) throw new Error('punctuation files missing');
  const table = parseVocab(await vocabResponse.text());
  const session = await ort.InferenceSession.create(
    new Uint8Array(await modelResponse.arrayBuffer()),
    { executionProviders: ['wasm'] },
  );
  scope.postMessage({ type: 'loaded', ms: Math.round(performance.now() - started) });
  return {
    table,
    run: async ({ tokens, valids, labelLength }) => {
      const shape = [1, tokens.length];
      const output = await session.run({
        token_ids: new ort.Tensor('int32', Int32Array.from(tokens), shape),
        valid_ids: new ort.Tensor('int32', Int32Array.from(valids), shape),
        label_lens: new ort.Tensor('int32', Int32Array.from([labelLength]), [1]),
      });
      return {
        puncts: bestOfEachRow(output.active_punct_logits!),
        cases: bestOfEachRow(output.active_case_logits!),
      };
    },
  };
}

/** The model while it loads and afterwards; null until something asks for it. */
let loading: Promise<Loaded> | null = null;

/**
 * Gets the model, loading it the first time. A failed load is told once, and every later line fails.
 *
 * @returns The loaded model.
 * Called from: the message listener below
 */
function model(): Promise<Loaded> {
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
    .then(({ table, run }) => punctuateWith(data.text, table, run))
    .then((text) =>
      scope.postMessage({
        type: 'result',
        id: data.id,
        text,
        ms: Math.round(performance.now() - started),
      }),
    )
    .catch(() => scope.postMessage({ type: 'line-failed', id: data.id }));
});
