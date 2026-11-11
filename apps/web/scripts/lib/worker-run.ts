/**
 * File: apps/web/scripts/lib/worker-run.ts
 * Purpose: Plays two audio channels ("you" and "them", 16 kHz mono) through the app's real speech worker
 *          (stt.worker.ts and sherpa-onnx WebAssembly in Chromium) at real-time speed, side by side as in a
 *          call, with the end-of-turn model (Smart Turn, ADR-0065) and optionally the desktop app's accurate
 *          engine (Parakeet, ADR-0066), and records every message with the time it reached the page.
 *          Moved here from scripts/stt-calls.ts (1.5.2, ADR-0070) so the synthetic calls and the real-call
 *          replay (scripts/real-call.ts) share one player.
 * Used by: scripts/stt-calls.ts (synthetic calls), scripts/real-call.ts (a real call's stereo file)
 * Depends on: src/core/stt (worker, models), src/core/turn/turn.worker.ts, scripts/lib/accurate-engine.ts,
 *             @playwright/test (Chromium), esbuild
 * Architecture: docs/decisions/ADR-0063-synthetic-call-harness.md, ADR-0070
 *
 * Privacy: text stays in memory and in the caller's git-ignored result files; nothing is printed here.
 * No Claude request is sent.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import * as sttModels from '../../src/core/stt/models';
import { DEFAULT_STT_MODEL, getSttModel, resolveDownloads } from '../../src/core/stt/models';
import { startAccurateEngine, type AccurateDecode } from './accurate-engine';
import type { CallEvent, CallLogic } from './call-replay';

/** apps/web of this checkout. */
export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What the page returns after a call. */
export interface PageRun {
  /** Every partial and final message, with its arrival time. */
  events: CallEvent[];
  /** When the first sample was handed over (Unix ms): the call's time zero. */
  startedAt: number;
  /** v1.4 Phase 5a: when the last sample was handed over (Unix ms; recordings since then). */
  endedAt?: number;
  /** v1.4 Phase 5a: from the call's end until every "you" line was rewritten, ms (with --accurate). */
  afterCallMs?: number;
  /** v1.4 Phase 5a (ADR-0066): the accurate engine's measurements (with --accurate). */
  accurate?: AccurateStats;
  /** 1.5.2 (ADR-0070): the echo canceller's state as the worker last reported it. */
  echoCancel?: string;
  /** 1.5.2: the worker's backlog messages [arrival Unix ms, state, worst wait ms]. */
  backlog?: [number, string, number][];
}

/** The accurate engine during one call (ADR-0066). */
export interface AccurateStats {
  /** Decoding threads. */
  threads: number;
  /** Model loading, ms. */
  loadMs: number;
  /** Every decode. */
  decodes: AccurateDecode[];
  /** The engine process's CPU time during the call (to its end), ms. */
  callCpuMs: number;
  /** The call's length, ms. */
  callMs: number;
  /** The engine process's CPU time for the "you" lines after the call, ms. */
  afterCallCpuMs: number;
}

/** --accurate settings. */
export interface AccurateOption {
  /** Decoding threads. */
  threads: number;
  /** The Parakeet model folder. */
  modelDir: string;
}

/** The two channels to play, 16 kHz mono. */
export interface Tracks {
  /** The microphone. */
  you: Float32Array;
  /** The other side. */
  them: Float32Array;
}

