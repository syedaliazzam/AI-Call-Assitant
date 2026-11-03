/**
 * File: apps/desktop/src/accurate/model.ts
 * Purpose: The accurate-transcription model (ADR-0034): NVIDIA Parakeet TDT 0.6B v2, int8, as
 *          published for sherpa-onnx. Each file is downloaded from one fixed revision of its
 *          Hugging Face repository and checked against the SHA-256 below (Hugging Face's own LFS
 *          hashes, which match the files measured in the ADR-0027 trial; tokens.txt hashed here).
 * Used by: src/accurate/host.ts (download, paths), src/accurate/worker.ts (paths); tests
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md
 */

/** The repository revision every file is downloaded from (never a moving branch). */
export const MODEL_REVISION = '1ab9323565ddb038682214b292f588070a538ce2';

/** Where the files are downloaded from. */
const BASE_URL = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/${MODEL_REVISION}`;

/** The folder name of the model, under the app's data folder ("models/<this>"). */
export const MODEL_FOLDER = 'parakeet-tdt-0.6b-v2-int8';

/** One model file. */
export interface ModelFile {
  /** File name in the model folder. */
  name: string;
  /** Download address (a fixed revision). */
  url: string;
  /** Size in bytes. */
  size: number;
  /** SHA-256, lower-case hex. */
  sha256: string;
}

/** The model's files: the transducer's three networks and its token list. */
export const MODEL_FILES: readonly ModelFile[] = [
  {
    name: 'tokens.txt',
    url: `${BASE_URL}/tokens.txt`,
    size: 9_384,
    sha256: 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d',
  },
  {
    name: 'joiner.int8.onnx',
    url: `${BASE_URL}/joiner.int8.onnx`,
    size: 1_739_080,
    sha256: '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2',
  },
  {
    name: 'decoder.int8.onnx',
    url: `${BASE_URL}/decoder.int8.onnx`,
    size: 7_257_753,
    sha256: 'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e',
  },
  {
    name: 'encoder.int8.onnx',
    url: `${BASE_URL}/encoder.int8.onnx`,
    size: 652_184_296,
    sha256: 'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab',
  },
];

/** The whole model's size in bytes (about 661 MB). */
export const MODEL_BYTES = MODEL_FILES.reduce((sum, file) => sum + file.size, 0);
