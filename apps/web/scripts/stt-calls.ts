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
 * Depends on: scripts/lib/worker-run.ts (the real worker in Chromium), call-replay.ts, call-metrics.ts,
 *             call-script.ts, scripts/make-calls.ts (paths)
 * Architecture: docs/decisions/ADR-0063-synthetic-call-harness.md
 *
 * Privacy: the voices are text-to-speech; still, only numbers are printed. Recordings of what the engine
 * heard and the results stay in apps/web/eval-results/calls/ (git-ignored). No Claude request is sent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readWav } from './lib/call-audio';
import {
  computeCallMetrics,
  percentileOf,
  type CallMetrics,
  type CountOf,
  type TimedScriptLine,
} from './lib/call-metrics';
import { replayCall, type CallLogic } from './lib/call-replay';
import { expectedQuestions, type PlacedLine } from './lib/call-script';
import {
  WEB_DIR,
  bundleCheckout,
  playThroughWorker,
  type AccurateOption,
  type PageRun,
} from './lib/worker-run';
import { CALLS_DIR, VARIANTS, type Variant } from './make-calls';

/** Where results go (git-ignored). */
const RESULTS_DIR = path.join(CALLS_DIR, 'results');

/**
 * Plays one variant through the worker in Chromium (scripts/lib/worker-run.ts).
 *
 * @param variant   The variant.
 * @param bundleDir The bundle folder.
 * @param accurate  v1.4 Phase 5a: run the accurate engine with these settings, or null.
 * @returns What the page recorded.
 * Called from: main()
 */
async function record(
  variant: Variant,
  bundleDir: string,
  accurate: AccurateOption | null,
): Promise<PageRun> {
  return playThroughWorker(
    {
      you: readWav(path.join(CALLS_DIR, variant, 'you.wav')).samples,
      them: readWav(path.join(CALLS_DIR, variant, 'them.wav')).samples,
    },
    bundleDir,
    accurate,
  );
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
  // Results saved before the field was named count used split.
  const of = (item: CountOf & { split?: number }) => `${item.count ?? item.split}/${item.of}`;
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

/** The accurate engine's numbers for the report (ADR-0066). */
interface AccurateSummary {
  /** Decoding threads. */
  threads: number;
  /** Model loading, ms. */
  loadMs: number;
  /** "Them" lines: decode ms p50 / p95. */
  themMs: [number, number];
  /** "Them" lines: from final line to new words, ms p50 / p95 (queue included). */
  themWaitMs: [number, number];
  /** "Them" lines decoded. */
  themLines: number;
  /** Seconds of decoding per second of "them" audio (one decode at a time). */
  themRtf: number;
  /** The engine's CPU during the call, as a share of one core. */
  callCores: number;
  /** "You" lines rewritten after the call. */
  afterCall: AfterCall;
}

/** The "you" rewrite after the call (ADR-0066). */
interface AfterCall {
  /** Lines rewritten. */
  lines: number;
  /** From the call's end until the last one was done, ms. */
  ms: number;
  /** The engine's CPU time for them, ms. */
  cpuMs: number;
}

/**
 * Sums up the accurate engine's measurements.
 *
 * @param run A recording made with --accurate.
 * @returns The numbers for the report.
 * Called from: main()
 */
function accurateSummary(run: PageRun): AccurateSummary {
  const stats = run.accurate!;
  const them = stats.decodes.filter((decode) => decode.channel === 'them');
  const you = stats.decodes.filter((decode) => decode.channel === 'you');
  const p = (values: number[], q: number) => Math.round(percentileOf(values, q));
  const seconds = them.reduce((sum, decode) => sum + decode.seconds, 0) || 1;
  return {
    threads: stats.threads,
    loadMs: stats.loadMs,
    themMs: [
      p(
        them.map((d) => d.ms),
        50,
      ),
      p(
        them.map((d) => d.ms),
        95,
      ),
    ],
    themWaitMs: [
      p(
        them.map((d) => d.waitMs),
        50,
      ),
      p(
        them.map((d) => d.waitMs),
        95,
      ),
    ],
    themLines: them.length,
    themRtf: Math.round((them.reduce((sum, d) => sum + d.ms, 0) / 1000 / seconds) * 1000) / 1000,
    callCores: Math.round((stats.callCpuMs / Math.max(1, stats.callMs)) * 1000) / 1000,
    afterCall: { lines: you.length, ms: run.afterCallMs ?? 0, cpuMs: stats.afterCallCpuMs },
  };
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
    // ADR-0066: the accurate engine's numbers, for the runs that had it.
    const withAccurate = labels.flatMap((label) => {
      const file = path.join(RESULTS_DIR, `${label}-${variant}.json`);
      const saved = existsSync(file)
        ? (JSON.parse(readFileSync(file, 'utf8')) as { accurate?: AccurateSummary })
        : {};
      return saved.accurate ? [[label, saved.accurate] as const] : [];
    });
    if (withAccurate.length === 0) continue;
    console.log(`
| Accurate engine | ${withAccurate.map(([label]) => label).join(' | ')} |`);
    console.log(`|---|${withAccurate.map(() => '---').join('|')}|`);
    const line = (name: string, value: (a: AccurateSummary) => string) =>
      console.log(`| ${name} | ${withAccurate.map(([, a]) => value(a)).join(' | ')} |`);
    line('Threads', (a) => String(a.threads));
    line('Model load', (a) => `${a.loadMs} ms`);
    line('"Them" lines rewritten', (a) => String(a.themLines));
    line('Decode p50 / p95', (a) => `${a.themMs[0]} / ${a.themMs[1]} ms`);
    line('Final line → new words p50 / p95', (a) => `${a.themWaitMs[0]} / ${a.themWaitMs[1]} ms`);
    line('Decode time per second of speech', (a) => `${a.themRtf} s`);
    line('Engine CPU during the call (cores)', (a) => a.callCores.toFixed(3));
    line('"You" after the call: lines, time', (a) => `${a.afterCall.lines}, ${a.afterCall.ms} ms`);
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
      // v1.4 Phase 5a (ADR-0066): run the desktop app's accurate engine with this many threads.
      accurate: { type: 'string' },
      'accurate-model': {
        type: 'string',
        default: path.join(
          process.env.LOCALAPPDATA ?? '',
          'kite-stt-trial',
          'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
        ),
      },
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
  const { dir, logic } = await bundleCheckout(srcDir);
  for (const variant of variants) {
    const runFile = path.join(RESULTS_DIR, `${values.label}-${variant}-run.json`);
    let run: PageRun;
    if (values.replay && existsSync(runFile)) {
      run = JSON.parse(readFileSync(runFile, 'utf8')) as PageRun;
    } else {
      console.log(`${values.label} / ${variant}: playing the call (real time)…`);
      run = await record(
        variant,
        dir,
        values.accurate
          ? { threads: Number(values.accurate), modelDir: values['accurate-model']! }
          : null,
      );
      writeFileSync(runFile, JSON.stringify(run));
    }
    const metrics = score(variant, run, logic);
    writeFileSync(
      path.join(RESULTS_DIR, `${values.label}-${variant}.json`),
      JSON.stringify(
        {
          label: values.label,
          variant,
          src: srcDir,
          at: new Date().toISOString(),
          metrics,
          ...(run.accurate ? { accurate: accurateSummary(run) } : {}),
        },
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
