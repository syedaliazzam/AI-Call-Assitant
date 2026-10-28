/**
 * File: apps/web/scripts/fetch-models.ts
 * Purpose: Downloads the speech-to-text files from their pinned official sources, checks every
 *          file against its SHA-256, and puts them where the web app serves them. Files that are
 *          already present with the right checksum are skipped. All URLs and checksums come from
 *          src/core/stt/models.ts (one source of truth with the browser download).
 *          Usage:
 *            pnpm --filter web fetch-models                 runtime + model + test recordings
 *                                                           (development, ~205 MB)
 *            pnpm --filter web fetch-models --runtime-only  runtime only (13.3 MB; run by the
 *                                                           build, on Vercel too)
 *            tsx scripts/fetch-models.ts --pins             print every pinned SHA-256 and
 *                                                           download nothing (the CI cache key)
 * Used by: developers (once per machine); the "fetch-models" and "stt:runtime" scripts in
 *          apps/web/package.json (stt:runtime runs before every `next build`); the
 *          stt-integration CI job (.github/workflows/ci.yml: --pins, then a full fetch);
 *          tests/integration/stt.spec.ts (isInstalled, sha256Of)
 * Depends on: src/core/stt/models.ts, src/core/stt/sentencepiece.ts; Node.js (fetch, crypto, fs);
 *             the system `tar` with bzip2 support to unpack the .tar.bz2 release archive (Node
 *             has no bzip2). Windows 10+ and macOS include it; Vercel's build image (Amazon Linux
 *             2023) lists tar, bsdtar and bzip2 as pre-installed (checked 2026-10-27).
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt), §10; ADR-0020
 *
 * Where files go:
 * - runtime → apps/web/public/stt-runtime/v1.13.7/ (served from our origin in every environment);
 * - model and test recordings → apps/web/public/models/stt/ (used when the source is `local`, as
 *   in `pnpm dev`; production loads model files from Hugging Face). Both folders are git-ignored.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BPE_VOCAB_SHA256,
  LOCAL_MODELS_PATH,
  RUNTIME_ARCHIVE,
  RUNTIME_FILES,
  RUNTIME_PUBLIC_PATH,
  STT_MODELS,
  TEST_RECORDINGS,
  TEST_RECORDINGS_DIR,
  type PinnedFile,
} from '../src/core/stt/models';
import { sentencePieceVocab } from '../src/core/stt/sentencepiece';

/** apps/web/public (Next.js serves it at the site root). */
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** apps/web/public/stt-runtime/v1.13.7. */
export const RUNTIME_DIR = path.join(PUBLIC_DIR, ...RUNTIME_PUBLIC_PATH.split('/').filter(Boolean));

/** apps/web/public/models/stt. */
const MODELS_DIR = path.join(PUBLIC_DIR, ...LOCAL_MODELS_PATH.split('/').filter(Boolean));

/**
 * Computes a file's SHA-256 without loading it all into memory.
 *
 * @param file Path to the file.
 * @returns The hex digest.
 */
export async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Tells whether a file already exists with the expected size and checksum.
 *
 * @param file   Path to check.
 * @param pinned Expected size and checksum.
 * @returns True if present and correct.
 */
export async function isInstalled(
  file: string,
  pinned: Pick<PinnedFile, 'bytes' | 'sha256'>,
): Promise<boolean> {
  if (!existsSync(file) || statSync(file).size !== pinned.bytes) return false;
  return (await sha256Of(file)) === pinned.sha256;
}

/**
 * Downloads a URL to a file and verifies its SHA-256.
 *
 * @param url    Source URL (official, pinned).
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
 * Installs the three runtime files from the pinned release archive (download, verify the
 * archive, unpack only those files, verify each).
 *
 * @throws Error on download, unpack or checksum failure.
 */
