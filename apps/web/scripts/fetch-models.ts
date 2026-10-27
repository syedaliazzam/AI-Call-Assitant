/**
 * File: apps/web/scripts/fetch-models.ts
 * Purpose: Downloads the speech-to-text files for the Day 1 spike (ADR-0020) from official
 *          sherpa-onnx sources only, checks every file against a pinned SHA-256, and puts them
 *          in apps/web/public/models/stt/ (git-ignored and Vercel-ignored). Files that are
 *          already present with the right checksum are skipped.
 *          Usage: pnpm --filter web fetch-models   (runtime + both models, about 280 MB)
 * Used by: developers (once per machine); the "fetch-models" script in apps/web/package.json
 * Depends on: Node.js (fetch, crypto, fs), scripts/sentencepiece-vocab.ts, and the system `tar`
 *             (Windows 10+, macOS and Linux include it) to unpack the .tar.bz2 release archive
 *             (Node has no bzip2 support)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt); ADR-0020
 *
 * Sources (pinned):
 * - Runtime: GitHub release k2-fsa/sherpa-onnx v1.13.7, the official English streaming ASR
 *   WebAssembly bundle. v1.13.7 is the LAST release with official ASR WebAssembly builds.
 *   Only its loader, WebAssembly binary and JS API are used; its baked-in model package (.data)
 *   is not installed, because the chosen model's files are loaded separately (stt.worker.ts).
 * - Chosen model, 2023-06-21: Hugging Face csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21
 *   at commit 9a65b6ea94c311ca770c2bf895b30f456a22d703: the same files as in the official
 *   bundle (int8 encoder, fp32 decoder and joiner). Apache-2.0.
 * - Comparison model, 2023-06-26: Hugging Face csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26
 *   at commit 672fbf1b30579d6585301139bb363f42a0ad4a24. Apache-2.0.
 *   Both are the sherpa-onnx maintainer's model repositories, linked from the sherpa-onnx docs.
 * - Tokenizer for hotwords: bpe.model from the 2023-06-26 repository (same commit; the upstream
 *   icefall repository of the 2023-06-21 model has the identical file). Both models use this
 *   LibriSpeech BPE-500 tokenizer (their tokens.txt files are identical). It is turned into
 *   bpe.vocab the way sherpa-onnx's scripts/export_bpe_vocab.py does, and the result is checked
 *   against a pinned SHA-256 too.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sentencePieceVocab } from './sentencepiece-vocab';

/** apps/web/public/models/stt (where the browser fetches /models/stt/... from). */
const OUTPUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'models',
  'stt',
);

/** One file to install, with its pinned checksum. */
interface PinnedFile {
  /** File name in the source (archive entry or URL path) and in the output folder. */
  name: string;
  /** Expected SHA-256 (hex). */
  sha256: string;
  /** Expected size in bytes (printed, and a quick sanity check). */
  bytes: number;
}

/** The official sherpa-onnx v1.13.7 English streaming ASR WebAssembly bundle. */
const RUNTIME = {
  version: 'v1.13.7',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer.tar.bz2',
  archiveSha256: '21559527d65f7674a45834870e4f51b0af14be27d4de1043aa6f576d9b426acc',
  archiveFolder: 'sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer',
  outputFolder: 'runtime-v1.13.7',
  files: [
    {
      name: 'sherpa-onnx-wasm-main-asr.js',
      sha256: 'fd9e40cb7f871a94132fd722bde8a18aeb41a7e8cb95eee81a55b510e621c20a',
      bytes: 82_688,
    },
    {
      name: 'sherpa-onnx-wasm-main-asr.wasm',
      sha256: 'd0c15c3042fd61ca2a158a1eeb8b8c2099201f7580945efc8f729d2830cf746d',
      bytes: 13_150_239,
    },
    {
      name: 'sherpa-onnx-asr.js',
      sha256: 'd51ae8e8b756ee5e53423ffada0c9702973f154f561aca7984fe0b12f4060178',
      bytes: 53_867,
    },
  ] satisfies PinnedFile[],
  /** The bundle's baked-in model package: no longer installed (see the header). */
  unusedBundledData: 'sherpa-onnx-wasm-main-asr.data',
};

/** One model repository at a pinned commit. */
interface PinnedModel {
  /** Name printed while installing. */
  label: string;
  /** Hugging Face "resolve" URL at the pinned commit. */
  baseUrl: string;
  /** Output folder under OUTPUT_DIR (the SttModelId in src/core/stt/models.ts). */
  outputFolder: string;
  /** Files to download. */
  files: PinnedFile[];
}

