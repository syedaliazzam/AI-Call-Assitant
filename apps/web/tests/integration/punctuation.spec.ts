/**
 * Integration test for the offline punctuation pass (v1.1.0, ADR-0044): the real worker
 * (core/punctuation/punct.worker.ts), the real ONNX Runtime WebAssembly and the real model, in Chromium,
 * from a local server laid out like the deployed site (public/punct). Checks that lines in the live
 * engine's style come back with marks and capitals and the same words, and that a line takes under the
 * 100 ms limit. All text is invented; only timings are printed.
 *
 * Needs the files: `pnpm --filter web fetch-models --runtime-only` (every build runs it).
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

/** apps/web. */
const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The types the served files need. */
const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};

let server: Server;
let origin: string;

test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: [path.join(WEB_DIR, 'src/core/punctuation/punct.worker.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  });
  const worker = bundle.outputFiles[0]!.contents;
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/worker.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(worker);
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>punctuation</title>');
      return;
    }
    try {
      const file = readFileSync(path.join(WEB_DIR, 'public', ...url.pathname.split('/')));
      response.writeHead(200, {
        'Content-Type': TYPES[path.extname(url.pathname)] ?? 'application/octet-stream',
      });
      response.end(file);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server?.close();
});

test('writes lines with marks and capitals, the same words, in time', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${origin}/`);
  const result = await page.evaluate(async () => {
    const LINES = [
      'THE OPERATIONS TEAM LIKED THE RESULTS BUT WE STILL NEED TO LOOK AT THE NUMBERS WHAT WOULD ONBOARDING LOOK LIKE AND HOW LONG WOULD IT TAKE',
      'WE TALKED TO THE NIGHT SHIFT ON MONDAY THEY SAID THE ROUTES WERE BETTER',
      'GOOD MORNING HOW ARE YOU DOING TODAY',
      'I REBUILT THE BILLING EXPORT AND IT NOW FINISHES WITHIN TEN MINUTES',
      'HOW WOULD YOU DESIGN A RATE LIMITER FOR AN API WITH MILLIONS OF USERS',
    ];
    const worker = new Worker('/worker.js');
    let loaded = 0;
    const waiting = new Map<number, (reply: { text: string; ms: number } | null) => void>();
    worker.onmessage = ({ data }) => {
      if (data.type === 'loaded') loaded = data.ms;
      if (data.type === 'failed') for (const done of waiting.values()) done(null);
      if (data.type === 'line-failed') waiting.get(data.id)?.(null);
      if (data.type === 'result') waiting.get(data.id)?.({ text: data.text, ms: data.ms });
    };
    const send = (id: number, text: string) =>
      new Promise<{ text: string; ms: number } | null>((resolve) => {
        waiting.set(id, resolve);
        worker.postMessage({ type: 'punctuate', id, text });
      });
    const out: { text: string; ms: number }[] = [];
    let id = 1;
    // Warm first: the load is measured on its own. Then each line several times.
    await send(id++, 'OKAY');
    for (let round = 0; round < 8; round += 1) {
      for (const line of LINES) {
        const reply = await send(id++, line);
        if (!reply) return { failed: true, loaded, lines: LINES, out };
        out.push(reply);
      }
    }
    worker.terminate();
    return { failed: false, loaded, lines: LINES, out };
  });
  expect(result.failed).toBe(false);
  // The words are never changed, only their marks and capitals.
  const plain = (text: string) => text.toLowerCase().replace(/[,.?]/g, '');
  result.lines.forEach((line, i) => {
    expect(plain(result.out[i]!.text)).toBe(plain(line));
  });
  const all = result.out.map((reply) => reply.text).join(' ');
  expect(all).toMatch(/[,.?]/);
  expect(all).toMatch(/[A-Z][a-z]/);
  expect(result.out[0]!.text).not.toBe(result.lines[0]);
  const times = result.out.map((reply) => reply.ms).sort((a, b) => a - b);
  const at = (share: number) =>
    times[Math.min(times.length - 1, Math.floor(times.length * share))]!;
  console.log(
    '[punctuation]',
    JSON.stringify({ loadMs: result.loaded, p50: at(0.5), p95: at(0.95) }),
  );
  expect(at(0.95)).toBeLessThanOrEqual(100);
});
