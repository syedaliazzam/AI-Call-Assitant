/**
 * File: apps/web/scripts/stt-trial.ts
 * Purpose: The Day 6 speech engine trial (measure only, no product change; ADR-0027). Runs one
 *          engine over the names set and the read set, one process per run, so its CPU and memory
 *          are its own, and writes one result file:
 *          - control: the app's real stt.worker.ts and sherpa-onnx WebAssembly in Chromium, fed
 *            at real-time speed;
 *          - parakeet: NVIDIA Parakeet TDT 0.6B v2 int8 through sherpa-onnx-node, per utterance;
 *          - whisper-turbo, whisper-small: whisper.cpp large-v3-turbo q5_0 and small.en, per
 *            utterance, through whisper-server (the model stays loaded).
 *          Usage: pnpm --filter web stt:trial --engine=<id> [--terms=none|list|pack]
 *                 pnpm --filter web stt:trial --report      (prints the results table)
 *          Prepare first: bash apps/web/scripts/stt-trial-setup.sh
 * Used by: the "stt:trial" script in apps/web/package.json (by hand; never in CI)
 * Depends on: scripts/lib/stt-score.ts, src/core/stt (models, sessionHotwords, protocol),
 *             @playwright/test, esbuild; outside the repo: the downloads of stt-trial-setup.sh
 * Architecture: docs/decisions/ADR-0027-desktop-speech-engine.md; day-06 Stage 0 and Stage 1
 *
 * Privacy: never prints transcript text, only counts, rates and times. What the engines wrote
 * goes to a local result file outside the repository, for the developer only. The clips are
 * served on 127.0.0.1 during a control run and leave this computer never.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import {
  DEFAULT_STT_MODEL,
  getSttModel,
  LOCAL_MODELS_PATH,
  resolveDownloads,
  RUNTIME_PUBLIC_PATH,
  TEST_RECORDINGS,
  TEST_RECORDINGS_DIR,
} from '../src/core/stt/models';
import { buildHotwords, hotwordsText } from '../src/core/stt/sessionHotwords';
import {
  overallWer,
  parseNamesList,
  percentile,
  scoreTerms,
  type NamesSentence,
  type TermScores,
} from './lib/stt-score';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The names set. */
const STT_DIR = path.join(WEB_DIR, 'tests', 'fixtures', 'stt');
/** The app's public folder (speech runtime, model, read recordings). */
const PUBLIC_DIR = path.join(WEB_DIR, 'public');
/** Candidates and results: outside the repository. */
const TRIAL_DIR =
  process.env.KITE_STT_TRIAL_DIR ??
  path.join(process.env.LOCALAPPDATA ?? tmpdir(), 'kite-stt-trial');
/** Result files (they hold what the engines wrote: for the developer only). */
const RESULTS_DIR = path.join(TRIAL_DIR, 'results');
/** Native engines' threads: the laptop has 4 cores (ADR-0027). */
const NATIVE_THREADS = 4;
/** Logical processors of the test laptop's CPU, for CPU % (reported per whole machine). */
const LOGICAL_CPUS = 8;

/** The engines. */
const ENGINES = ['control', 'parakeet', 'whisper-turbo', 'whisper-small'] as const;
/** An engine id. */
type EngineId = (typeof ENGINES)[number];
/** Which session terms an engine gets: none, the listed terms, or the Interview pack alone. */
type TermsMode = 'none' | 'list' | 'pack';

/** Extra download beyond the current app, in bytes (model plus native runtime; ADR-0027). */
const DOWNLOAD_BYTES: Record<EngineId, number> = {
  // Already part of the app.
  control: 0,
  // The published int8 archive and the sherpa-onnx Windows addon.
  parakeet: 482_468_385 + 23_453_246,
  // The model and the whisper.cpp Windows binaries.
  'whisper-turbo': 574_041_195 + 8_361_840,
  'whisper-small': 487_614_201 + 8_361_840,
};

/** One clip of a test set. */
interface Clip {
  /** Its id: "names-07" or "read-0". */
  id: string;
  /** Which set. */
  set: 'names' | 'read';
  /** The names list's sentence number, or 0 in the read set. */
  sentenceIndex: number;
  /** What was said. */
  reference: string;
  /** The WAV file. */
  file: string;
  /** 16 kHz mono samples. */
  samples: Float32Array;
}