/** Chosen model: streaming Zipformer English 2023-06-21 (LibriSpeech + GigaSpeech). */
const MODEL_2023_06_21: PinnedModel = {
  label: 'model 2023-06-21',
  baseUrl:
    'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21/resolve/9a65b6ea94c311ca770c2bf895b30f456a22d703',
  outputFolder: 'zipformer-en-2023-06-21',
  files: [
    {
      name: 'encoder-epoch-99-avg-1.int8.onnx',
      sha256: '32c98281c7bd8b63e3e142d007251b37f120572e8fdea9a4f5a79ce22b10ec4f',
      bytes: 187_823_992,
    },
    {
      name: 'decoder-epoch-99-avg-1.onnx',
      sha256: '9da02b77cb08826756ec6a88635f35a40374e4164e7c6359121a9145958a6ceb',
      bytes: 2_092_566,
    },
    {
      name: 'joiner-epoch-99-avg-1.onnx',
      sha256: 'bd5c26ad6a41cbd90c2cfa239c0b55b145af878ce1d79b4739d90f8be93359ba',
      bytes: 1_026_405,
    },
    {
      name: 'tokens.txt',
      sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb',
      bytes: 5_048,
    },
  ],
};

/** Comparison model: streaming Zipformer English 2023-06-26, chunk 16, left context 128. */
const MODEL_2023_06_26: PinnedModel = {
  label: 'model 2023-06-26',
  baseUrl:
    'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/672fbf1b30579d6585301139bb363f42a0ad4a24',
  outputFolder: 'zipformer-en-2023-06-26',
  files: [
    {
      name: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
      sha256: '563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1',
      bytes: 71_083_163,
    },
    {
      name: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
      sha256: '7bf787f90b194b307e5a4ad6a34fadb4e748304c35f78a8d66358a05b13ee6ef',
      bytes: 2_092_621,
    },
    {
      name: 'joiner-epoch-99-avg-1-chunk-16-left-128.onnx',
      sha256: '210591f72b3c56b8364f85f345dca240bc2b4c00632848f4aa923630d5639d3b',
      bytes: 1_026_405,
    },
    {
      name: 'tokens.txt',
      sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb',
      bytes: 5_048,
    },
  ],
};

/** The hotword tokenizer: official bpe.model in, derived bpe.vocab out (pinned both ways). */
const BPE = {
  url: `${MODEL_2023_06_26.baseUrl}/bpe.model`,
  model: {
    name: 'bpe.model',
    sha256: 'c53433de083c4a6ad12d034550ef22de68cec62c4f58932a7b6b8b2f1e743fa5',
    bytes: 244_865,
  } satisfies PinnedFile,
  vocab: {
    name: 'bpe.vocab',
    sha256: 'f191a4935f668fa8cd8e607bcd378404f948321cd3134a5ea13d324ba921673d',
    bytes: 12_590,
  } satisfies PinnedFile,
};

/**
 * Computes a file's SHA-256 without loading it all into memory.
 *
 * @param file Path to the file.
 * @returns The hex digest.
 */
async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Tells whether a file already exists with the expected checksum.
 *
 * @param file   Path to check.
 * @param pinned Expected size and checksum.
 * @returns True if present and correct.
 */
async function isInstalled(file: string, pinned: PinnedFile): Promise<boolean> {
  if (!existsSync(file) || statSync(file).size !== pinned.bytes) return false;
  return (await sha256Of(file)) === pinned.sha256;
}

/**
 * Downloads a URL to a file and verifies its SHA-256.
 *
 * @param url    Source URL (official sources only).
 * @param file   Destination path.
 * @param sha256 Expected checksum.
 * @throws Error on HTTP failure or checksum mismatch (the bad file is deleted).
 */
async function download(url: string, file: string, sha256: string): Promise<void> {
  console.log(`  downloading ${path.basename(file)} …`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  const actual = await sha256Of(file);
  if (actual !== sha256) {
    rmSync(file, { force: true });
    throw new Error(
      `Checksum mismatch for ${path.basename(file)}: expected ${sha256}, got ${actual}`,
    );
  }
}

/**
 * Picks the tar program. On Windows the built-in one (System32\tar.exe, bsdtar, reads bzip2
 * itself) is preferred over others on the PATH; elsewhere the system `tar` is used.
 *
 * @returns Command name or full path.
 */
function tarCommand(): string {
  if (process.platform === 'win32') {
    const systemTar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(systemTar)) return systemTar;
  }
  return 'tar';
}

/**
 * Installs the runtime files from the release archive.
 */
