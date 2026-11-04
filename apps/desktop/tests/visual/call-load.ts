/**
 * File: apps/desktop/tests/visual/call-load.ts
 * Purpose: v1.1.0 item 30: the desktop app's memory and CPU during a simulated call, on the real shell
 *          (dev build, temporary profile) and the rig's real call page (real speech engine, real
 *          punctuation pass), with a recording on a loop as the microphone. Prints numbers only: it
 *          never saves or prints a word of what it hears, and takes no captures.
 *          Usage: start the rig (apps/web/tests/visual/overlay-rig.ts), then
 *                 `pnpm --filter web exec tsx ../desktop/tests/visual/call-load.ts [minutes] [<model folder>]`
 *          With a model folder the accurate engine runs as well (KITE_ACCURATE_MODEL_DIR). The folder
 *          must hold the app's own checked download, "<name>.ok" markers included, or the app reports
 *          the model as not downloaded and the run stops at once.
 * Used by: the developer before a release; docs/testing/benchmark-results.md
 * Depends on: @playwright/test (_electron)
 * Architecture: docs/decisions/ADR-0044-transcript-auto-punctuation-cleanup.md
 *
 * "Them" is this computer's real sound, in memory only, as in any call: nothing is kept (the rig's
 * session does not save its transcript).
 */
import { mkdtempSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

/** apps/desktop. */
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** An official test recording (apps/web/tests/fixtures/audio/SOURCES.md), played as the microphone. */
const RECORDING = path.join(APP_DIR, '..', 'web', 'tests', 'fixtures', 'audio', '0.wav');

/** How long the call runs, in minutes. */
const MINUTES = Number(process.argv[2] ?? 10);

/** The accurate engine's model folder, if it should run. */
const MODEL_DIR = process.argv[3];

/** The part of the shell's bridge used here. */
interface ShellWindow {
  /** The bridge. */
  kiteDesktop: {
    /**
     * Opens a page in the main window.
     *
     * @param page The page's path.
     * @returns When asked.
     */
    openPagesWindow: (page: string) => Promise<void>;
    /**
     * Whether the accurate engine's model is ready.
     *
     * @returns Its state.
     */
    accurateStatus: () => Promise<{
      /** 'ready' once the model is on this computer. */
      state: string;
    }>;
  };
}

/** The rig. */
const KITE_URL = 'http://localhost:3123/';

/** How often the numbers are read, in ms. */
const SAMPLE_MS = 15_000;

/** How many samples make a minute. */
const PER_MINUTE = 60_000 / SAMPLE_MS;

/**
 * Waits.
 *
 * @param ms Milliseconds.
 * @returns When done.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the call and prints the numbers.
 *
 * @returns When done.
 */
async function main(): Promise<void> {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnv } = process.env;
  const app = await electron.launch({
    args: [
      APP_DIR,
      `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'kite-call-load-'))}`,
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${RECORDING}`,
    ],
    env: {
      ...parentEnv,
      KITE_URL,
      KITE_NO_UPDATE_CHECK: '1',
      ...(MODEL_DIR ? { KITE_ACCURATE_MODEL_DIR: MODEL_DIR } : {}),
    },
  });
  try {
    const panel = await app.firstWindow();
    await panel.waitForLoadState();
    const opened = app.waitForEvent('window');
    await panel.evaluate(() => (window as never as ShellWindow).kiteDesktop.openPagesWindow('/'));
    const call = await opened;
    await call.waitForLoadState();
    // The shell opens only the app's own pages by name; the rig's call page is reached from there.
    // refine.ts logs each accurate pass with its time and whether the line changed, never its words.
    const passes: { ms: number; changed: boolean }[] = [];
    let skipped = 0;
    call.on('console', (message) => {
      const [label, detail] = message.args();
      if (!label || !detail) return;
      void Promise.all([label.jsonValue(), detail.jsonValue()]).then(([name, value]) => {
        if (name === 'stt: accurate pass') passes.push(value as (typeof passes)[number]);
        if (name === 'stt: accurate pass skipped') skipped += 1;
      });
    });
    await call.goto(`${KITE_URL}call`);
    await call.getByRole('button', { name: 'Connect' }).click({ timeout: 300_000 });
    await call.getByRole('button', { name: 'Go live' }).click({ timeout: 60_000 });
    await wait(10_000);
    const accurateState = await call.evaluate(() =>
      (window as never as ShellWindow).kiteDesktop.accurateStatus().then((status) => status.state),
    );
    if (MODEL_DIR && accurateState !== 'ready') {
      // Stops here rather than spend the whole run measuring the wrong thing.
      throw new Error(
        `The accurate engine's model is ${accurateState}, so this run cannot measure it.`,
      );
    }
    console.info(
      `[call-load] live, accurate engine ${MODEL_DIR ? 'on' : 'off'}, model ${accurateState}, ${MINUTES} min`,
    );

    const samples: { cpu: number; memoryMb: number; privateMb: number; lines: number }[] = [];
    // CPU seconds per process at the last sample, so each sample is its own process's real use.
    let lastSeconds = new Map<number, number>();
    let lastTime = Date.now();
    // The accurate engine's own process: it starts only when a line is sent to it.
    let accuratePeakMb = 0;
    const end = Date.now() + MINUTES * 60_000;
    while (Date.now() < end) {
      await wait(SAMPLE_MS);
      const metrics = await app.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().map((metric) => ({
          pid: metric.pid,
          cpuSeconds: metric.cpu.cumulativeCPUUsage ?? 0,
          memoryKb: metric.memory.workingSetSize,
          privateKb: metric.memory.privateBytes ?? 0,
          // utilityProcess.fork's serviceName option is reported here as the process's name.
          accurate: metric.name === 'Kite accurate transcription',
        })),
      );
      const now = Date.now();
      const usedSeconds = metrics.reduce(
        (sum, metric) =>
          sum + metric.cpuSeconds - (lastSeconds.get(metric.pid) ?? metric.cpuSeconds),
        0,
      );
      const elapsedSeconds = (now - lastTime) / 1000;
      lastSeconds = new Map(metrics.map((metric) => [metric.pid, metric.cpuSeconds]));
      lastTime = now;
      const engine = metrics.find((metric) => metric.accurate);
      if (engine) accuratePeakMb = Math.max(accuratePeakMb, engine.memoryKb / 1024);
      samples.push({
        cpu: (usedSeconds / elapsedSeconds) * 100,
        memoryMb: metrics.reduce((sum, metric) => sum + metric.memoryKb, 0) / 1024,
        privateMb: metrics.reduce((sum, metric) => sum + metric.privateKb, 0) / 1024,
        lines: await call.getByRole('listitem', { name: /said$/ }).count(),
      });
    }
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    // The first sample has no earlier reading to compare with.
    const cpu = samples.slice(1).map((sample) => sample.cpu);
    const memory = samples.map((sample) => sample.memoryMb);
    const privateMemory = samples.map((sample) => sample.privateMb);
    console.info(
      '[call-load]',
      JSON.stringify({
        samples: samples.length,
        // CPU seconds used per second, as a percentage: 100 is one whole core of this computer's.
        cpuMeanPercentOfOneCore: Math.round(mean(cpu)),
        cpuPeakPercentOfOneCore: Math.round(Math.max(...cpu)),
        // Each minute's mean, so a slow start can be told from steady use.
        cpuByMinute: Array.from({ length: Math.ceil(cpu.length / PER_MINUTE) }, (_, minute) =>
          Math.round(mean(cpu.slice(minute * PER_MINUTE, (minute + 1) * PER_MINUTE))),
        ),
        logicalCores: cpus().length,
        // Working sets count pages that processes share more than once; private memory does not.
        memoryStartMb: Math.round(memory[0]!),
        memoryEndMb: Math.round(memory.at(-1)!),
        memoryPeakMb: Math.round(Math.max(...memory)),
        privateStartMb: Math.round(privateMemory[0]!),
        privateEndMb: Math.round(privateMemory.at(-1)!),
        privatePeakMb: Math.round(Math.max(...privateMemory)),
        bubblesAtEnd: samples.at(-1)!.lines,
        accurateEnginePeakMb: Math.round(accuratePeakMb),
        accuratePasses: passes.length,
        accurateLinesChanged: passes.filter((pass) => pass.changed).length,
        accurateSkipped: skipped,
        accurateMsMedian: [...passes].sort((a, b) => a.ms - b.ms)[passes.length >> 1]?.ms ?? null,
      }),
    );
    // The model can be ready and the engine still never asked to do anything, or its text never used.
    if (MODEL_DIR && accuratePeakMb === 0) {
      throw new Error('The accurate engine never started, so this run did not measure it.');
    }
    if (MODEL_DIR && !passes.some((pass) => pass.changed)) {
      throw new Error('The accurate engine started but refined no line.');
    }
  } finally {
    await app.close().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'failed');
  process.exitCode = 1;
});