/** What an engine wrote for one clip, and how long the final text took. */
interface ClipResult {
  /** The clip's id. */
  id: string;
  /** The final text (never printed). */
  hypothesis: string;
  /** End of the utterance's audio → final text, in ms. */
  finalMs: number;
}

/** What an engine run returns. */
interface EngineRun {
  /** Per clip, in order. */
  clips: ClipResult[];
  /** Starting the engine and loading the model, in ms. */
  coldStartMs: number;
  /** Decode time ÷ audio time. */
  rtf: number;
  /** CPU seconds the engine used during the clips. */
  cpuSeconds: number;
  /** Largest memory of its biggest process, in MB. */
  peakMb: number;
  /** Anything the reader must know about this run. */
  note: string;
}

/** A result file. */
interface TrialResult {
  /** The engine. */
  engine: EngineId;
  /** Which session terms it had. */
  terms: TermsMode;
  /** Power state during the run. */
  power: 'plugged in' | 'on battery' | 'changed during the run';
  /** Battery percent at the start. */
  batteryPercent: number | null;
  /** When it ran (ISO). */
  at: string;
  /** Clips in the names set. */
  namesClips: number;
  /** Term accuracy on the names set. */
  scores: TermScores;
  /** Word error rate over both sets. */
  werOverall: number;
  /** Word error rate on the names set. */
  werNames: number;
  /** Word error rate on the read set. */
  werRead: number;
  /** Final-text latency, p50, ms (first clip left out). */
  finalP50Ms: number;
  /** Final-text latency, p95, ms (first clip left out). */
  finalP95Ms: number;
  /** Decode time ÷ audio time. */
  rtf: number;
  /** Share of the whole machine's CPU while the clips ran, percent. */
  cpuPercent: number;
  /** Peak memory, MB. */
  peakMb: number;
  /** Cold start, ms. */
  coldStartMs: number;
  /** Extra download, bytes. */
  downloadBytes: number;
  /** Notes. */
  note: string;
  /** What the engine wrote, per clip (local only; never printed). */
  clips: ClipResult[];
}

/**
 * Reads a 16 kHz mono 16-bit WAV.
 *
 * @param file The file.
 * @returns The samples, -1…1.
 * @throws Error when it is another format.
 * Called from: loadClips()
 */
