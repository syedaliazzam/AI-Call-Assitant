/**
 * Tests for apps/desktop/src/accurate (v1.0.1, ADR-0034), with a local HTTP server that serves
 * byte ranges: downloadModel() fetches each file, resumes a partial file with a Range request
 * (only the missing bytes are sent), deletes a file that fails its SHA-256 and reports CHECKSUM,
 * and does not fetch a file already checked; createAccurateHost() reports 'unavailable' without a
 * native build, refuses audio that is not a Float32Array or is longer than 30 s, and answers
 * 'not-ready' before the model is downloaded; installAccurate() answers only the Kite page.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCURATE_STATUS_CHANNEL } from '../../src/channels';
import { downloadModel, isModelReady } from '../../src/accurate/download';
import { createAccurateHost, installAccurate } from '../../src/accurate/host';
import type { ModelFile } from '../../src/accurate/model';

/** Two invented model files. */
const FILES: Record<string, Buffer> = {
  'a.bin': Buffer.from('a'.repeat(5_000)),
  'b.bin': Buffer.from(Array.from({ length: 20_000 }, (_, i) => i % 251)),
};

/** The ranges the server was asked for, per file ("full" when no Range). */
const asked: { name: string; range: string }[] = [];

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const name = path.basename(req.url ?? '');
    const body = FILES[name];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    asked.push({ name, range: range ? `${range[1]}-` : 'full' });
    if (range) {
      const start = Number(range[1]);
      res.writeHead(206, { 'Content-Length': body.length - start });
      res.end(body.subarray(start));
    } else {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
});

let dir = '';
beforeEach(() => {
  asked.length = 0;
  dir = mkdtempSync(path.join(tmpdir(), 'kite-accurate-'));
});

/**
 * The model files for the test server.
 *
 * @param overrides A file's hash to change (to test a mismatch).
 * @returns The files with their real sizes and hashes.
 */
function modelFiles(overrides: Record<string, string> = {}): ModelFile[] {
  return Object.entries(FILES).map(([name, body]) => ({
    name,
    url: `${base}/${name}`,
    size: body.length,
    sha256: overrides[name] ?? createHash('sha256').update(body).digest('hex'),
  }));
}

describe('downloadModel', () => {
  it('downloads and checks every file, then is ready', async () => {
    await downloadModel(dir, modelFiles());
    expect(await isModelReady(dir, modelFiles())).toBe(true);
    expect(readFileSync(path.join(dir, 'b.bin')).equals(FILES['b.bin']!)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('resumes a partial file from where it stopped', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'b.bin.part'), FILES['b.bin']!.subarray(0, 7_000));
    await downloadModel(dir, modelFiles());
    expect(asked.find((entry) => entry.name === 'b.bin')?.range).toBe('7000-');
    expect(readFileSync(path.join(dir, 'b.bin')).equals(FILES['b.bin']!)).toBe(true);
  });

  it('deletes a file that fails its hash and reports CHECKSUM', async () => {
    await expect(downloadModel(dir, modelFiles({ 'b.bin': '0'.repeat(64) }))).rejects.toThrow(
      'CHECKSUM',
    );
    expect(existsSync(path.join(dir, 'b.bin'))).toBe(false);
    expect(existsSync(path.join(dir, 'b.bin.part'))).toBe(false);
  });

  it('does not fetch a file that is already checked', async () => {
    await downloadModel(dir, modelFiles());
    asked.length = 0;
    await downloadModel(dir, modelFiles());
    expect(asked).toEqual([]);
  });
});

describe('createAccurateHost', () => {
  const fork = vi.fn();

  it('is unavailable without a native build, and never starts the engine', async () => {
    const host = createAccurateHost({ modelDir: dir, nativeDir: null, workerPath: 'w.js', fork });
    expect((await host.status()).state).toBe('unavailable');
    expect(await host.transcribe(new Float32Array(16_000))).toEqual({
      ok: false,
      code: 'not-ready',
    });
    expect(fork).not.toHaveBeenCalled();
  });

  it('refuses audio that is not 16 kHz samples, or longer than 30 s', async () => {
    const host = createAccurateHost({ modelDir: dir, nativeDir: null, workerPath: 'w.js', fork });
    for (const bad of ['text', [0.1, 0.2], new Float32Array(0), new Float32Array(31 * 16_000)]) {
      expect(await host.transcribe(bad)).toEqual({ ok: false, code: 'bad-audio' });
    }
  });
});

describe('installAccurate', () => {
  it('answers only the Kite page', async () => {
    const handlers = new Map<string, (event: unknown) => unknown>();
    installAccurate({
      ipcMain: {
        handle: (channel: string, handler: (event: unknown) => unknown) =>
          handlers.set(channel, handler),
      } as never,
      allowedOrigin: 'https://kite.example',
      modelDir: dir,
      nativeDir: null,
      workerPath: 'w.js',
      fork: vi.fn(),
    });
    const status = handlers.get(ACCURATE_STATUS_CHANNEL)!;
    const frame = (url: string) => ({ senderFrame: { url, parent: null } });
    await expect(status(frame('https://kite.example/live/1'))).resolves.toMatchObject({
      state: 'unavailable',
    });
    expect(() => status(frame('https://evil.example/'))).toThrow('only for the Kite page');
  });
});
