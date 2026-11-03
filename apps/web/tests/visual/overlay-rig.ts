/**
 * File: apps/web/tests/visual/overlay-rig.ts
 * Purpose: Builds and serves the overlay rig (v1.0.3 visual checks) on http://localhost:3123: the
 *          live-page stand-in at / (rig-live.tsx) and the real overlay at /compact/harness-session
 *          (rig-compact.tsx), with the app's real stylesheet (Tailwind). Start the desktop shell
 *          against it (`electron . --kite-url=http://localhost:3123`, or overlay-shots.ts) to see
 *          the real overlay window over whatever is on screen.
 *          Usage: pnpm --filter web exec tsx tests/visual/overlay-rig.ts
 * Used by: the developer and apps/desktop/tests/visual/overlay-shots.ts (manual visual checks)
 * Depends on: esbuild, @tailwindcss/postcss (as tests/integration/live.spec.ts), node:http
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 *
 * Invented data only; no network calls but the brand font.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The port the shell is pointed at. */
const PORT = Number(process.env.RIG_PORT ?? 3123);

/** The part of postcss used here (not a direct dependency, so its types are not imported). */
type PostcssRunner = (plugins: unknown[]) => {
  /** Runs the plugins over a stylesheet. */
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};

/**
 * Bundles the two pages and compiles the stylesheet.
 *
 * @returns The folder holding rig-live.js, rig-compact.js and rig.css.
 */
async function bundle(): Promise<string> {
  const outDir = mkdtempSync(path.join(tmpdir(), 'kite-overlay-rig-'));
  await build({
    entryPoints: [
      path.join(WEB_DIR, 'tests', 'visual', 'rig-live.tsx'),
      path.join(WEB_DIR, 'tests', 'visual', 'rig-compact.tsx'),
      path.join(WEB_DIR, 'tests', 'visual', 'rig-mic.tsx'),
      path.join(WEB_DIR, 'tests', 'visual', 'rig-call.tsx'),
    ],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: outDir,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    alias: {
      'next/link': path.join(WEB_DIR, 'tests', 'integration', 'harness', 'next-link-stub.tsx'),
    },
    jsx: 'automatic',
    // The speech model from this computer (public/models), as in development.
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_STT_SOURCE': '"local"',
    },
    logLevel: 'error',
  });
  // The speech worker, a classic script like the app's (its runtime uses importScripts). The
  // engine asks for it at new URL('./stt.worker.ts', import.meta.url), next to the bundles.
  await build({
    entryPoints: [path.join(WEB_DIR, 'src', 'core', 'stt', 'stt.worker.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    outfile: path.join(outDir, 'stt.worker.ts'),
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  const fromTailwind = createRequire(
    createRequire(import.meta.url).resolve('@tailwindcss/postcss'),
  );
  const postcss = fromTailwind('postcss') as PostcssRunner;
  const from = path.join(WEB_DIR, 'app', 'globals.css');
  const result = await postcss([tailwind({ base: WEB_DIR })]).process(readFileSync(from, 'utf8'), {
    from,
  });
  writeFileSync(path.join(outDir, 'rig.css'), result.css);
  return outDir;
}

/**
 * A page that loads one of the bundles.
 *
 * @param script The bundle's name.
 * @returns The HTML.
 */
function page(script: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Kite overlay rig</title><link rel="stylesheet" href="/rig/rig.css">' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=block">' +
    "<style>:root{--font-inter:'Inter'}</style></head>" +
    `<body class="font-sans"><div id="root"></div><script type="module" src="/rig/${script}"></script></body></html>`
  );
}

/** Builds, then serves until stopped. */
async function main(): Promise<void> {
  const outDir = await bundle();
  createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/rig/')) {
      const file = path.join(outDir, path.basename(url.split('?')[0]!));
      try {
        const body = readFileSync(file);
        res.writeHead(200, {
          'Content-Type': file.endsWith('.css') ? 'text/css' : 'text/javascript',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    // The speech runtime and model files, from public/ (only real files inside it).
    const pathname = decodeURIComponent(url.split('?')[0]!);
    const publicDir = path.join(WEB_DIR, 'public');
    const asset = path.resolve(publicDir, pathname.slice(1));
    if (pathname !== '/' && asset.startsWith(publicDir + path.sep) && existsSync(asset)) {
      const type = asset.endsWith('.wasm')
        ? 'application/wasm'
        : asset.endsWith('.js')
          ? 'text/javascript'
          : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }).end(readFileSync(asset));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      page(
        url.startsWith('/compact/')
          ? 'rig-compact.js'
          : url.startsWith('/mic')
            ? 'rig-mic.js'
            : url.startsWith('/call')
              ? 'rig-call.js'
              : 'rig-live.js',
      ),
    );
  }).listen(PORT, '127.0.0.1', () => console.info(`overlay rig: http://localhost:${PORT}`));
}

void main();
