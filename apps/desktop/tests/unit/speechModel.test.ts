/**
 * Tests for apps/desktop/src/speechModel.ts (v1.3.1, ADR-0059): the manifest is checked strictly;
 * only the manifest's exact addresses are redirected, and only after the file passed its SHA-256;
 * a missing or damaged file is left to the network; a file that passed is not hashed again; the
 * kite-model: handler serves only manifest files, with the CORS header the redirected fetch needs.
 * No Electron: the session and net.fetch are fakes.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addressesFor,
  createBundledModel,
  hashFile,
  installBundledModel,
  MANIFEST_NAME,
  MODEL_SCHEME,
  parseManifest,
  type ModelManifest,
} from '../../src/speechModel';

const ORIGIN = 'https://kite-call-assistant.vercel.app';
const HF = 'https://huggingface.co/csukuangfj/model/resolve/abc/tokens.txt';

/**
 * Hex SHA-256 of some text.
 *
 * @param text The text.
 * @returns Lower-case hex.
 */
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A bundle folder with two files (a model file by address, an engine file by path) and its manifest.
 *
 * @param damage True to write wrong bytes into the model file.
 * @returns The folder, the manifest and the verified-marks file.
 */
function bundle(damage = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kite-model-'));
  dirs.push(dir);
  const tokens = 'a 0\nb 1\n';
  const loader = 'console.log(1)';
  writeFileSync(path.join(dir, 'tokens.txt'), damage ? 'x 0\nb 1\n' : tokens);
  writeFileSync(path.join(dir, 'loader.js'), loader);
  const manifest: ModelManifest = {
    version: 1,
    files: [
      { name: 'tokens.txt', sha256: sha(tokens), bytes: tokens.length, url: HF },
      {
        name: 'loader.js',
        sha256: sha(loader),
        bytes: loader.length,
        path: '/stt-runtime/v1.13.7/loader.js',
      },
    ],
  };
  writeFileSync(path.join(dir, MANIFEST_NAME), JSON.stringify(manifest));
  return { dir, manifest, verifiedFile: path.join(dir, 'verified.json') };
}

describe('parseManifest', () => {
  it('keeps well-formed entries and drops anything that could escape the folder or the addresses', () => {
    const good = { name: 'a.onnx', sha256: 'a'.repeat(64), bytes: 1, url: 'https://x.example/a' };
    const parsed = parseManifest({
      version: 1,
      files: [
        good,
        { ...good, name: '../evil' },
        { ...good, name: '.hidden' },
        { ...good, sha256: 'nothex' },
        { ...good, bytes: 0 },
        { ...good, url: 'http://insecure.example/a' },
        { name: 'b.js', sha256: 'b'.repeat(64), bytes: 2, path: '/elsewhere/b.js' },
        { name: 'c.js', sha256: 'c'.repeat(64), bytes: 2, path: '/stt-runtime/v1.13.7/c.js' },
      ],
    });
    expect(parsed?.files.map((file) => file.name)).toEqual(['a.onnx', 'c.js']);
    expect(parseManifest({ version: 2, files: [good] })).toBeNull();
    expect(parseManifest(null)).toBeNull();
  });

  it('maps engine paths onto the app origin and keeps model addresses as they are', () => {
    const { manifest } = bundle();
    expect([...addressesFor(manifest, ORIGIN).keys()]).toEqual([
      HF,
      `${ORIGIN}/stt-runtime/v1.13.7/loader.js`,
    ]);
  });
});

