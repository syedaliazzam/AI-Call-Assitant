/**
 * File: apps/web/scripts/stt-calls.ts
 * Purpose: Measures call quality on the synthetic test calls (v1.4, ADR-0062 Phase 2; ADR-0063). For each
 *          variant made by `calls:make`, both channels are played through the app's real speech worker
 *          (stt.worker.ts and sherpa-onnx WebAssembly in Chromium) at real-time speed, side by side as in a
 *          call, and every partial and final line is recorded with the time it reached the page. Those are
 *          then replayed through the app's own transcript and auto-answer code on a simulated clock
 *          (scripts/lib/call-replay.ts) and scored against the script (scripts/lib/call-metrics.ts).
 *          The code measured can be another checkout of apps/web (--src), so a version before a change
 *          (the baseline) is measured with its own worker and rules.
 *          Usage: pnpm --filter web stt:calls --label=after-p1 [--variant=speakers] [--src=<apps/web dir>]
 *                 pnpm --filter web stt:calls --label=after-p1 --replay   (score saved recordings again)
 *                 pnpm --filter web stt:calls --report=baseline,after-p1  (prints the table)
 * Used by: the "stt:calls" script in apps/web/package.json (by hand; never in CI)
 * Depends on: scripts/lib/call-replay.ts, call-metrics.ts, call-script.ts, scripts/make-calls.ts (paths),
 *             src/core/stt/models.ts, @playwright/test, esbuild
 * Architecture: docs/decisions/ADR-0063-synthetic-call-harness.md
 *
 * Privacy: the voices are text-to-speech; still, only numbers are printed. Recordings of what the engine
 * heard and the results stay in apps/web/eval-results/calls/ (git-ignored). No Claude request is sent.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { DEFAULT_STT_MODEL, getSttModel, resolveDownloads } from '../src/core/stt/models';
import { readWav } from './lib/call-audio';
import {
  computeCallMetrics,
  type CallMetrics,
  type CountOf,
  type TimedScriptLine,
} from './lib/call-metrics';
import { replayCall, type CallEvent, type CallLogic } from './lib/call-replay';
import { expectedQuestions, type PlacedLine } from './lib/call-script';
import { CALLS_DIR, VARIANTS, type Variant } from './make-calls';

/** apps/web of this checkout. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where results go (git-ignored). */
const RESULTS_DIR = path.join(CALLS_DIR, 'results');

/** What the page returns after a call. */
interface PageRun {
  /** Every partial and final message, with its arrival time. */
  events: CallEvent[];
  /** When the first sample was handed over (Unix ms): the call's time zero. */
  startedAt: number;
}

/** The page side: the real worker, fed two channels side by side at real-time speed. */
const PAGE = `
const worker = new Worker('/bundle/stt.worker.js');
const events = [];
const pongs = new Map();
let onReady;
const ready = new Promise((resolve, reject) => { onReady = { resolve, reject }; });
const unix = () => performance.timeOrigin + performance.now();
worker.onmessage = ({ data }) => {
  if (data.type === 'ready') onReady.resolve(data.load);
  if (data.type === 'error') onReady.reject(new Error(data.code + ': ' + data.message));
  if (data.type === 'partial') events.push({ type: 'partial', channel: data.channel, text: data.text, tStart: data.tStart, arrivedAt: unix() });
  if (data.type === 'final') events.push({ type: 'final', channel: data.channel, text: data.text, tStart: data.tStart, tEnd: data.tEnd, ...(data.confidence ? { confidence: data.confidence } : {}), arrivedAt: unix() });
  if (data.type === 'pong') pongs.get(data.id)?.();
};
window.callRun = {
  load: (message) => { worker.postMessage(message); return ready; },
  async run() {
    const you = new Float32Array(await (await fetch('/pcm/you')).arrayBuffer());
    const them = new Float32Array(await (await fetch('/pcm/them')).arrayBuffer());
    const total = Math.max(you.length, them.length);
    const chunk = 1600;
    const startedAt = unix();
    const start = performance.now();
    let clock = 1;
    for (let i = 0, n = 0; i < total; i += chunk, n += 1) {
      clock += chunk / 16000;
      for (const [channel, pcm] of [['you', you], ['them', them]]) {
        const samples = new Float32Array(chunk);
        samples.set(pcm.subarray(i, Math.min(i + chunk, pcm.length)));
        worker.postMessage({ type: 'accept', channel, samples, endTime: clock }, [samples.buffer]);
      }
      const wait = start + (n + 1) * 100 - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    worker.postMessage({ type: 'detach', channel: 'you' });
    worker.postMessage({ type: 'detach', channel: 'them' });
    await new Promise((resolve) => { pongs.set(1, resolve); worker.postMessage({ type: 'ping', id: 1 }); });
    return { events, startedAt };
  },
};
`;

