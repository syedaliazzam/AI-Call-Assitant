/**
 * File: apps/web/tests/visual/overlay-rig.ts
 * Purpose: Builds and serves the overlay rig (visual checks) on http://localhost:3123: a simulated
 *          call in the real full call window at / (rig-live.tsx), the real overlay at
 *          /compact/harness-session (rig-compact.tsx), the real Ask Kite and history screens at /ask
 *          and /history (rig-pages.tsx), and a mocked /api/answer, with the app's real stylesheet
 *          (Tailwind). Start the desktop shell against it (`electron . --kite-url=http://localhost:3123`,
 *          or call-window-shots.ts) to see the real windows over whatever is on screen.
 *          Usage: pnpm --filter web exec tsx tests/visual/overlay-rig.ts
 * Used by: the developer and apps/desktop/tests/visual/call-window-shots.ts (manual visual checks)
 * Depends on: esbuild, @tailwindcss/postcss (as tests/integration/live.spec.ts), node:http
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md, ADR-0040
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
      path.join(WEB_DIR, 'tests', 'visual', 'rig-pages.tsx'),
    ],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outdir: outDir,
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    alias: {
      'next/link': path.join(WEB_DIR, 'tests', 'integration', 'harness', 'next-link-stub.tsx'),
      'next/navigation': path.join(
        WEB_DIR,
        'tests',
        'integration',
        'harness',
        'next-navigation-stub.ts',
      ),
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
    '<title>Kite rig</title><link rel="stylesheet" href="/rig/rig.css">' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=block">' +
    "<style>:root{--font-inter:'Inter'}</style></head>" +
    `<body class="font-sans"><div id="root"></div><script type="module" src="/rig/${script}"></script></body></html>`
  );
}

/** The mocked answers: words in the question, the clean question Claude would write, the answer. */
const MOCK_ANSWERS: readonly { words: RegExp; clean: string; text: string }[] = [
  {
    words: /voice/i,
    clean: 'How would you design a voice agent for a hospital?',
    text: 'Start from latency: speech in, Claude, speech out, under a second.\n- Streaming speech recognition, so it hears while they talk\n- Claude answers from approved hospital documents only\n- Interruptions stop the voice at once\nTip: Offer to walk through handing over to a nurse.',
  },
  {
    words: /production/i,
    clean: 'What production-grade applications have you built?',
    text: 'A document search assistant and real-time voice agents, both in production.\n- Document search: vector database, Claude drafts, human review\n- Voice agents: Deepgram speech and ElevenLabs voices\n- Deployed with Docker on Azure Kubernetes Service',
  },
  {
    words: /latency|slow/i,
    clean: 'How do you keep latency low?',
    text: 'I stream every stage and measure each one.\n- Prompt caching for the fixed context\n- Regional deployment close to the user',
  },
];

/**
 * Streams a mocked answer in the real order: meta, the words, the clean question, done.
 *
 * @param question The question from the request.
 * @param send     Writes one event.
 * @returns When finished.
 */
async function streamMockAnswer(
  question: string,
  send: (name: string, data: unknown) => void,
): Promise<void> {
  const mock = MOCK_ANSWERS.find((candidate) => candidate.words.test(question)) ?? {
    clean: 'What would you like to know?',
    text: 'Happy to go into more detail on any part of that.\n- Ask about the design, the cost or the rollout',
  };
  send('meta', { meta: { type: 'technical', target: 'call', source: 'docs' } });
  // A few words at a time, slowly enough that a capture can catch it streaming.
  const words = mock.text.split(' ');
  for (let i = 0; i < words.length; i += 3) {
    send('delta', { text: `${i > 0 ? ' ' : ''}${words.slice(i, i + 3).join(' ')}` });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  send('question', { question: mock.clean });
}

/** Builds, then serves until stopped. */
async function main(): Promise<void> {
  const outDir = await bundle();
  createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST' && url === '/api/answer') {
      const parts: Buffer[] = [];
      req.on('data', (part: Buffer) => parts.push(part));
      req.on('end', () => {
        const request = JSON.parse(Buffer.concat(parts).toString('utf8')) as {
          /** 'warm', 'answer', 'chat' or 'screenshot'. */
          mode: string;
          /** The question, if any. */
          question?: string;
        };
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const send = (name: string, data: unknown) =>
          res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        const finish = () => {
          send('done', {
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 900,
            },
            ms: { auth: 1, toStreamOpen: 2, streamOpenToFirstText: 3, toFirstText: 4, total: 5 },
          });
          res.end();
        };
        if (request.mode === 'warm') finish();
        else void streamMockAnswer(request.question ?? '', send).then(finish);
      });
      return;
    }
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
              : url.startsWith('/ask') || url.startsWith('/history')
                ? 'rig-pages.js'
                : 'rig-live.js',
      ),
    );
  }).listen(PORT, '127.0.0.1', () => console.info(`overlay rig: http://localhost:${PORT}`));
}

void main();
