/**
 * File: apps/desktop/scripts/stage-stt-model.mjs
 * Purpose: Stages the streaming speech model (about 204 MB: the sherpa-onnx engine files and the
 *          Zipformer model) into native/stt-model/ with a manifest of every file's address, size and
 *          SHA-256, for the installer to ship (electron-builder extraResources → resources/stt-model).
 *          The list comes from the web app's single source of truth, apps/web/src/core/stt/models.ts
 *          (bundled with esbuild so this script reads the same pinned values). A file is taken from a
 *          local copy when one matches its SHA-256 (the web app's fetch-models folders, or an earlier
 *          staging), otherwise downloaded from its pinned address; every file is checked before it is
 *          staged, and a mismatch stops the build.
 * Used by: the "dist:win", "dist:mac" and "dist:store" scripts in apps/desktop/package.json;
 *          "stage:model" for development
 * Depends on: Node's crypto, fs, os, path and fetch; esbuild (already a dev dependency)
 * Architecture: docs/decisions/ADR-0059-speech-model-in-the-desktop-installer.md; ADR-0020
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.resolve(desktopDir, '..', 'web');
const target = path.join(desktopDir, 'native', 'stt-model');

/** Where the engine files are published (the app's own origin); only used to download them. */
const RUNTIME_SOURCE_ORIGIN = 'https://kite-call-assistant.vercel.app';

/**
 * Loads apps/web/src/core/stt/models.ts (plain TypeScript with no imports) as a module.
 *
 * @returns The module's exports.
 */
async function loadModels() {
  const out = path.join(tmpdir(), `kite-models-${process.pid}.mjs`);
  buildSync({
    entryPoints: [path.join(webDir, 'src', 'core', 'stt', 'models.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: out,
    logLevel: 'error',
  });
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(out, { force: true });
  }
}

/**
 * SHA-256 of a file, streamed.
 *
 * @param file The path.
 * @returns Lower-case hex, or null when the file does not exist.
 */
function sha256(file) {
  if (!existsSync(file)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const models = await loadModels();
const model = models.getSttModel(models.DEFAULT_STT_MODEL);
const runtimePath = models.RUNTIME_PUBLIC_PATH;

/** Every file the web app's engine loads: the address it fetches, and where a local copy may be. */
const files = [
  ...Object.values(models.RUNTIME_FILES).map((file) => ({
    ...file,
    path: `${runtimePath}/${file.name}`,
    download: `${RUNTIME_SOURCE_ORIGIN}${runtimePath}/${file.name}`,
    local: [
      path.join(webDir, 'public', runtimePath.slice(1), file.name),
      path.join(webDir, 'public', 'models', 'stt', model.id, file.name),
    ],
  })),
  ...Object.values(model.files).map((file) => ({
    ...file,
    download: file.url,
    local: [path.join(webDir, 'public', 'models', 'stt', model.id, file.name)],
  })),
];

mkdirSync(target, { recursive: true });
let downloaded = 0;
for (const file of files) {
  const staged = path.join(target, file.name);
  if ((await sha256(staged)) === file.sha256) continue;
  const local = [];
  for (const candidate of file.local) {
    if ((await sha256(candidate)) === file.sha256) local.push(candidate);
  }
  if (local.length > 0) {
    copyFileSync(local[0], staged);
  } else {
    const response = await fetch(file.download);
    if (!response.ok) throw new Error(`stage-stt-model: ${file.name}: HTTP ${response.status}`);
    writeFileSync(staged, Buffer.from(await response.arrayBuffer()));
    downloaded += file.bytes;
  }
  if ((await sha256(staged)) !== file.sha256) {
    rmSync(staged, { force: true });
    throw new Error(`stage-stt-model: ${file.name} does not match its pinned SHA-256`);
  }
}

// The manifest the shell reads (src/speechModel.ts): the model files keep their pinned absolute
// address; the engine files are listed by path, because the app's origin is the shell's setting.
const manifest = {
  version: 1,
  files: files.map((file) =>
    file.path
      ? { name: file.name, sha256: file.sha256, bytes: file.bytes, path: file.path }
      : { name: file.name, sha256: file.sha256, bytes: file.bytes, url: file.url },
  ),
};
writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const total = files.reduce((sum, file) => sum + file.bytes, 0);
console.log(
  `stage-stt-model: ${files.length} files, ${Math.round(total / 1e6)} MB staged` +
    (downloaded ? ` (${Math.round(downloaded / 1e6)} MB downloaded)` : ' (from local copies)'),
);