function readWav(file: string): Float32Array {
  const bytes = readFileSync(file);
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(offset + 10);
      sampleRate = bytes.readUInt32LE(offset + 12);
      bits = bytes.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      if (sampleRate !== 16_000 || channels !== 1 || bits !== 16) {
        throw new Error(`${path.basename(file)}: expected 16 kHz mono 16-bit`);
      }
      const samples = new Float32Array(Math.floor(size / 2));
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = bytes.readInt16LE(offset + 8 + i * 2) / 32_768;
      }
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path.basename(file)}: no audio`);
}

/**
 * Loads both test sets: the recorded names sentences, then the read recordings.
 *
 * @returns The clips, and the names sentences that have a clip.
 * Called from: runTrial()
 */
function loadClips(): { clips: Clip[]; recorded: NamesSentence[] } {
  const sentences = parseNamesList(readFileSync(path.join(STT_DIR, 'names-sentences.txt'), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(STT_DIR, 'names-manifest.json'), 'utf8')) as {
    index: number;
    file: string;
  }[];
  const recorded = sentences.filter((sentence) =>
    manifest.some((clip) => clip.index === sentence.index),
  );
  const clips: Clip[] = recorded.map((sentence) => {
    const file = path.join(
      STT_DIR,
      'names-audio',
      manifest.find((clip) => clip.index === sentence.index)!.file,
    );
    return {
      id: `names-${String(sentence.index).padStart(2, '0')}`,
      set: 'names',
      sentenceIndex: sentence.index,
      reference: sentence.sentence,
      file,
      samples: readWav(file),
    };
  });
  for (const recording of TEST_RECORDINGS) {
    const file = path.join(PUBLIC_DIR, 'models', 'stt', TEST_RECORDINGS_DIR, recording.name);
    clips.push({
      id: `read-${recording.name.replace('.wav', '')}`,
      set: 'read',
      sentenceIndex: 0,
      reference: recording.transcript,
      file,
      samples: readWav(file),
    });
  }
  return { clips, recorded };
}

/**
 * The session terms as the app would use them, for the control's hotwords: the listed terms as a
 * session's key terms, or the built-in Interview vocabulary alone (Stage 4c).
 *
 * @param mode     Which terms.
 * @param recorded The recorded sentences.
 * @returns The hotwords text ('' for none).
 * Called from: runControl()
 */
function controlHotwords(mode: TermsMode, recorded: readonly NamesSentence[]): string {
  if (mode === 'none') return '';
  const keyTerms = mode === 'list' ? listedTerms(recorded).join('\n') : '';
  return hotwordsText(
    buildHotwords(
      {
        company: '',
        role: '',
        ...(mode === 'pack' ? { type: 'interview' as const } : {}),
        preferences: {
          language: 'en',
          model: 'fast',
          style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
          keyTerms,
        },
      },
      [],
    ),
  );
}

/**
 * Every listed term once.
 *
 * @param recorded The recorded sentences.
 * @returns The terms.
 * Called from: controlHotwords(), runWhisper()
 */
function listedTerms(recorded: readonly NamesSentence[]): string[] {
  return [...new Set(recorded.flatMap((sentence) => sentence.terms))];
}

/**
 * Reads a program's CPU seconds and largest memory from Windows.
 *
 * @param filter A PowerShell condition on a process, for example "$_.Id -eq 123".
 * @returns CPU seconds (all matching processes) and the largest peak memory, in MB.
 * Called from: runControl(), runWhisper()
 */
function processStats(filter: string): { cpuSeconds: number; peakMb: number } {
  const script = `$p = Get-Process | Where-Object { ${filter} }; $c = 0; $m = 0; foreach ($x in $p) { $c += $x.TotalProcessorTime.TotalSeconds; if ($x.PeakWorkingSet64 -gt $m) { $m = $x.PeakWorkingSet64 } }; "$c $m"`;
  const out = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  }).stdout;
  const [cpu = '0', peak = '0'] = out.trim().split(' ');
  return { cpuSeconds: Number(cpu), peakMb: Number(peak) / 1024 / 1024 };
}

/**
 * Reads whether the laptop runs on battery.
 *
 * @returns The state, and the charge in percent (null without a battery).
 * Called from: runTrial()
 */
function readPower(): { onBattery: boolean; percent: number | null } {
  const out = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      '$b = Get-CimInstance Win32_Battery | Select-Object -First 1; "$($b.BatteryStatus) $($b.EstimatedChargeRemaining)"',
    ],
    { encoding: 'utf8' },
  ).stdout;
  const [status, percent] = out.trim().split(' ');
  // Win32_Battery: 1 = discharging; the other values mean it is on mains power.
  return { onBattery: status === '1', percent: percent ? Number(percent) : null };
}

/**
 * Keeps Windows from sleeping during a long run, without changing any setting: a helper holds a
 * "system required" request until it is stopped.
 *
 * @returns The helper process.
 * Called from: runTrial()
 */
function keepAwake(): ChildProcess {
  const script =
    'Add-Type -Namespace K -Name P -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\'; [K.P]::SetThreadExecutionState([uint32]2147483649) | Out-Null; Start-Sleep -Seconds 7200';
  return spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
}

/** What CONTROL_PAGE puts on the page. */
interface TrialPage {
  /** Sends the load message to the worker; resolves with its load statistics. */
  load: (message: unknown) => Promise<unknown>;
  /** Feeds one clip and returns what the engine wrote and how long the final text took. */
  runClip: (id: string) => Promise<unknown>;
}

declare global {
  interface Window {
    /** Set by CONTROL_PAGE (control runs only). */
    trial: TrialPage;
  }
}

/** The page side of a control run: the real worker, fed clip by clip at real-time speed. */
const CONTROL_PAGE = `
const worker = new Worker('/bundle/stt.worker.js');
let finals = [];
let lastStats = null;
let statsWaiters = [];
const pongs = new Map();
let onReady;
const ready = new Promise((resolve, reject) => { onReady = { resolve, reject }; });
worker.onmessage = ({ data }) => {
  if (data.type === 'ready') onReady.resolve(data.load);
  if (data.type === 'error') onReady.reject(new Error(data.code + ': ' + data.message));
  if (data.type === 'final') finals.push(data.text);
  if (data.type === 'pong') pongs.get(data.id)?.();
  if (data.type === 'stats') {
    lastStats = data.stats;
    statsWaiters.splice(0).forEach((resolve) => resolve());
  }
};
let audioClock = 1;
let pingId = 0;
window.trial = {
  load: (message) => { worker.postMessage(message); return ready; },
  async runClip(id) {
    const pcm = new Float32Array(await (await fetch('/pcm/' + id)).arrayBuffer());
    finals = [];
    const chunk = 1600;
    const start = performance.now();
    for (let i = 0, n = 0; i < pcm.length; i += chunk, n += 1) {
      const samples = pcm.slice(i, i + chunk);
      audioClock += samples.length / 16000;
      worker.postMessage({ type: 'accept', channel: 'you', samples, endTime: audioClock }, [samples.buffer]);
      const wait = start + (n + 1) * 100 - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    // The newest statistics of this clip (sent about once a second), before the channel closes.
    await new Promise((resolve) => { statsWaiters.push(resolve); setTimeout(resolve, 1500); });
    const channel = lastStats?.channels?.you;
    const decodeMs = channel?.decodeMs ?? 0;
    const audioMs = channel?.audioMs ?? 0;
    const ended = performance.now();
    worker.postMessage({ type: 'detach', channel: 'you' });
    const id2 = ++pingId;
    await new Promise((resolve) => { pongs.set(id2, resolve); worker.postMessage({ type: 'ping', id: id2 }); });
    return { hypothesis: finals.join(' '), finalMs: performance.now() - ended, decodeMs, audioMs };
  },
};
`;

/**
 * The control: the app's real worker and WebAssembly engine in Chromium, at real-time speed.
 *
 * @param clips    The clips.
 * @param hotwords The hotwords text.
 * @returns The run.
 * Called from: runTrial()
 */
async function runControl(clips: readonly Clip[], hotwords: string): Promise<EngineRun> {
  const bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-stt-trial-'));
  // Classic worker (IIFE), like the app's: the runtime scripts need importScripts.
  await build({
    bundle: true,
    platform: 'browser',
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    logLevel: 'error',
    entryPoints: [path.join(WEB_DIR, 'src', 'core', 'stt', 'stt.worker.ts')],
    format: 'iife',
    outfile: path.join(bundleDir, 'stt.worker.js'),
  });
  const types: Record<string, string> = {
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
  };
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (pathname === '/') {
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end('<!doctype html><title>Kite trial</title>');
      return;
    }
    if (pathname === '/page.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(CONTROL_PAGE);
      return;
    }
    if (pathname.startsWith('/pcm/')) {
      const clip = clips.find((candidate) => candidate.id === pathname.slice(5));
      res
        .writeHead(clip ? 200 : 404)
        .end(
          clip
            ? Buffer.from(clip.samples.buffer, clip.samples.byteOffset, clip.samples.byteLength)
            : undefined,
        );
      return;
    }
    const file = pathname.startsWith('/bundle/')
      ? path.join(bundleDir, pathname.slice('/bundle/'.length))
      : pathname.startsWith(`${RUNTIME_PUBLIC_PATH}/`) ||
          pathname.startsWith(`${LOCAL_MODELS_PATH}/`)
        ? path.join(PUBLIC_DIR, pathname.slice(1))
        : '';
    if (!file || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' })
      .end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(origin);
  await page.addScriptTag({ url: '/page.js' });
  const model = getSttModel(DEFAULT_STT_MODEL);
  const downloads = resolveDownloads(model, 'local', origin);
  const load = (await page.evaluate((message) => window.trial.load(message), {
    type: 'load',
    model: model.id,
    runtime: downloads.runtime,
    files: downloads.model,
    hotwords,
    beamWidth: 4,
  })) as { totalMs: number };

  // Playwright's own Chromium only (never the developer's Chrome).
  const filter = "$_.Path -like '*ms-playwright*'";
  const before = processStats(filter);
  const results: ClipResult[] = [];
  let decodeMs = 0;
  let audioMs = 0;
  for (const clip of clips) {
    const out = (await page.evaluate((id) => window.trial.runClip(id), clip.id)) as {
      hypothesis: string;
      finalMs: number;
      decodeMs: number;
      audioMs: number;
    };
    results.push({ id: clip.id, hypothesis: out.hypothesis, finalMs: out.finalMs });
    decodeMs += out.decodeMs;
    audioMs += out.audioMs;
    console.log(`  ${clip.id} done`);
  }
  const after = processStats(filter);
  await browser.close();
  server.close();
  return {
    clips: results,
    coldStartMs: load.totalMs,
    rtf: audioMs ? decodeMs / audioMs : 0,
    cpuSeconds: after.cpuSeconds - before.cpuSeconds,
    peakMb: after.peakMb,
    note: 'Single-threaded WebAssembly, fed at real-time speed, as in a live call.',
  };
}

/**
 * Parakeet through sherpa-onnx-node, in this process.
 *
 * @param clips The clips.
 * @param terms Which session terms were asked for.
 * @returns The run.
 * Called from: runTrial()
 */
async function runParakeet(clips: readonly Clip[], terms: TermsMode): Promise<EngineRun> {
  const addonDir = path.join(TRIAL_DIR, 'node', 'node_modules', 'sherpa-onnx-win-x64');
  // The addon's DLLs are found through PATH (sherpa-onnx-node's documentation).
  process.env.PATH = `${addonDir}${path.delimiter}${process.env.PATH ?? ''}`;
  const require = createRequire(path.join(TRIAL_DIR, 'node', 'package.json'));
  const sherpa = require('sherpa-onnx-node') as {
    OfflineRecognizer: new (config: unknown) => {
      createStream: () => {
        acceptWaveform: (w: { sampleRate: number; samples: Float32Array }) => void;
      };
      decode: (stream: unknown) => void;
      getResult: (stream: unknown) => { text: string };
    };
  };
  const dir = path.join(TRIAL_DIR, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8');
  const loadStart = Date.now();
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(dir, 'encoder.int8.onnx'),
        decoder: path.join(dir, 'decoder.int8.onnx'),
        joiner: path.join(dir, 'joiner.int8.onnx'),
      },
      tokens: path.join(dir, 'tokens.txt'),
      numThreads: NATIVE_THREADS,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
    decodingMethod: 'greedy_search',
  });
  const coldStartMs = Date.now() - loadStart;
  const cpuBefore = process.cpuUsage();
  const results: ClipResult[] = [];
  let decodeMs = 0;
  let audioMs = 0;
  for (const clip of clips) {
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: 16_000, samples: clip.samples });
    const start = performance.now();
    recognizer.decode(stream);
    const hypothesis = recognizer.getResult(stream).text;
    const finalMs = performance.now() - start;
    results.push({ id: clip.id, hypothesis, finalMs });
    decodeMs += finalMs;
    audioMs += (clip.samples.length / 16_000) * 1000;
    console.log(`  ${clip.id} done`);
  }
  const cpu = process.cpuUsage(cpuBefore);
  return {
    clips: results,
    coldStartMs,
    rtf: decodeMs / audioMs,
    cpuSeconds: (cpu.user + cpu.system) / 1_000_000,
    peakMb: process.resourceUsage().maxRSS / 1024,
    note:
      terms === 'none'
        ? 'Greedy search, 4 threads.'
        : 'Greedy search, 4 threads. No session terms: the published archive has no tokenizer (bpe) to encode hotwords.',
  };
}

/**
 * A whisper.cpp model through whisper-server, which keeps it loaded.
 *
 * @param clips  The clips.
 * @param model  The model file name in the downloads folder.
 * @param prompt The initial prompt ('' for none).
 * @returns The run.
 * Called from: runTrial()
 */
async function runWhisper(
  clips: readonly Clip[],
  model: string,
  prompt: string,
): Promise<EngineRun> {
  const root = path.join(TRIAL_DIR, 'whisper');
  const exe = findFile(root, 'whisper-server.exe');
  const port = 18_765;
  const loadStart = Date.now();
  const server = spawn(
    exe,
    [
      '-m',
      path.join(TRIAL_DIR, 'downloads', model),
      '-t',
      String(NATIVE_THREADS),
      '-l',
      'en',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    { stdio: 'ignore', cwd: path.dirname(exe) },
  );
  const url = `http://127.0.0.1:${port}`;
  for (let tries = 0; ; tries += 1) {
    const up = await fetch(url).then(
      () => true,
      () => false,
    );
    if (up) break;
    if (tries > 600) throw new Error('whisper-server did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const coldStartMs = Date.now() - loadStart;
  const filter = `$_.Id -eq ${server.pid}`;
  const before = processStats(filter);
  const results: ClipResult[] = [];
  let decodeMs = 0;
  let audioMs = 0;
  for (const clip of clips) {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(clip.file)], { type: 'audio/wav' }), 'clip.wav');
    form.append('response_format', 'json');
    form.append('language', 'en');
    form.append('temperature', '0');
    if (prompt) form.append('prompt', prompt);
    const start = performance.now();
    const response = await fetch(`${url}/inference`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`whisper-server: HTTP ${response.status}`);
    const { text } = (await response.json()) as { text: string };
    const finalMs = performance.now() - start;
    results.push({ id: clip.id, hypothesis: text.trim(), finalMs });
    decodeMs += finalMs;
    audioMs += (clip.samples.length / 16_000) * 1000;
    console.log(`  ${clip.id} done`);
  }
  const after = processStats(filter);
  server.kill();
  return {
    clips: results,
    coldStartMs,
    rtf: decodeMs / audioMs,
    cpuSeconds: after.cpuSeconds - before.cpuSeconds,
    peakMb: after.peakMb,
    note: `Default whisper-server decoding, ${NATIVE_THREADS} threads${prompt ? ', listed terms as the initial prompt' : ''}.`,
  };
}

