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
 *             has no bzip2). Windows 10+ and macOS include it (bsdtar); Linux (GitHub's
 *             ubuntu-latest, Vercel's Amazon Linux 2023 build image) uses GNU tar.
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt), §10; ADR-0020
 *
 * Where files go:
 * - runtime → apps/web/public/stt-runtime/v1.13.7/ (served from our origin in every environment);
 * - punctuation (v1.1.0, ADR-0044) → apps/web/public/punct/ (the same, always installed);
 * - the echo canceller (1.5.2, ADR-0070) → apps/web/public/aec/, copied from the pinned npm package
 *   @ennuicastr/webrtcaec3.js (no download) and checked like the rest;
 * - model and test recordings → apps/web/public/models/stt/ (used when the source is `local`, as
 *   in `pnpm dev`; production loads model files from Hugging Face). Both folders are git-ignored.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
  AEC_FILES,
  AEC_PUBLIC_PATH,
} from '../src/core/stt/models';
import { sentencePieceVocab } from '../src/core/stt/sentencepiece';
import {
  PUNCT_ARCHIVE,
  PUNCT_MODEL_FILES,
  PUNCT_PUBLIC_PATH,
  PUNCT_RUNTIME_FILES,
  PUNCT_RUNTIME_PATH,
} from '../src/core/punctuation/model';
import { TURN_MODEL_FILE, TURN_PUBLIC_PATH } from '../src/core/turn/model';

/** apps/web/public (Next.js serves it at the site root). */
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** apps/web/public/stt-runtime/v1.13.7. */
export const RUNTIME_DIR = path.join(PUBLIC_DIR, ...RUNTIME_PUBLIC_PATH.split('/').filter(Boolean));

/** apps/web/public/turn (v1.4, ADR-0065: the end-of-turn model). */
export const TURN_DIR = path.join(PUBLIC_DIR, ...TURN_PUBLIC_PATH.split('/').filter(Boolean));

/** apps/web/public/punct. */
export const PUNCT_DIR = path.join(PUBLIC_DIR, ...PUNCT_PUBLIC_PATH.split('/').filter(Boolean));

/** apps/web/public/punct/runtime-<version>. */
export const PUNCT_RUNTIME_DIR = path.join(
  PUBLIC_DIR,
  ...PUNCT_RUNTIME_PATH.split('/').filter(Boolean),
);

/** apps/web/public/models/stt. */
const MODELS_DIR = path.join(PUBLIC_DIR, ...LOCAL_MODELS_PATH.split('/').filter(Boolean));

/**
 * Computes a file's SHA-256 without loading it all into memory.
 *
 * @param file Path to the file.
 * @returns The hex digest.
 * Called from: isInstalled(), download(); tests/integration/stt.spec.ts (fixture check)
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
 * Called from: installRuntime(), installFiles(); scripts/check-stt-runtime.ts;
 *              tests/integration/stt.spec.ts (checks the files before the test)
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
 * Removes leading "./" segments from an archive member name ("./a/b" → "a/b").
 *
 * @param member A name as `tar -t` prints it.
 * @returns The name without the "./" prefix.
 * Called from: findArchiveMembers(); tests
 */
export function normalizeMember(member: string): string {
  let name = member.trim();
  while (name.startsWith('./')) name = name.slice(2);
  return name;
}

/**
 * Finds the exact archive member names of the files to unpack, from `tar -t`'s listing.
 *
 * Why: tar programs disagree on member names. The v1.13.7 runtime archive stores its files as
 * "./<folder>/<file>". bsdtar (Windows, macOS) matches "<folder>/<file>" against that, but GNU tar
 * (Linux: CI and Vercel builds) does not ("Not found in archive"). So the names are taken
 * verbatim from the listing, and every tar is given the exact names it printed.
 *
 * Match order per file: "<folder>/<file>" after removing "./"; otherwise exactly one member with
 * that file name anywhere in the archive (in case the release changes its folder layout).
 *
 * @param listing Lines of `tar -t` output.
 * @param folder  Expected top-level folder (RUNTIME_ARCHIVE.folder).
 * @param names   File names to find.
 * @returns found: file name → member name as listed; missing: names not found (or found more
 *          than once without the expected folder).
 * Called from: extractRuntimeFiles(); tests
 */
export function findArchiveMembers(
  listing: readonly string[],
  folder: string,
  names: readonly string[],
): { found: Map<string, string>; missing: string[] } {
  const members = listing.map((line) => line.trim()).filter((line) => line && !line.endsWith('/'));
  const found = new Map<string, string>();
  const missing: string[] = [];
  for (const name of names) {
    const exact = members.find((member) => normalizeMember(member) === `${folder}/${name}`);
    const byName = members.filter((member) => normalizeMember(member).split('/').pop() === name);
    const member = exact ?? (byName.length === 1 ? byName[0] : undefined);
    if (member) found.set(name, member);
    else missing.push(name);
  }
  return { found, missing };
}

/**
 * Lists the archive and unpacks only the given files into a folder.
 *
 * @param archive Path to the downloaded (already verified) .tar.bz2.
 * @param names   File names to unpack.
 * @param tar     tar program (default: tarCommand(); a check script passes GNU tar on Windows).
 * @param folder  The archive's top-level folder (default: the speech runtime's).
 * @returns file name → path of the unpacked file.
 * @throws Error if tar cannot read the archive, a file is not in it (the message names the
 *         missing files and shows the first entries of the listing), or unpacking fails.
 * Called from: installRuntime(), installPunctuation()
 */