async function installRuntime(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const files = Object.values(RUNTIME_FILES);
  const missing: PinnedFile[] = [];
  for (const file of files) {
    if (!(await isInstalled(path.join(RUNTIME_DIR, file.name), file))) missing.push(file);
  }
  console.log(
    `runtime ${RUNTIME_PUBLIC_PATH}: ${files.length - missing.length}/${files.length} files present`,
  );
  if (missing.length === 0) return;

  const work = mkdtempSync(path.join(tmpdir(), 'kite-fetch-models-'));
  try {
    const archive = path.join(work, 'runtime.tar.bz2');
    console.log(
      `  release archive: ${(RUNTIME_ARCHIVE.bytes / 1e6).toFixed(0)} MB (only 13 MB of it is kept)`,
    );
    await download(RUNTIME_ARCHIVE.url, archive, RUNTIME_ARCHIVE.sha256);
    // Extract only the files we need. tar runs inside the temporary folder with a relative
    // archive name: GNU tar (for example Git Bash's) reads "C:\…" as a remote "host:path".
    const entries = missing.map((file) => `${RUNTIME_ARCHIVE.folder}/${file.name}`);
    const result = spawnSync(tarCommand(), ['-xjf', path.basename(archive), ...entries], {
      cwd: work,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error('tar failed to unpack the runtime archive (needs tar with bzip2 support)');
    }
    for (const file of missing) {
      const target = path.join(RUNTIME_DIR, file.name);
      await copyFile(path.join(work, RUNTIME_ARCHIVE.folder, file.name), target);
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
 * Installs pinned files into a folder (skipping correct ones).
 *
 * @param label  Name printed while installing.
 * @param dir    Destination folder.
 * @param files  The files.
 */
async function installFiles(
  label: string,
  dir: string,
  files: readonly PinnedFile[],
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  let present = 0;
  for (const file of files) {
    const target = path.join(dir, file.name);
    if (await isInstalled(target, file)) {
      present += 1;
      continue;
    }
    await download(file.url, target, file.sha256);
    console.log(`  installed ${file.name} (${(file.bytes / 1e6).toFixed(1)} MB)`);
  }
  console.log(`${label}: ${present}/${files.length} files were already present`);
}

/**
 * Checks that bpe.model turns into the pinned bpe.vocab (the same check the browser makes).
 *
 * @param bpeModelPath Path to the installed bpe.model.
 * @throws Error if the derived vocabulary does not match BPE_VOCAB_SHA256.
 */
async function checkBpeVocab(bpeModelPath: string): Promise<void> {
  const vocab = sentencePieceVocab(await readFile(bpeModelPath));
  const actual = createHash('sha256').update(vocab, 'utf8').digest('hex');
  if (actual !== BPE_VOCAB_SHA256) {
    throw new Error(`bpe.vocab derived from bpe.model does not match its pin (got ${actual})`);
  }
  console.log('hotword vocabulary: bpe.model → bpe.vocab matches its pinned SHA-256');
}

/** Points at Day 1 folders that are no longer used (they are only deleted by the developer). */
function reportStaleFolders(): void {
  const stale = ['runtime-v1.13.7', 'zipformer-en-2023-06-26'].filter((name) =>
    existsSync(path.join(MODELS_DIR, name)),
  );
  for (const name of stale) {
    console.log(
      `  note: public/models/stt/${name} is from Day 1 and no longer used; you can delete it`,
    );
  }
}

/**
 * Every pinned file the full fetch installs, one "<sha256>  <name>" line each, in a fixed order.
 * A change to any pin changes this text, so CI uses its hash as the cache key (a cache from old
 * pins is never reused).
 *
 * @returns The lines, joined with newlines.
 * Called from: main() with --pins
 */
export function pinList(): string {
  const lines = [
    `${RUNTIME_ARCHIVE.sha256}  runtime archive ${RUNTIME_ARCHIVE.folder}`,
    ...Object.values(RUNTIME_FILES).map((file) => `${file.sha256}  runtime ${file.name}`),
    ...STT_MODELS.flatMap((model) =>
      Object.values(model.files).map((file) => `${file.sha256}  ${model.id} ${file.name}`),
    ),
    `${BPE_VOCAB_SHA256}  bpe.vocab (derived from bpe.model)`,
    ...TEST_RECORDINGS.map((file) => `${file.sha256}  test recording ${file.name}`),
  ];
  return lines.join('\n');
}

/**
 * Entry point: the runtime always; the models and test recordings unless --runtime-only.
 * With --pins it only prints pinList().
 */
async function main(): Promise<void> {
  if (process.argv.includes('--pins')) {
    console.log(pinList());
    return;
  }
  const runtimeOnly = process.argv.includes('--runtime-only');
  console.log(`Installing speech-to-text files${runtimeOnly ? ' (runtime only)' : ''}`);
  await installRuntime();
  if (!runtimeOnly) {
    for (const model of STT_MODELS) {
      const dir = path.join(MODELS_DIR, model.id);
      await installFiles(model.label, dir, Object.values(model.files));
      await checkBpeVocab(path.join(dir, model.files.bpeModel.name));
    }
    await installFiles(
      'test recordings',
      path.join(MODELS_DIR, TEST_RECORDINGS_DIR),
      TEST_RECORDINGS,
    );
    reportStaleFolders();
  }
  console.log('Done.');
}

// Run only when executed directly (check-stt-runtime.ts imports the helpers above).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