/**
 * Finds a file by name under a folder.
 *
 * @param root The folder.
 * @param name The file name.
 * @returns Its path.
 * @throws Error when it is not there (run stt-trial-setup.sh first).
 * Called from: runWhisper()
 */
function findFile(root: string, name: string): string {
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
      return path.join(entry.parentPath, entry.name);
    }
  }
  throw new Error(`${name} not found under ${root}: run scripts/stt-trial-setup.sh`);
}

/**
 * Runs one engine and writes its result file.
 *
 * @param engine The engine.
 * @param terms  Its session terms.
 * @returns Nothing; prints one line of numbers (never text).
 * Called from: main()
 */
async function runTrial(engine: EngineId, terms: TermsMode): Promise<void> {
  const { clips, recorded } = loadClips();
  const powerBefore = readPower();
  const awake = keepAwake();
  console.log(
    `${engine}, terms ${terms}: ${clips.length} clips, ${powerBefore.onBattery ? 'on battery' : 'plugged in'}`,
  );
  const started = Date.now();
  let run: EngineRun;
  try {
    if (engine === 'control') {
      run = await runControl(clips, controlHotwords(terms, recorded));
    } else if (engine === 'parakeet') {
      run = await runParakeet(clips, terms);
    } else {
      const glossary = `Glossary: ${listedTerms(recorded).join(', ')}.`;
      run = await runWhisper(
        clips,
        engine === 'whisper-turbo' ? 'ggml-large-v3-turbo-q5_0.bin' : 'ggml-small.en.bin',
        terms === 'list' ? glossary : '',
      );
    }
  } finally {
    awake.kill();
  }
  const wallSeconds = (Date.now() - started) / 1000;
  const powerAfter = readPower();

  const byId = new Map(run.clips.map((clip) => [clip.id, clip]));
  const pairs = (set: Clip['set']) =>
    clips
      .filter((clip) => clip.set === set)
      .map((clip) => ({
        reference: clip.reference,
        hypothesis: byId.get(clip.id)?.hypothesis ?? '',
      }));
  const hypotheses = new Map(
    clips
      .filter((clip) => clip.set === 'names')
      .map((clip) => [clip.sentenceIndex, byId.get(clip.id)?.hypothesis ?? '']),
  );
  // The first clip warms the engine up: it is left out of the latency percentiles.
  const latencies = run.clips.slice(1).map((clip) => clip.finalMs);
  const result: TrialResult = {
    engine,
    terms,
    power:
      powerBefore.onBattery !== powerAfter.onBattery
        ? 'changed during the run'
        : powerBefore.onBattery
          ? 'on battery'
          : 'plugged in',
    batteryPercent: powerBefore.percent,
    at: new Date().toISOString(),
    namesClips: recorded.length,
    scores: scoreTerms(recorded, hypotheses),
    werOverall: overallWer([...pairs('names'), ...pairs('read')]),
    werNames: overallWer(pairs('names')),
    werRead: overallWer(pairs('read')),
    finalP50Ms: percentile(latencies, 50),
    finalP95Ms: percentile(latencies, 95),
    rtf: run.rtf,
    cpuPercent: (run.cpuSeconds / wallSeconds / LOGICAL_CPUS) * 100,
    peakMb: run.peakMb,
    coldStartMs: run.coldStartMs,
    downloadBytes: DOWNLOAD_BYTES[engine],
    note: run.note,
    clips: run.clips,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const name = `${engine}-${terms}-${result.power.replaceAll(' ', '-')}-${Date.now()}.json`;
  writeFileSync(path.join(RESULTS_DIR, name), JSON.stringify(result, null, 2));
  console.log(tableRow(result));
}

/**
 * Formats a share as a percentage.
 *
 * @param score The score.
 * @returns For example "63.2% (43/68)".
 * Called from: tableRow()
 */
function share(score: { right: number; total: number }): string {
  const percent = score.total ? (score.right / score.total) * 100 : 0;
  return `${percent.toFixed(1)}% (${score.right}/${score.total})`;
}

/**
 * One result as a table row (numbers only).
 *
 * @param r The result.
 * @returns The Markdown row.
 * Called from: runTrial(), report()
 */
function tableRow(r: TrialResult): string {
  return `| ${r.engine} | ${r.terms} | ${r.power} | ${share(r.scores.all)} | ${share(r.scores.names)} | ${share(r.scores.tech)} | ${(r.werOverall * 100).toFixed(1)}% | ${(r.werNames * 100).toFixed(1)}% | ${(r.werRead * 100).toFixed(1)}% | ${Math.round(r.finalP50Ms)} / ${Math.round(r.finalP95Ms)} ms | ${r.rtf.toFixed(2)} | ${r.cpuPercent.toFixed(0)}% | ${Math.round(r.peakMb)} MB | ${(r.coldStartMs / 1000).toFixed(1)} s | ${Math.round(r.downloadBytes / 1_000_000)} MB |`;
}

/**
 * Prints every result so far as a table (the newest run of each engine, terms and power state).
 *
 * @returns Nothing.
 * Called from: main()
 */
function report(): void {
  console.log(
    '| Engine | Terms | Power | Name accuracy (all listed) | Names | Tech terms | WER overall | WER names set | WER read set | Final text p50 / p95 | RTF | CPU (of 8 threads) | Peak memory | Cold start | Extra download |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const newest = new Map<string, TrialResult>();
  for (const file of existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).sort() : []) {
    const result = JSON.parse(readFileSync(path.join(RESULTS_DIR, file), 'utf8')) as TrialResult;
    newest.set(`${result.engine}|${result.terms}|${result.power}`, result);
  }
  const order = (r: TrialResult) => `${r.power}|${ENGINES.indexOf(r.engine)}|${r.terms}`;
  for (const result of [...newest.values()].sort((a, b) => order(a).localeCompare(order(b)))) {
    console.log(tableRow(result));
  }
}

/**
 * Reads the arguments and runs.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      engine: { type: 'string' },
      terms: { type: 'string', default: 'none' },
      report: { type: 'boolean' },
    },
  });
  if (values.report) {
    report();
    return;
  }
  const engine = values.engine as EngineId;
  const terms = values.terms as TermsMode;
  if (!ENGINES.includes(engine) || !['none', 'list', 'pack'].includes(terms)) {
    throw new Error(`Usage: --engine=${ENGINES.join('|')} [--terms=none|list|pack] | --report`);
  }
  await runTrial(engine, terms);
}

main().catch((error: unknown) => {
  // The message names files and codes only; transcript text never reaches an error here.
  console.error(`stt-trial: failed (${error instanceof Error ? error.message : 'unknown'})`);
  process.exitCode = 1;
});