async function installRuntime(): Promise<void> {
  const outDir = path.join(OUTPUT_DIR, RUNTIME.outputFolder);
  mkdirSync(outDir, { recursive: true });
  if (existsSync(path.join(outDir, RUNTIME.unusedBundledData))) {
    console.log(
      `  note: ${RUNTIME.unusedBundledData} (191 MB) is no longer used; you can delete it`,
    );
  }

  const missing: PinnedFile[] = [];
  for (const file of RUNTIME.files) {
    if (!(await isInstalled(path.join(outDir, file.name), file))) missing.push(file);
  }
  console.log(
    `runtime ${RUNTIME.version}: ${RUNTIME.files.length - missing.length}/${RUNTIME.files.length} files present`,
  );
  if (missing.length === 0) return;

  // Download the archive into a fresh temporary folder, verify it, unpack it there.
  const work = mkdtempSync(path.join(tmpdir(), 'kite-fetch-models-'));
  try {
    const archive = path.join(work, 'runtime.tar.bz2');
    await download(RUNTIME.url, archive, RUNTIME.archiveSha256);
    // Extract only the files we need. tar runs inside the temporary folder with a relative
    // archive name: GNU tar (for example Git Bash's) reads "C:\…" as a remote "host:path".
    const entries = missing.map((file) => `${RUNTIME.archiveFolder}/${file.name}`);
    const result = spawnSync(tarCommand(), ['-xjf', path.basename(archive), ...entries], {
      cwd: work,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('tar failed to unpack the runtime archive');
    for (const file of missing) {
      const source = path.join(work, RUNTIME.archiveFolder, file.name);
      const target = path.join(outDir, file.name);
      await copyFile(source, target);
      if (!(await isInstalled(target, file))) {
        rmSync(target, { force: true });
        throw new Error(`Checksum mismatch for ${file.name} after unpacking`);
      }
      console.log(`  installed ${file.name} (${(file.bytes / 1e6).toFixed(1)} MB)`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Installs one model's files from Hugging Face (pinned commit).
 *
 * @param model The pinned model.
 */
async function installModel(model: PinnedModel): Promise<void> {
  const outDir = path.join(OUTPUT_DIR, model.outputFolder);
  mkdirSync(outDir, { recursive: true });
  let present = 0;
  for (const file of model.files) {
    const target = path.join(outDir, file.name);
    if (await isInstalled(target, file)) {
      present += 1;
      continue;
    }
    await download(`${model.baseUrl}/${file.name}`, target, file.sha256);
    console.log(`  installed ${file.name} (${(file.bytes / 1e6).toFixed(1)} MB)`);
  }
  console.log(`${model.label}: ${present}/${model.files.length} files were already present`);
}

/**
 * Downloads the official bpe.model (into a temporary folder), turns it into bpe.vocab, checks
 * the result against its pinned SHA-256, and puts a copy in each model folder.
 *
 * @param models The models that use this tokenizer.
 * @throws Error on a download or checksum failure.
 */
async function installBpeVocab(models: PinnedModel[]): Promise<void> {
  const targets = models.map((model) => path.join(OUTPUT_DIR, model.outputFolder, BPE.vocab.name));
  const missing: string[] = [];
  for (const target of targets) {
    if (!(await isInstalled(target, BPE.vocab))) missing.push(target);
  }
  console.log(`hotword tokenizer: ${targets.length - missing.length}/${targets.length} present`);
  if (missing.length === 0) return;

  const work = mkdtempSync(path.join(tmpdir(), 'kite-fetch-models-'));
  try {
    const modelFile = path.join(work, BPE.model.name);
    await download(BPE.url, modelFile, BPE.model.sha256);
    const vocab = Buffer.from(sentencePieceVocab(await readFile(modelFile)), 'utf8');
    const actual = createHash('sha256').update(vocab).digest('hex');
    if (actual !== BPE.vocab.sha256) {
      throw new Error(`bpe.vocab checksum mismatch: expected ${BPE.vocab.sha256}, got ${actual}`);
    }
    for (const target of missing) {
      await writeFile(target, vocab);
      console.log(`  installed ${path.relative(OUTPUT_DIR, target)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Entry point: installs the runtime, both models and the hotword tokenizer.
 */
async function main(): Promise<void> {
  console.log(`Installing speech-to-text files into ${OUTPUT_DIR}`);
  await installRuntime();
  const models = [MODEL_2023_06_21, MODEL_2023_06_26];
  for (const model of models) await installModel(model);
  await installBpeVocab(models);
  console.log('Done.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