/** The page side: the real worker, fed two channels side by side at real-time speed. */
const PAGE = `
const worker = new Worker('/bundle/stt.worker.js');
const events = [];
const backlog = [];
let echoCancel = 'off';
const accuratePending = [];
const youAudio = [];
const pongs = new Map();
let onReady;
// ADR-0066: the accurate engine, through the local server as raw samples (null when not running).
window.accurateDecode = null;
window.useAccurate = () => {
  window.accurateDecode = async (channel, audio) => {
    const response = await fetch('/accurate/' + channel, { method: 'POST', body: audio });
    return (await response.json()).text;
  };
};
const ready = new Promise((resolve, reject) => { onReady = { resolve, reject }; });
const unix = () => performance.timeOrigin + performance.now();
// v1.4 (ADR-0065): the end-of-turn model, as LivePage.tsx runs it (judged at a pause, used by the final).
let turn = null;
const turnWaiting = new Map();
let turnId = 0;
let early = null;
const judge = (audio) => new Promise((resolve) => {
  if (!turn) return resolve(null);
  const id = ++turnId;
  turnWaiting.set(id, resolve);
  turn.postMessage({ type: 'judge', id, audio }, [audio.buffer]);
});
window.startTurn = () => {
  turn = new Worker('/bundle/turn.worker.js');
  turn.onmessage = ({ data }) => {
    const resolve = turnWaiting.get(data.id);
    if (resolve) { turnWaiting.delete(data.id); resolve(data.type === 'result' ? data.probability : null); }
  };
  turn.postMessage({ type: 'load' });
};
// 1.5.2 (ADR-0070): the punctuation model, as LivePage.tsx runs it at a pause and at a final line.
let punct = null;
const punctWaiting = new Map();
let punctId = 0;
let themGrey = '';
window.startPunct = () => {
  punct = new Worker('/bundle/punct.worker.js');
  punct.onmessage = ({ data }) => {
    if (data.type !== 'result' && data.type !== 'line-failed') return;
    const resolve = punctWaiting.get(data.id);
    if (resolve) { punctWaiting.delete(data.id); resolve(data.type === 'result' ? data.text : null); }
  };
  punct.postMessage({ type: 'load' });
};
const punctuate = (words) => {
  if (!punct || !words) return;
  const id = ++punctId;
  new Promise((resolve) => { punctWaiting.set(id, resolve); punct.postMessage({ type: 'punctuate', id, text: words }); })
    .then((text) => { if (text) events.push({ type: 'punct', channel: 'them', text, words, tStart: null, arrivedAt: unix() }); });
};
let themPaused = false;
worker.onmessage = ({ data }) => {
  if (data.type === 'partial' && data.channel === 'them') {
    themGrey = data.text;
    if (themPaused && data.text) punctuate(data.text);
  }
  if (data.channel === 'them' && (data.type === 'resume' || data.type === 'final')) themPaused = false;
  if (data.type === 'pause' && data.channel === 'them') themPaused = true;
  if (data.type === 'resume') events.push({ type: 'resume', channel: data.channel, text: '', tStart: null, arrivedAt: unix() });
  if (data.type === 'pause' && data.channel === 'them') punctuate(themGrey);
  if (data.type === 'final' && data.channel === 'them') punctuate(data.text);
  if (data.type === 'pause' && data.channel === 'them') {
    const speechEnd = data.speechEnd;
    events.push({ type: 'pause', channel: 'them', text: '', tStart: null, speechEnd, arrivedAt: unix() });
    early = { speechEnd, probability: judge(data.recent) };
    // 1.5.2: the early judgment's own arrival, for a turn decided at the pause (ADR-0070).
    early.probability.then((probability) => events.push({ type: 'turn-early', channel: 'them', text: '', tStart: null, speechEnd, probability, arrivedAt: unix() }));
  }
  if (data.type === 'final' && data.channel === 'them' && data.recent && data.recent.length > 0) {
    const judged = early && Math.abs(early.speechEnd - data.speechEnd) <= 300 ? early.probability : judge(data.recent);
    const speechEnd = data.speechEnd;
    judged.then((probability) => events.push({ type: 'turn', channel: 'them', text: '', tStart: null, speechEnd, probability, arrivedAt: unix() }));
  }
  // v1.4 Phase 5a (ADR-0066): with --accurate, "them" lines go to the accurate engine as they become final
  // (as LivePage.tsx does), "you" lines after the call.
  if (data.type === 'final' && data.audio && window.accurateDecode && data.audio.length <= 480000) {
    if (data.channel === 'them') {
      const tEnd = data.tEnd;
      accuratePending.push(window.accurateDecode('them', data.audio).then((text) => {
        if (text !== null) events.push({ type: 'refine', channel: 'them', text, tStart: null, tEnd, arrivedAt: unix() });
      }));
    } else {
      youAudio.push({ tEnd: data.tEnd, audio: data.audio });
    }
  }
  if (data.type === 'ready') onReady.resolve(data.load);
  if (data.type === 'error') onReady.reject(new Error(data.code + ': ' + data.message));
  if (data.type === 'partial') events.push({ type: 'partial', channel: data.channel, text: data.text, tStart: data.tStart, arrivedAt: unix() });
  if (data.type === 'final') events.push({ type: 'final', channel: data.channel, text: data.text, tStart: data.tStart, tEnd: data.tEnd, speechEnd: data.speechEnd, ...(data.confidence ? { confidence: data.confidence } : {}), arrivedAt: unix() });
  if (data.type === 'backlog') backlog.push([unix(), data.backlog.state, data.backlog.waitMs ?? 0]);
  if (data.type === 'stats' && data.stats.echoCancel) echoCancel = data.stats.echoCancel;
  if (data.type === 'pong') pongs.get(data.id)?.();
};
window.callRun = {
  load: (message) => { worker.postMessage(message); return ready; },
  async run() {
    const you = new Float32Array(await (await fetch('/pcm/you')).arrayBuffer());
    const them = new Float32Array(await (await fetch('/pcm/them')).arrayBuffer());
    const total = Math.max(you.length, them.length);
    const chunk = 1600;
    // With --accurate the channels are attached as the app attaches them, so final lines carry their audio.
    const ports = {};
    if (window.accurateDecode) {
      for (const channel of ['you', 'them']) {
        const pipe = new MessageChannel();
        worker.postMessage({ type: 'attach', channel, port: pipe.port2, inputSampleRate: 16000, keepAudio: true }, [pipe.port2]);
        ports[channel] = pipe.port1;
      }
    }
    const startedAt = unix();
    const start = performance.now();
    let clock = 1;
    for (let i = 0, n = 0; i < total; i += chunk, n += 1) {
      clock += chunk / 16000;
      for (const [channel, pcm] of [['you', you], ['them', them]]) {
        const samples = new Float32Array(chunk);
        samples.set(pcm.subarray(i, Math.min(i + chunk, pcm.length)));
        if (ports[channel]) ports[channel].postMessage({ samples, endTime: clock }, [samples.buffer]);
        else worker.postMessage({ type: 'accept', channel, samples, endTime: clock }, [samples.buffer]);
      }
      const wait = start + (n + 1) * 100 - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    // Port messages travel apart from worker messages: let the last chunks arrive before detaching.
    if (window.accurateDecode) await new Promise((resolve) => setTimeout(resolve, 1000));
    worker.postMessage({ type: 'detach', channel: 'you' });
    worker.postMessage({ type: 'detach', channel: 'them' });
    await new Promise((resolve) => { pongs.set(1, resolve); worker.postMessage({ type: 'ping', id: 1 }); });
    const endedAt = unix();
    // After the call (ADR-0066): the "them" passes still running, then every "you" line, one at a time.
    await Promise.all(accuratePending);
    for (const { tEnd, audio } of youAudio) {
      const text = await window.accurateDecode('you', audio);
      if (text !== null) events.push({ type: 'refine', channel: 'you', text, tStart: null, tEnd, arrivedAt: unix() });
    }
    return { events, backlog, echoCancel, startedAt, endedAt, afterCallMs: youAudio.length > 0 ? Math.round(unix() - endedAt) : 0 };
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
 * @param extra  More `export … from` lines for the logic bundle, given a function that quotes a path
 *               under that checkout's src/ (the real-call replay needs more of the app's modules).
 * @returns The bundle folder (stt.worker.js) and the loaded logic.
 * Called from: stt-calls.ts main(), real-call.ts main()
 */
export async function bundleCheckout(
  srcDir: string,
  extra: (file: (relative: string) => string) => string[] = () => [],
): Promise<{ dir: string; logic: CallLogic }> {
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
    ...extra(file),
  ].join('\n');
  // 1.5.2 (ADR-0070): the punctuation worker, when the version measured reads lines through it.
  if (
    existsSync(path.join(srcDir, 'src', 'core', 'punctuation', 'punct.worker.ts')) &&
    readFileSync(path.join(srcDir, 'src', 'core', 'transcript', 'transcript.ts'), 'utf8').includes(
      'setPunctuated',
    )
  ) {
    await build({
      ...common,
      platform: 'browser',
      format: 'iife',
      entryPoints: [path.join(srcDir, 'src', 'core', 'punctuation', 'punct.worker.ts')],
      outfile: path.join(dir, 'punct.worker.js'),
    });
  }
  // v1.4 (ADR-0065): the end-of-turn worker, when the version measured has one.
  if (existsSync(path.join(srcDir, 'src', 'core', 'turn', 'turn.worker.ts'))) {
    await build({
      ...common,
      platform: 'browser',
      format: 'iife',
      entryPoints: [path.join(srcDir, 'src', 'core', 'turn', 'turn.worker.ts')],
      outfile: path.join(dir, 'turn.worker.js'),
    });
  }
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
 * Plays two channels through the worker in Chromium, in real time.
 *
 * @param tracks    The channels (16 kHz mono).
 * @param bundleDir The bundle folder (bundleCheckout()).
 * @param accurate  Run the accurate engine with these settings, or null.
 * @param echoCancel 1.5.2: ask the worker for its echo canceller (when the checkout has one).
 * @returns What the page recorded.
 * Called from: stt-calls.ts record(), real-call.ts main()
 */
export async function playThroughWorker(
  tracks: Tracks,
  bundleDir: string,
  accurate: AccurateOption | null,
  echoCancel = false,
): Promise<PageRun> {
  const engine = accurate
    ? await startAccurateEngine(accurate.threads, accurate.modelDir, bundleDir)
    : null;
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (engine && req.method === 'POST' && pathname.startsWith('/accurate/')) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const bytes = Buffer.concat(chunks);
        // Copied into its own buffer: a Float32Array needs 4-byte alignment.
        const samples = new Float32Array(new Uint8Array(bytes).buffer);
        void engine
          .transcribe(pathname.endsWith('/you') ? 'you' : 'them', samples)
          .then((text) =>
            res
              .writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ text })),
          );
      });
      return;
    }
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
    // ONNX Runtime's loader imports an .mjs file, which a browser takes only as JavaScript.
    const type = file.endsWith('.wasm')
      ? 'application/wasm'
      : file.endsWith('.js') || file.endsWith('.mjs')
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
    if (engine) {
      await page.evaluate(() => (window as unknown as { useAccurate: () => void }).useAccurate());
    }
    if (existsSync(path.join(bundleDir, 'turn.worker.js'))) {
      await page.evaluate(() => (window as unknown as { startTurn: () => void }).startTurn());
    }
    // 1.5.2: the punctuation pass, when the checkout reads lines through it (transcript setPunctuated).
    if (existsSync(path.join(bundleDir, 'punct.worker.js'))) {
      await page.evaluate(() => (window as unknown as { startPunct: () => void }).startPunct());
    }
    const model = getSttModel(DEFAULT_STT_MODEL);
    const downloads = resolveDownloads(model, 'local', origin);
    await page.evaluate((message) => window.callRun.load(message), {
      type: 'load',
      model: model.id,
      runtime: downloads.runtime,
      files: downloads.model,
      hotwords: '',
      beamWidth: 4,
      // v1.4 (ADR-0065): "them" lines carry their recent audio when there is a turn worker.
      ...(existsSync(path.join(bundleDir, 'turn.worker.js')) ? { turnAudio: true } : {}),
      // 1.5.2 (ADR-0070): the echo canceller, when this checkout has one (served from public/aec).
      ...(echoCancel && 'aecDownloads' in sttModels
        ? { aec: (sttModels as { aecDownloads: (o: string) => unknown }).aecDownloads(origin) }
        : {}),
    });
    if (!engine) return await page.evaluate(() => window.callRun.run());
    const cpuBefore = await engine.cpuMs();
    const run = await page.evaluate(() => window.callRun.run());
    const cpuAfter = await engine.cpuMs();
    const youMs = engine.decodes
      .filter((decode) => decode.channel === 'you')
      .reduce((sum, decode) => sum + decode.ms, 0);
    const allMs = engine.decodes.reduce((sum, decode) => sum + decode.ms, 0) || 1;
    const total = cpuAfter - cpuBefore;
    return {
      ...run,
      accurate: {
        threads: accurate!.threads,
        loadMs: engine.loadMs,
        decodes: engine.decodes,
        // CPU split by decoding time between the call and after it: the engine does nothing else.
        callCpuMs: Math.round((total * (allMs - youMs)) / allMs),
        afterCallCpuMs: Math.round((total * youMs) / allMs),
        callMs: Math.round((run.endedAt ?? run.startedAt) - run.startedAt),
      },
    };
  } finally {
    engine?.stop();
    await browser.close();
    server.close();
  }
}
