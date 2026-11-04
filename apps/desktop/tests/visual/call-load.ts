/**
 * File: apps/desktop/tests/visual/call-load.ts
 * Purpose: v1.1.0 item 30: the desktop app's memory and CPU during a simulated call, on the real shell
 *          (dev build, temporary profile) and the rig's real call page (real speech engine, real
 *          punctuation pass), with a recording on a loop as the microphone. Prints numbers only: it
 *          never saves or prints a word of what it hears, and takes no captures.
 *          Usage: start the rig (apps/web/tests/visual/overlay-rig.ts), then
 *                 `pnpm --filter web exec tsx ../desktop/tests/visual/call-load.ts [minutes] [<model folder>]`
 *          With a model folder the accurate engine runs as well (KITE_ACCURATE_MODEL_DIR).
 * Used by: the developer before a release; docs/testing/benchmark-results.md
 * Depends on: @playwright/test (_electron)
 * Architecture: docs/decisions/ADR-0044-transcript-auto-punctuation-cleanup.md
 *
 * "Them" is this computer's real sound, in memory only, as in any call: nothing is kept (the rig's
 * session does not save its transcript).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  };
}

/** How often the numbers are read, in ms. */
const SAMPLE_MS = 15_000;

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
      KITE_URL: 'http://localhost:3123/',
      KITE_NO_UPDATE_CHECK: '1',
      ...(MODEL_DIR ? { KITE_ACCURATE_MODEL_DIR: MODEL_DIR } : {}),
    },
  });
  try {
    const panel = await app.firstWindow();
    await panel.waitForLoadState();
    const opened = app.waitForEvent('window');
    await panel.evaluate(() =>
      (window as never as ShellWindow).kiteDesktop.openPagesWindow('/call'),
    );
    const call = await opened;
    await call.waitForLoadState();
    await call.getByRole('button', { name: 'Connect' }).click({ timeout: 300_000 });
    await call.getByRole('button', { name: 'Go live' }).click({ timeout: 60_000 });
    await wait(10_000);
    console.info(`[call-load] live, accurate engine ${MODEL_DIR ? 'on' : 'off'}, ${MINUTES} min`);

    const samples: { cpu: number; memoryMb: number; lines: number }[] = [];
    const end = Date.now() + MINUTES * 60_000;
    while (Date.now() < end) {
      await wait(SAMPLE_MS);
      const metrics = await app.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().map((metric) => ({
          cpu: metric.cpu.percentCPUUsage,
          memoryKb: metric.memory.workingSetSize,
        })),
      );
      samples.push({
        cpu: metrics.reduce((sum, metric) => sum + metric.cpu, 0),
        memoryMb: metrics.reduce((sum, metric) => sum + metric.memoryKb, 0) / 1024,
        lines: await call.getByRole('listitem', { name: /said$/ }).count(),
      });
    }
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const cpu = samples.map((sample) => sample.cpu);
    const memory = samples.map((sample) => sample.memoryMb);
    console.info(
      '[call-load]',
      JSON.stringify({
        samples: samples.length,
        // Electron's figure, as a share of one core.
        cpuMeanPercentOfOneCore: Math.round(mean(cpu)),
        cpuPeakPercentOfOneCore: Math.round(Math.max(...cpu)),
        memoryStartMb: Math.round(memory[0]!),
        memoryEndMb: Math.round(memory.at(-1)!),
        memoryPeakMb: Math.round(Math.max(...memory)),
        bubblesAtEnd: samples.at(-1)!.lines,
      }),
    );
  } finally {
    await app.close().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'failed');
  process.exitCode = 1;
});