describe('createBundledModel', () => {
  it('passes a matching file, hashes it once, and remembers it for the next start', async () => {
    const { dir, manifest, verifiedFile } = bundle();
    const hash = vi.fn(hashFile);
    const first = createBundledModel({ dir, manifest, verifiedFile, hash });
    const [a, b] = await Promise.all([
      first.verify(manifest.files[0]!),
      first.verify(manifest.files[0]!),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(hash).toHaveBeenCalledTimes(1);
    // A new start of the app: remembered by size and date, so no hashing.
    const again = createBundledModel({ dir, manifest, verifiedFile, hash });
    expect(await again.verify(manifest.files[0]!)).toBe(true);
    expect(hash).toHaveBeenCalledTimes(1);
  });

  it('hashes again when the file changed since it passed, and fails damaged or missing files', async () => {
    const { dir, manifest, verifiedFile } = bundle();
    await createBundledModel({ dir, manifest, verifiedFile }).verify(manifest.files[0]!);
    // Same size, new bytes and a new date: the old mark does not count.
    writeFileSync(path.join(dir, 'tokens.txt'), 'x 0\nb 1\n');
    utimesSync(path.join(dir, 'tokens.txt'), new Date(), new Date(Date.now() + 5_000));
    const later = createBundledModel({ dir, manifest, verifiedFile });
    expect(await later.verify(manifest.files[0]!)).toBe(false);
    rmSync(path.join(dir, 'loader.js'));
    expect(await later.verify(manifest.files[1]!)).toBe(false);
    expect(await later.verifyAll()).toEqual({ valid: 0, invalid: 2 });
  });
});

/**
 * A fake session that records the webRequest listener and the scheme handler.
 *
 * @returns The session, the recorded filter, and helpers that run a redirect or a served request.
 */
function fakeSession() {
  let listener:
    | ((
        details: { url: string; method: string },
        callback: (response: { redirectURL?: string }) => void,
      ) => void)
    | null = null;
  let filter: { urls: string[] } | null = null;
  let handler: ((request: Request) => Promise<Response>) | null = null;
  const session = {
    webRequest: {
      onBeforeRequest: (f: { urls: string[] }, l: typeof listener) => {
        filter = f;
        listener = l;
      },
    },
    protocol: {
      handle: (scheme: string, h: typeof handler) => {
        expect(scheme).toBe(MODEL_SCHEME);
        handler = h;
      },
    },
  };
  return {
    session: session as never,
    filter: () => filter,
    redirect: (url: string, method = 'GET') =>
      new Promise<{ redirectURL?: string }>((resolve) => listener!({ url, method }, resolve)),
    serve: (url: string) => handler!(new Request(url)),
  };
}

describe('installBundledModel', () => {
  it('redirects only the exact addresses of files that passed, and serves them with CORS', async () => {
    const { dir } = bundle();
    const fake = fakeSession();
    const fetchFile = vi.fn(async () => new Response('a 0\nb 1\n'));
    installBundledModel({
      session: fake.session,
      fetchFile,
      dir,
      origin: ORIGIN,
      verifiedFile: path.join(dir, 'v.json'),
    });
    expect(fake.filter()?.urls).toEqual([HF, `${ORIGIN}/stt-runtime/v1.13.7/loader.js`]);
    expect(await fake.redirect(HF)).toEqual({ redirectURL: `${MODEL_SCHEME}://bundle/tokens.txt` });
    expect(await fake.redirect(HF, 'POST')).toEqual({});
    expect(await fake.redirect(`${HF}?other`)).toEqual({});
    const response = await fake.serve(`${MODEL_SCHEME}://bundle/tokens.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.text()).toBe('a 0\nb 1\n');
    expect((await fake.serve(`${MODEL_SCHEME}://bundle/manifest.json`)).status).toBe(404);
    expect((await fake.serve(`${MODEL_SCHEME}://bundle/..%2F..%2Fsecret`)).status).toBe(404);
  });

  it('leaves a damaged file to the network (no redirect), and does nothing without a bundle', async () => {
    const { dir } = bundle(true);
    const fake = fakeSession();
    installBundledModel({
      session: fake.session,
      fetchFile: vi.fn(),
      dir,
      origin: ORIGIN,
      verifiedFile: path.join(dir, 'v.json'),
    });
    expect(await fake.redirect(HF)).toEqual({});
    expect((await fake.serve(`${MODEL_SCHEME}://bundle/tokens.txt`)).status).toBe(404);
    const none = fakeSession();
    expect(
      installBundledModel({
        session: none.session,
        fetchFile: vi.fn(),
        dir: path.join(dir, 'missing'),
        origin: ORIGIN,
        verifiedFile: path.join(dir, 'v.json'),
      }),
    ).toBeNull();
    expect(none.filter()).toBeNull();
  });
});