export function extractRuntimeFiles(
  archive: string,
  names: readonly string[],
  tar: string = tarCommand(),
  folder: string = RUNTIME_ARCHIVE.folder,
): Map<string, string> {
  const work = path.dirname(archive);
  // tar runs inside the archive's folder with a relative archive name: GNU tar (for example
  // Git Bash's) reads "C:\…" as a remote "host:path".
  const list = spawnSync(tar, ['-tjf', path.basename(archive)], {
    cwd: work,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (list.status !== 0) {
    throw new Error(
      `tar could not list the runtime archive (exit ${list.status}; it needs bzip2 support): ${list.stderr.trim()}`,
    );
  }
  const listing = list.stdout.split(/\r?\n/).filter(Boolean);
  const { found, missing } = findArchiveMembers(listing, folder, names);
  if (missing.length > 0) {
    throw new Error(
      `The runtime archive does not contain ${missing.join(', ')} (expected under ` +
        `${folder}/). First entries of the archive:\n  ` +
        listing.slice(0, 10).join('\n  '),
    );
  }
  const members = [...found.values()];
  const result = spawnSync(tar, ['-xjf', path.basename(archive), ...members], {
    cwd: work,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`tar failed to unpack ${members.join(', ')} (exit ${result.status})`);
  }
  return new Map([...found].map(([name, member]) => [name, path.join(work, member)]));
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
    const unpacked = extractRuntimeFiles(
      archive,
      missing.map((file) => file.name),
    );
    for (const file of missing) {
      const target = path.join(RUNTIME_DIR, file.name);
      await copyFile(unpacked.get(file.name)!, target);
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
    `${PUNCT_ARCHIVE.sha256}  punctuation archive ${PUNCT_ARCHIVE.folder}`,
    ...Object.values(PUNCT_RUNTIME_FILES).map((file) => `${file.sha256}  punctuation ${file.name}`),
    ...Object.values(PUNCT_MODEL_FILES).map((file) => `${file.sha256}  punctuation ${file.name}`),
    `${TURN_MODEL_FILE.sha256}  end-of-turn ${TURN_MODEL_FILE.name}`,
    ...TEST_RECORDINGS.map((file) => `${file.sha256}  test recording ${file.name}`),
  ];
  return lines.join('\n');
}

/**
 * Installs the punctuation files (v1.1.0, ADR-0044): the runtime as it is, and the model's two files
 * unpacked from their release archive.
 *
 * @throws Error on a failed download, a wrong checksum or an archive that cannot be read.
 * Called from: main()
 */
async function installPunctuation(): Promise<void> {
  await installFiles('punctuation runtime', PUNCT_RUNTIME_DIR, Object.values(PUNCT_RUNTIME_FILES));
  mkdirSync(PUNCT_DIR, { recursive: true });
  const files = Object.values(PUNCT_MODEL_FILES);
  const missing: PinnedFile[] = [];
  for (const file of files) {
    if (!(await isInstalled(path.join(PUNCT_DIR, file.name), file))) missing.push(file);
  }
  console.log(`punctuation model: ${files.length - missing.length}/${files.length} files present`);
  if (missing.length === 0) return;
  const work = mkdtempSync(path.join(tmpdir(), 'kite-fetch-models-'));
  try {
    const archive = path.join(work, 'punct.tar.bz2');
    await download(PUNCT_ARCHIVE.url, archive, PUNCT_ARCHIVE.sha256);
    const unpacked = extractRuntimeFiles(
      archive,
      missing.map((file) => file.name),
      undefined,
      PUNCT_ARCHIVE.folder,
    );
    for (const file of missing) {
      const target = path.join(PUNCT_DIR, file.name);
      await copyFile(unpacked.get(file.name)!, target);
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

/** 1.5.2 (ADR-0070): apps/web/public/aec, the echo canceller's folder. */
export const AEC_DIR = path.join(PUBLIC_DIR, ...AEC_PUBLIC_PATH.split('/').filter(Boolean));

/**
 * 1.5.2 (ADR-0070): copies the echo canceller (WebRTC AEC3 in WebAssembly) from its npm package into
 * public/aec and checks each file against its pinned SHA-256 (models.ts AEC_FILES).
 *
 * @throws Error when the package is missing or a file does not match its checksum.
 * Called from: main()
 */
async function installEchoCanceller(): Promise<void> {
  mkdirSync(AEC_DIR, { recursive: true });
  const require = createRequire(import.meta.url);
  const packageDir = path.dirname(require.resolve('@ennuicastr/webrtcaec3.js/package.json'));
  for (const file of Object.values(AEC_FILES)) {
    const target = path.join(AEC_DIR, file.name);
    if (await isInstalled(target, file)) continue;
    await copyFile(path.join(packageDir, 'dist', file.name), target);
    const digest = await sha256Of(target);
    if (digest !== file.sha256) {
      rmSync(target, { force: true });
      throw new Error(`${file.name}: SHA-256 ${digest} is not the pinned ${file.sha256}`);
    }
  }
  console.log('  echo canceller: ok');
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
  await installPunctuation();
  // v1.4 (ADR-0065): the end-of-turn model, served from our own origin like the punctuation model.
  await installFiles('end-of-turn model', TURN_DIR, [TURN_MODEL_FILE]);
  await installEchoCanceller();
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