/** What PAGE puts on the page. */
interface CallRunPage {
  /** Loads the model; resolves when ready. */
  load: (message: unknown) => Promise<unknown>;
  /** Plays the call; resolves with what was heard. */
  run: () => Promise<PageRun>;
}

declare global {
  interface Window {
    /** Set by PAGE. */
    callRun: CallRunPage;
  }
}

/**
 * Bundles the worker and the logic modules of the checkout measured.
 *
 * @param srcDir That checkout's apps/web.
 * @returns The bundle folder (stt.worker.js) and the loaded logic.
 * Called from: main()
 */
async function bundle(srcDir: string): Promise<{ dir: string; logic: CallLogic }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'kite-stt-calls-'));
  const common = {
    bundle: true,
    logLevel: 'error' as const,
    tsconfig: path.join(srcDir, 'tsconfig.json'),
    // A second checkout has no node_modules of its own: packages come from this one.
    nodePaths: [path.join(WEB_DIR, 'node_modules')],
  };
  await build({
    ...common,
    platform: 'browser',
    format: 'iife',
    entryPoints: [path.join(srcDir, 'src', 'core', 'stt', 'stt.worker.ts')],
    outfile: path.join(dir, 'stt.worker.js'),
  });
  const file = (relative: string) =>
    JSON.stringify(path.join(srcDir, 'src', relative).replace(/\\/g, '/'));
  const entry = [
    `export { createTranscript } from ${file('core/transcript/transcript.ts')};`,
    `export * from ${file('core/answer/autoAnswer.ts')};`,
    `export { pickQuestion } from ${file('core/transcript/questionKind.ts')};`,
    `export { createRepeatGuard, themSpan } from ${file('core/answer/repeatGuard.ts')};`,
    `export { groupLines } from ${file('core/transcript/group.ts')};`,
    `export { mergeTurns } from ${file('core/transcript/turns.ts')};`,
    existsSync(path.join(srcDir, 'src', 'core', 'stt', 'language.ts'))
      ? `export { looksNonEnglish } from ${file('core/stt/language.ts')};`
      : '',
  ].join('\n');
  writeFileSync(path.join(dir, 'logic-entry.ts'), entry);
  await build({
    ...common,
    platform: 'node',
    format: 'esm',
    entryPoints: [path.join(dir, 'logic-entry.ts')],
    outfile: path.join(dir, 'logic.mjs'),
  });
  const logic = (await import(pathToFileURL(path.join(dir, 'logic.mjs')).href)) as CallLogic;
  return { dir, logic };
}

/**
 * Plays one variant through the worker in Chromium.
 *
 * @param variant   The variant.
 * @param bundleDir The bundle folder.
 * @returns What the page recorded.
 * Called from: main()
 */
