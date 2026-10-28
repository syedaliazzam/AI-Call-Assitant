/**
 * Integration test for the speech-to-text pipeline (day-02-audio.md Stage 6; ADR-0020).
 * Covers: Chromium's fake microphone plays an official LibriSpeech recording
 * (tests/fixtures/audio, see SOURCES.md) in real time into the app's real path: getUserMedia →
 * resampler worklet → stt.worker.ts → sherpa-onnx v1.13.7 WebAssembly recognizer (Zipformer
 * 2023-06-21, files from apps/web/public) → transcript core. For each recording it checks that
 * at least one final line is produced, that no engine error occurred, and that the word error
 * rate against the official reference transcript is at most MAX_WER (reasoning below).
 *
 * Needs the speech-to-text files (`pnpm --filter web fetch-models`). Without them the test is
 * skipped locally with a message, and fails in CI (where the job fetches them first).
 * Logged: counts, timings and WER only. The texts compared are the public fixture
 * transcripts, never anyone's call.
 */
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { isInstalled, sha256Of } from '../../scripts/fetch-models';
import {
  DEFAULT_STT_MODEL,
  getSttModel,
  LOCAL_MODELS_PATH,
  RUNTIME_FILES,
  RUNTIME_PUBLIC_PATH,
  TEST_RECORDINGS,
  type PinnedFile,
} from '../../src/core/stt/models';
import { wordErrorRate } from '../../src/core/stt/wer';
import type { HarnessSnapshot, KiteSttHarness } from './harness/harness';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** apps/web/public (runtime and model files, as `pnpm dev` serves them). */
const PUBLIC_DIR = path.join(WEB_DIR, 'public');
/** The committed fixture recordings. */
const FIXTURES_DIR = path.join(WEB_DIR, 'tests', 'fixtures', 'audio');

/**
 * Highest word error rate accepted per recording: 10%.
 *
 * Why 10%: the references are clean read speech (LibriSpeech) from the model's own repository.
 * Measured on Day 2 (Windows, Playwright Chromium, this live path): 0.wav 0/18 words wrong,
 * 1.wav 1/48. The one "error" is a spelling difference ("DISHONOURED" in the reference,
 * "DISHONORED" from the model), not a recognition error. Timing differs from machine to machine
 * (a slower CI runner, where utterances end and how chunks fall), so a word can occasionally be
 * cut or split at an utterance boundary. 10% allows one such error in 0.wav (1/18 = 5.6%; two
 * errors = 11.1% fail) and four in 1.wav (4/48 = 8.3%; five = 10.4% fail). A broken pipeline
 * (wrong sample rate, lost or reordered chunks, a missing flush, mixed-up channels) produces
 * far more errors than that, or no final line at all.
 */
const MAX_WER = 0.1;

/** Silence after the recording ends that the endpoint rules need (rule 2 ≈1 s, pause 1.2 s). */
const END_WAIT_MS = 3_000;

/** Every file the test page loads, with its pin and where it lives. */
function requiredFiles(): { file: string; pinned: PinnedFile }[] {
  const model = getSttModel(DEFAULT_STT_MODEL);
  const runtimeDir = path.join(PUBLIC_DIR, ...RUNTIME_PUBLIC_PATH.split('/').filter(Boolean));
  const modelDir = path.join(PUBLIC_DIR, ...LOCAL_MODELS_PATH.split('/').filter(Boolean), model.id);
  return [
    ...Object.values(RUNTIME_FILES).map((pinned) => ({
      file: path.join(runtimeDir, pinned.name),
      pinned,
    })),
    ...Object.values(model.files).map((pinned) => ({
      file: path.join(modelDir, pinned.name),
      pinned,
    })),
  ];
}

/**
 * Serves the harness page, its bundles and the speech-to-text files on 127.0.0.1 (a secure
 * context, so getUserMedia and Cache Storage work over plain HTTP).
 *
 * @param bundleDir Folder with harness.js and stt.worker.js.
 * @returns The server and its origin.
 */
async function serve(bundleDir: string): Promise<{ server: Server; origin: string }> {
  const page = `<!doctype html><meta charset="utf-8"><title>Kite STT test</title>
<script type="module" src="/harness/harness.js"></script>`;
  const types: Record<string, string> = {
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
    '.txt': 'text/plain',
  };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page);
      return;
    }
    // Only the harness bundles and the two speech-to-text folders are served.
    const [root, relative] = pathname.startsWith('/harness/')
      ? [bundleDir, pathname.slice('/harness/'.length)]
      : pathname.startsWith(`${RUNTIME_PUBLIC_PATH}/`) ||
          pathname.startsWith(`${LOCAL_MODELS_PATH}/`)
        ? [PUBLIC_DIR, pathname.slice(1)]
        : [null, ''];
    const file = root ? path.resolve(root, relative) : '';
    if (!root || !file.startsWith(path.resolve(root) + path.sep) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': statSync(file).size,
      })
      .end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, origin: `http://127.0.0.1:${port}` };
}

/**
 * Length of a 16-bit PCM WAV's audio, in ms (from its "data" chunk).
 *
 * @param file Path to the WAV.
 * @returns Duration in ms.
 */
function wavDurationMs(file: string): number {
  const bytes = readFileSync(file);
  const sampleRate = bytes.readUInt32LE(24);
  const channels = bytes.readUInt16LE(22);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'data') return (size / 2 / channels / sampleRate) * 1000;
    offset += 8 + size;
  }
  throw new Error(`${path.basename(file)} has no data chunk`);
}

let bundleDir = '';
let server: Server | null = null;
let origin = '';

