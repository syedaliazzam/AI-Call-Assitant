/**
 * File: apps/desktop/src/speechModel.ts
 * Purpose: The streaming speech model shipped inside the installer (v1.3.1, ADR-0059). The web app
 *          fetches the model's files from fixed, pinned addresses (Hugging Face for the model, the
 *          app's own /stt-runtime/ for the engine) and checks each file's SHA-256 itself. In the
 *          desktop app, this module answers exactly those addresses from the files bundled next to the
 *          app, so a fresh install connects without downloading anything, and the web and browser code
 *          paths do not change:
 *          - a webRequest rule redirects ONLY the manifest's exact addresses to the private
 *            kite-model: scheme (every other request is untouched: sign-in cookies, answers, pages);
 *          - the kite-model: handler streams the bundled file, after checking its SHA-256 against the
 *            manifest the first time it is used (the result is remembered per file size and date);
 *          - a missing or damaged file is never redirected: the request goes to the network as
 *            before, so the app downloads it the way it always has.
 * Used by: src/main.ts (installBundledModel, with the session and the app's origin); tests
 * Depends on: Node's crypto, fs and path; electron (net, Session types)
 * Architecture: docs/decisions/ADR-0059-speech-model-in-the-desktop-installer.md;
 *               ADR-0020 (the model); apps/web/src/core/stt/models.ts (the pinned files)
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Session } from 'electron';

/** The private scheme the bundled files are served on (registered as privileged in main.ts). */
export const MODEL_SCHEME = 'kite-model';

/** The folder name of the bundled model (under resources/ when installed, native/ in development). */
export const BUNDLED_MODEL_FOLDER = 'stt-model';

/** The manifest's file name inside that folder (written by scripts/stage-stt-model.mjs). */
export const MANIFEST_NAME = 'manifest.json';

/** The file in the app's data folder that remembers which bundled files already passed SHA-256. */
export const VERIFIED_FILE = 'stt-model-verified.json';

/** One bundled file, as the manifest lists it. */
export interface ManifestFile {
  /** File name in the bundle folder (letters, digits, dot, dash and underscore only). */
  name: string;
  /** Expected SHA-256, lower-case hex. */
  sha256: string;
  /** Size in bytes. */
  bytes: number;
  /** The absolute https address the web app fetches it from (model files). */
  url?: string;
  /** Or: the path on the app's own origin it is fetched from (the engine, /stt-runtime/…). */
  path?: string;
}

/** The manifest written next to the bundled files. */
export interface ModelManifest {
  /** Format version (1). */
  version: 1;
  /** The files. */
  files: ManifestFile[];
}

/**
 * Checks a parsed manifest and keeps only well-formed entries, so a damaged manifest can never
 * point the handler outside the bundle folder or at an address it was not meant to answer.
 *
 * @param value The parsed JSON.
 * @returns The manifest, or null when it is not one.
 * Called from: loadManifest(); tests
 */
export function parseManifest(value: unknown): ModelManifest | null {
  if (typeof value !== 'object' || value === null) return null;
  const { version, files } = value as { version?: unknown; files?: unknown };
  if (version !== 1 || !Array.isArray(files)) return null;
  const valid = files.filter((file): file is ManifestFile => {
    if (typeof file !== 'object' || file === null) return false;
    const entry = file as Record<string, unknown>;
    const { name, sha256, bytes, url, path: urlPath } = entry;
    if (typeof name !== 'string' || !/^[\w.-]{1,128}$/.test(name) || name.startsWith('.')) {
      return false;
    }
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return false;
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) return false;
    // Exactly one of url (https) or path (the app's own /stt-runtime/ folder).
    if (typeof url === 'string') {
      return urlPath === undefined && url.startsWith('https://') && !url.includes('#');
    }
    return typeof urlPath === 'string' && /^\/stt-runtime\/[\w.-]+\/[\w.-]+$/.test(urlPath);
  });
  return valid.length > 0 ? { version: 1, files: valid } : null;
}