async function record(variant: Variant, bundleDir: string): Promise<PageRun> {
  const tracks = {
    you: readWav(path.join(CALLS_DIR, variant, 'you.wav')).samples,
    them: readWav(path.join(CALLS_DIR, variant, 'them.wav')).samples,
  };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (pathname === '/')
      return void res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end('<!doctype html><title>calls</title>');
    if (pathname === '/page.js')
      return void res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(PAGE);
    if (pathname === '/pcm/you' || pathname === '/pcm/them') {
      const samples = tracks[pathname.slice(5) as 'you' | 'them'];
      return void res
        .writeHead(200)
        .end(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    }
    const file = pathname.startsWith('/bundle/')
      ? path.join(bundleDir, pathname.slice('/bundle/'.length))
      : path.join(WEB_DIR, 'public', pathname.slice(1));
    if (!existsSync(file)) return void res.writeHead(404).end();
    const type = file.endsWith('.wasm')
      ? 'application/wasm'
      : file.endsWith('.js')
        ? 'text/javascript'
        : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.addScriptTag({ url: '/page.js' });
    const model = getSttModel(DEFAULT_STT_MODEL);
    const downloads = resolveDownloads(model, 'local', origin);
    await page.evaluate((message) => window.callRun.load(message), {
      type: 'load',
      model: model.id,
      runtime: downloads.runtime,
      files: downloads.model,
      hotwords: '',
      beamWidth: 4,
    });
    return await page.evaluate(() => window.callRun.run());
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * Scores a recorded run.
 *
 * @param variant The variant.
 * @param run     The recording.
 * @param logic   The logic of the version measured.
 * @returns The metrics.
 * Called from: main()
 */
function score(variant: Variant, run: PageRun, logic: CallLogic): CallMetrics {
  const timeline = JSON.parse(
    readFileSync(path.join(CALLS_DIR, variant, 'timeline.json'), 'utf8'),
  ) as {
    totalMs: number;
    lines: PlacedLine[];
  };
  const script: TimedScriptLine[] = timeline.lines.map((line) => ({
    ...line,
    start: run.startedAt + line.startMs,
    end: run.startedAt + line.endMs,
  }));
  const replayed = replayCall(run.events, logic);
  return computeCallMetrics({
    script,
    questions: expectedQuestions(),
    lines: replayed.lines,
    turns: replayed.themTurns,
    answers: replayed.answers,
    totalMs: timeline.totalMs,
  });
}

/**
 * A metric as a short text for the table.
 *
 * @param metrics The metrics.
 * @returns Rows of label and value.
 * Called from: printReport()
 */
function rows(metrics: CallMetrics): [string, string][] {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const of = (item: CountOf) => `${item.count}/${item.of}`;
  return [
    ['Words on the right channel (all)', pct(metrics.rightChannel.all)],
    ['  You / Them', `${pct(metrics.rightChannel.you)} / ${pct(metrics.rightChannel.them)}`],
    [
      'Lines from the other side (You / Them)',
      `${metrics.crossLines.you} / ${metrics.crossLines.them}`,
    ],
    ['WER as shown (You / Them)', `${pct(metrics.wer.you)} / ${pct(metrics.wer.them)}`],
    ['One-word noise lines per 10 min', metrics.fragmentsPer10Min.toFixed(1)],
    ['Multi-line questions split (lines)', of(metrics.splitLines)],
    ['Multi-line questions split (turns)', of(metrics.splitTurns)],
    ['Questions answered', of(metrics.answered)],
    ['Questions answered whole', of(metrics.whole)],
    ['Duplicate cards', String(metrics.duplicates)],
    ['Cards for non-questions', String(metrics.nonQuestionAnswers)],
    ['Cards in all', String(metrics.cards)],
    [
      'Question end → answer sent p50 / p95',
      `${Math.round(metrics.sendDelayMs.p50)} / ${Math.round(metrics.sendDelayMs.p95)} ms`,
    ],
    ['Other-language lines marked', `${metrics.otherLanguage.caught}/${metrics.otherLanguage.of}`],
    ['English lines wrongly marked', String(metrics.falseOtherLanguage)],
  ];
}

/**
 * Prints saved results side by side: one column per label and variant.
 *
 * @param labels The labels to compare.
 * Called from: main()
 */
function printReport(labels: string[]): void {
  for (const variant of VARIANTS) {
    const columns = labels.flatMap((label) => {
      const file = path.join(RESULTS_DIR, `${label}-${variant}.json`);
      return existsSync(file)
        ? [[label, JSON.parse(readFileSync(file, 'utf8')).metrics as CallMetrics] as const]
        : [];
    });
    if (columns.length === 0) continue;
    console.log(`\n${variant}`);
    console.log(`| Metric | ${columns.map(([label]) => label).join(' | ')} |`);
    console.log(`|---|${columns.map(() => '---').join('|')}|`);
    const table = columns.map(([, metrics]) => rows(metrics));
    table[0]!.forEach(([name], index) => {
      console.log(`| ${name} | ${table.map((column) => column[index]![1]).join(' | ')} |`);
    });
  }
}

/**
 * Runs the measurement from the command line.
 *
 * Called from: the command line
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      label: { type: 'string', default: 'current' },
      variant: { type: 'string', default: 'all' },
      src: { type: 'string' },
      replay: { type: 'boolean', default: false },
      report: { type: 'string' },
    },
  });
  if (values.report) {
    printReport(values.report.split(','));
    return;
  }
  if (!existsSync(path.join(CALLS_DIR, 'headphones', 'timeline.json'))) {
    throw new Error('No synthetic calls yet: run `pnpm --filter web calls:make` first.');
  }
  const srcDir = path.resolve(values.src ?? WEB_DIR);
  const variants =
    values.variant === 'all' ? [...VARIANTS] : (values.variant!.split(',') as Variant[]);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const { dir, logic } = await bundle(srcDir);
  for (const variant of variants) {
    const runFile = path.join(RESULTS_DIR, `${values.label}-${variant}-run.json`);
    let run: PageRun;
    if (values.replay && existsSync(runFile)) {
      run = JSON.parse(readFileSync(runFile, 'utf8')) as PageRun;
    } else {
      console.log(`${values.label} / ${variant}: playing the call (real time)…`);
      run = await record(variant, dir);
      writeFileSync(runFile, JSON.stringify(run));
    }
    const metrics = score(variant, run, logic);
    writeFileSync(
      path.join(RESULTS_DIR, `${values.label}-${variant}.json`),
      JSON.stringify(
        { label: values.label, variant, src: srcDir, at: new Date().toISOString(), metrics },
        null,
        1,
      ),
    );
    console.log(
      `${values.label} / ${variant}: scored (${run.events.filter((event) => event.type === 'final').length} final lines)`,
    );
  }
  printReport([values.label!]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