test.beforeAll(async () => {
  const files = requiredFiles();
  const missing = files.filter(({ file }) => !existsSync(file));
  if (missing.length > 0) {
    const message =
      `Speech-to-text files missing (${missing.length} of ${files.length}, e.g. ` +
      `${path.relative(WEB_DIR, missing[0]!.file)}). Run \`pnpm --filter web fetch-models\` ` +
      `(~205 MB, once per machine), then \`pnpm --filter web test:stt\` again.`;
    // CI fetches the files first, so missing files there are a real failure.
    if (process.env.CI) throw new Error(message);
    console.log(`\nSKIPPED: ${message}\n`);
    test.skip(true, message);
    return;
  }
  // Same check as the browser makes: the right size and SHA-256 for every file.
  for (const { file, pinned } of files) {
    if (!(await isInstalled(file, pinned))) {
      throw new Error(
        `Checksum mismatch for ${path.relative(WEB_DIR, file)}: expected SHA-256 ` +
          `${pinned.sha256} (${pinned.bytes} bytes). Delete it and run ` +
          '`pnpm --filter web fetch-models`.',
      );
    }
  }

  bundleDir = mkdtempSync(path.join(tmpdir(), 'kite-stt-test-'));
  const common = {
    bundle: true,
    platform: 'browser' as const,
    // Resolves the `@/*` alias the same way the app does.
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
    logLevel: 'error' as const,
  };
  await build({
    ...common,
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'harness.ts')],
    format: 'esm',
    outfile: path.join(bundleDir, 'harness.js'),
  });
  // Classic worker (IIFE), like the app's: the runtime scripts need importScripts.
  await build({
    ...common,
    entryPoints: [path.join(WEB_DIR, 'src', 'core', 'stt', 'stt.worker.ts')],
    format: 'iife',
    outfile: path.join(bundleDir, 'stt.worker.js'),
  });
  ({ server, origin } = await serve(bundleDir));
});

test.afterAll(() => {
  server?.close();
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

for (const recording of TEST_RECORDINGS) {
  test(`transcribes ${recording.name} through the live pipeline with WER ≤ ${MAX_WER * 100}%`, async () => {
    const wav = path.join(FIXTURES_DIR, recording.name);
    expect(await sha256Of(wav), `${recording.name} must match its pin (SOURCES.md)`).toBe(
      recording.sha256,
    );
    const audioMs = wavDurationMs(wav);

    const browser = await chromium.launch({
      args: [
        // Chromium's fake microphone, fed from the fixture; %noloop plays it once, then
        // silence, so the endpoint rules end the last utterance.
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${wav}%noloop`,
        // Answers the microphone prompt automatically.
        '--use-fake-ui-for-media-stream',
        // The AudioContext must run without a click.
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    try {
      const context = await browser.newContext({ permissions: ['microphone'] });
      const page = await context.newPage();
      await page.goto(origin);
      await page.waitForFunction(() => 'kiteSttHarness' in window);
      const { loadMs } = await page.evaluate(() =>
        (window as unknown as { kiteSttHarness: KiteSttHarness }).kiteSttHarness.start(),
      );

      const snapshot = () =>
        page.evaluate(() =>
          (window as unknown as { kiteSttHarness: KiteSttHarness }).kiteSttHarness.snapshot(),
        );
      // The fake device plays in real time: wait for the recording, then until the last
      // utterance has ended (no partial left) or the end-of-utterance wait has passed twice.
      await page.waitForTimeout(audioMs + END_WAIT_MS);
      let result: HarnessSnapshot = await snapshot();
      for (let waited = 0; result.partial !== '' && waited < END_WAIT_MS * 2; waited += 250) {
        await page.waitForTimeout(250);
        result = await snapshot();
      }
      // Statistics before stopping: detaching removes the channel from them.
      const channel = result.stats?.channels.you;
      await page.evaluate(() =>
        (window as unknown as { kiteSttHarness: KiteSttHarness }).kiteSttHarness.stop(),
      );
      result = await snapshot();

      const heard = result.finals.join(' ');
      const score = wordErrorRate(recording.transcript, heard);
      const differences = score.alignment
        .filter((step) => step.type !== 'ok')
        .map((step) =>
          step.type === 'sub'
            ? `sub ${step.ref}→${step.hyp}`
            : step.type === 'del'
              ? `del ${step.ref}`
              : step.type === 'ins'
                ? `ins ${step.hyp}`
                : '',
        )
        .join('; ');
      // Numbers only (see the header).
      console.log(
        `${recording.name}: audio ${(audioMs / 1000).toFixed(1)} s; load ${loadMs} ms; ` +
          `final lines ${result.finals.length}; WER ${(score.wer * 100).toFixed(1)}% ` +
          `(${score.substitutions} sub, ${score.deletions} del, ${score.insertions} ins / ` +
          `${score.referenceWords}); RTF ${channel ? channel.rtf.toFixed(3) : '–'}; ` +
          `input ${channel?.inputSampleRate ?? '–'} Hz; ` +
          `end of speech → final ${result.latenciesMs.join(', ') || '–'} ms` +
          (differences ? `; differences (fixture text): ${differences}` : ''),
      );

      expect(result.errors, 'engine errors').toEqual([]);
      expect(result.finals.length, 'at least one final line').toBeGreaterThan(0);
      expect(
        score.wer,
        `WER ${(score.wer * 100).toFixed(1)}% above ${MAX_WER * 100}%. Differences: ${differences}`,
      ).toBeLessThanOrEqual(MAX_WER);
    } finally {
      await browser.close();
    }
  });
}