/**
 * Reads and checks the manifest in a bundle folder.
 *
 * @param dir The bundle folder.
 * @returns The manifest, or null when there is no bundle (or it is unreadable).
 * Called from: installBundledModel(); tests
 */
export function loadManifest(dir: string): ModelManifest | null {
  try {
    return parseManifest(JSON.parse(readFileSync(path.join(dir, MANIFEST_NAME), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * The addresses the web app fetches, each with its bundled file.
 *
 * @param manifest The manifest.
 * @param origin   The app's origin (the engine files are fetched from it), for example
 *                 'https://kite-call-assistant.vercel.app'.
 * @returns Address → file.
 * Called from: installBundledModel(); tests
 */
export function addressesFor(manifest: ModelManifest, origin: string): Map<string, ManifestFile> {
  const map = new Map<string, ManifestFile>();
  for (const file of manifest.files) {
    map.set(file.url ?? `${origin}${file.path}`, file);
  }
  return map;
}

/**
 * The SHA-256 of a file, read as a stream (the encoder is about 188 MB).
 *
 * @param file The file's path.
 * @returns Lower-case hex.
 * @throws The read error when the file cannot be read.
 * Called from: createBundledModel() (the default hash); tests
 */
export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** What is remembered about a file that passed: its checksum, size and modification time. */
type VerifiedMarks = Record<string, { size: number; mtimeMs: number }>;

/** What createBundledModel() needs. */
export interface BundledModelDeps {
  /** The bundle folder. */
  dir: string;
  /** The manifest found there. */
  manifest: ModelManifest;
  /** Where to remember which files passed (a JSON file in the app's data folder). */
  verifiedFile: string;
  /** Hashes a file (default hashFile; tests pass a counting fake). */
  hash?: (file: string) => Promise<string>;
}

/** The bundle, checked file by file. */
export interface BundledModel {
  /**
   * Whether a file is present and matches the manifest's SHA-256. The first call for a file hashes
   * it (once, even when several requests ask at the same time); a file that passed is remembered by
   * size and modification time, so later starts of the app do not hash it again.
   *
   * @param file The manifest entry.
   * @returns True when it may be served.
   */
  verify(file: ManifestFile): Promise<boolean>;
  /**
   * The bundled file's path for a name, if the manifest lists it.
   *
   * @param name The file name from a kite-model: address.
   * @returns The manifest entry and its path, or null.
   */
  lookup(name: string): { file: ManifestFile; filePath: string } | null;
  /** Checks every file now (in the background when the app opens). */
  verifyAll(): Promise<{ valid: number; invalid: number }>;
}

/**
 * The bundle with its checks.
 *
 * @param deps See BundledModelDeps.
 * @returns The bundle.
 * Called from: installBundledModel(); tests
 */
export function createBundledModel(deps: BundledModelDeps): BundledModel {
  const hash = deps.hash ?? hashFile;
  const byName = new Map(deps.manifest.files.map((file) => [file.name, file]));
  const checks = new Map<string, Promise<boolean>>();

  const readMarks = (): VerifiedMarks => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(deps.verifiedFile, 'utf8'));
      return typeof parsed === 'object' && parsed !== null ? (parsed as VerifiedMarks) : {};
    } catch {
      return {};
    }
  };

  const check = async (file: ManifestFile): Promise<boolean> => {
    const filePath = path.join(deps.dir, file.name);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return false;
    }
    if (stat.size !== file.bytes) return false;
    const marks = readMarks();
    const mark = marks[file.sha256];
    if (mark && mark.size === stat.size && mark.mtimeMs === stat.mtimeMs) return true;
    let actual: string;
    try {
      actual = await hash(filePath);
    } catch {
      return false;
    }
    if (actual !== file.sha256) {
      // Only ids and sizes in the log (CLAUDE.md): the name of the pinned file is not user data.
      console.warn('speech model: bundled file failed its checksum; it will be downloaded', {
        name: file.name,
      });
      return false;
    }
    try {
      writeFileSync(
        deps.verifiedFile,
        JSON.stringify({
          ...readMarks(),
          [file.sha256]: { size: stat.size, mtimeMs: stat.mtimeMs },
        }),
      );
    } catch {
      // Not remembered: it is checked again next time, which is slower but still correct.
    }
    return true;
  };

  const verify = (file: ManifestFile): Promise<boolean> => {
    let pending = checks.get(file.sha256);
    if (!pending) {
      pending = check(file);
      checks.set(file.sha256, pending);
    }
    return pending;
  };

  return {
    verify,
    lookup(name) {
      const file = byName.get(name);
      return file ? { file, filePath: path.join(deps.dir, file.name) } : null;
    },
    async verifyAll() {
      const results = await Promise.all(deps.manifest.files.map(verify));
      const valid = results.filter(Boolean).length;
      return { valid, invalid: results.length - valid };
    },
  };
}

/** The parts of Electron installBundledModel() uses (fakes in tests). */
export interface InstallDeps {
  /** The session the app's windows use. */
  session: Pick<Session, 'webRequest' | 'protocol'>;
  /** Electron's net.fetch (streams a file:// address). */
  fetchFile: (url: string) => Promise<Response>;
  /** The bundle folder (resources/stt-model when installed; native/stt-model in development). */
  dir: string;
  /** The app's origin. */
  origin: string;
  /** Where to remember verified files. */
  verifiedFile: string;
  /** Hashes a file (tests). */
  hash?: (file: string) => Promise<string>;
}

/**
 * Serves the bundled speech model at the addresses the web app fetches. Does nothing when there is
 * no bundle (development without staging, or a build without it): the app downloads as before.
 *
 * @param deps See InstallDeps.
 * @returns The bundle (null when there is none), so main.ts can check it in the background.
 * Called from: start() in src/main.ts, once the app is ready
 */
export function installBundledModel(deps: InstallDeps): BundledModel | null {
  if (!existsSync(deps.dir)) return null;
  const manifest = loadManifest(deps.dir);
  if (!manifest) {
    console.warn('speech model: no usable manifest in the bundle; downloads stay on');
    return null;
  }
  const bundle = createBundledModel({
    dir: deps.dir,
    manifest,
    verifiedFile: deps.verifiedFile,
    hash: deps.hash,
  });
  const addresses = addressesFor(manifest, deps.origin);

  // Only these exact addresses: Electron's URL patterns match them literally, and the listener
  // checks the map again before it redirects anything.
  deps.session.webRequest.onBeforeRequest({ urls: [...addresses.keys()] }, (details, callback) => {
    const file = addresses.get(details.url);
    if (!file || details.method !== 'GET') {
      callback({});
      return;
    }
    void bundle.verify(file).then((ok) =>
      // A file that failed (or is missing) is not redirected: the request goes to the network.
      callback(ok ? { redirectURL: `${MODEL_SCHEME}://bundle/${file.name}` } : {}),
    );
  });

  deps.session.protocol.handle(MODEL_SCHEME, async (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    const entry = bundle.lookup(name);
    if (!entry || request.method !== 'GET' || !(await bundle.verify(entry.file))) {
      return new Response(null, { status: 404 });
    }
    const body = await deps.fetchFile(pathToFileURL(entry.filePath).href);
    return new Response(body.body, {
      status: 200,
      headers: {
        'content-type': entry.file.name.endsWith('.js')
          ? 'text/javascript'
          : entry.file.name.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream',
        'content-length': String(entry.file.bytes),
        // After the redirect the browser sends "Origin: null" (a cross-origin hop), so only "*"
        // matches. These are public model files, and only the app's own pages can reach this
        // scheme (navigation is locked to the app's origin, security.ts).
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    });
  });

  return bundle;
}
