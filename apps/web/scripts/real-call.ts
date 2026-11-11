/**
 * File: apps/web/scripts/real-call.ts
 * Purpose: Replays a real call's two-channel recording (the stereo file a desktop recording keeps: "You" on
 *          the left, "Them" on the right, ADR-0068) through the app's real speech worker, end-of-turn model
 *          and accurate engine at real-time speed (scripts/lib/worker-run.ts), then through the app's own
 *          transcript, auto-answer and Answer-press code on a simulated clock (scripts/lib/real-call-replay.ts),
 *          and scores it against the call's question list (1.5.2, ADR-0070).
 *          Usage: pnpm --filter web call:real --label=before [--src=<apps/web dir>] [--replay]
 *                 [--stereo=<file>] [--truth=<file>] [--presses=<file>] [--accurate=2]
 * Used by: the "call:real" script in apps/web/package.json (by hand; never in CI: the recording is private)
 * Depends on: scripts/lib/worker-run.ts, scripts/lib/real-call-replay.ts, @playwright/test (decoding)
 * Architecture: docs/decisions/ADR-0070-right-question-right-time.md
 *
 * Privacy: the recording, its truth file and the results live in docs/testing/calls/ (git-ignored). Only
 * numbers are printed: never words, questions or answers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { scoreRealCall, type RealCallTruth, type PressPlan } from './lib/real-call-replay';
import {
  WEB_DIR,
  bundleCheckout,
  playThroughWorker,
  type PageRun,
  type Tracks,
} from './lib/worker-run';

/** The git-ignored folder for real calls. */
const CALLS_DIR = path.resolve(WEB_DIR, '..', '..', 'docs', 'testing', 'calls');

/** Where results go (inside the git-ignored folder). */
const RESULTS_DIR = path.join(CALLS_DIR, 'results');

/**
 * Decodes a stereo WebM/Opus file to two 16 kHz mono channels with Chromium's own decoder (the format
 * the app writes; no ffmpeg needed).
 *
 * @param file The stereo file.
 * @returns Left ("you") and right ("them").
 * @throws Error when the file is not two-channel.
 * Called from: main()
 */
async function decodeStereo(file: string): Promise<Tracks> {
  const bytes = readFileSync(file);
  const server = createServer((req, res) => {
    if (req.url === '/audio') {
      res.writeHead(200, { 'Content-Type': 'audio/webm' }).end(bytes);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>decode</title>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    // A plain script string: tsx would wrap named helpers in __name, which the page lacks.
    // decodeAudioData resamples to the context's rate.
    const decoded = (await page.evaluate(`(async () => {
      const buffer = await (await fetch('/audio')).arrayBuffer();
      const audio = await new OfflineAudioContext(2, 16000, 16000).decodeAudioData(buffer);
      const encode = (samples) => {
        const view = new Uint8Array(samples.buffer);
        let text = '';
        for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
        return btoa(text);
      };
      return {
        channels: audio.numberOfChannels,
        left: encode(audio.getChannelData(0)),
        right: encode(audio.getChannelData(Math.min(1, audio.numberOfChannels - 1))),
      };
    })()`)) as { channels: number; left: string; right: string };
    if (decoded.channels !== 2) throw new Error('The recording is not two-channel.');
    const toFloat = (base64: string) => {
      const raw = Buffer.from(base64, 'base64');
      return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    };
    return { you: toFloat(decoded.left), them: toFloat(decoded.right) };
  } finally {
    await browser.close();
    server.close();
  }
}

/**
 * The answer cards of a call's TXT export (ADR-0061 format), as the texts the user read aloud, each with
 * when it appeared on the recording's clock.
 *
 * @param file        The TXT export.
 * @param cardDelayS  Seconds from a card's "answered" time to the recording's clock, plus the time until its
 *                    words show (the real call: −1.365 s clock offset, +2 s to the first words).
 * @returns The texts, oldest first ([] when the file is missing).
 * Called from: main()
 */
function readReference(file: string, cardDelayS: number): { text: string; at: number }[] {
  if (!existsSync(file)) return [];
  const out: { text: string; at: number }[] = [];
  const blocks = readFileSync(file, 'utf8').replace(/\r/g, '').split('\n\n');
  for (const block of blocks) {
    const head = /^Paramount AI answered\s+(\d+):(\d+)/.exec(block);
    if (!head) continue;
    const at = Number(head[1]) * 60 + Number(head[2]) + cardDelayS;
    const body = block
      .split('\n')
      .filter((line) => !line.startsWith('Paramount AI answered') && !line.startsWith('Question:'))
      .map((line) => line.replace(/^(Answer:|Tip:|-)\s*/, ''))
      .join(' ');
    out.push({ text: body, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Runs the replay from the command line.
 *
 * Called from: the command line
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      label: { type: 'string', default: 'current' },
      src: { type: 'string' },
      replay: { type: 'boolean', default: false },
      run: { type: 'string' },
      stereo: {
        type: 'string',
        default: path.join(CALLS_DIR, 'real-call-2026-11-11.stereo.webm'),
      },
      truth: { type: 'string', default: path.join(CALLS_DIR, 'real-call-2026-11-11.truth.json') },
      presses: { type: 'string' },
      accurate: { type: 'string', default: '2' },
      'accurate-model': { type: 'string' },
      // A 16 kHz Float32 file to play as "You" instead of the left channel (an offline-processed copy,
      // to compare a microphone treatment on the same call).
      'you-pcm': { type: 'string' },
      // 1.5.2: run the worker's echo canceller (when the checkout measured has one).
      aec: { type: 'boolean', default: true },
      // Play only the first N seconds (a quick check).
      seconds: { type: 'string' },
      // The call's TXT export: its answer cards are what the user read aloud (the "You" WER reference).
      reference: { type: 'string', default: path.join(CALLS_DIR, 'real-call-2026-11-11.txt') },
      'card-delay': { type: 'string', default: '0.635' },
    },
  });
  mkdirSync(RESULTS_DIR, { recursive: true });
  const srcDir = path.resolve(values.src ?? WEB_DIR);
  const { dir, logic } = await bundleCheckout(srcDir, (file) => [
    `export * as questionKind from ${file('core/transcript/questionKind.ts')};`,
    `export * as repeatGuardModule from ${file('core/answer/repeatGuard.ts')};`,
    existsSync(path.join(srcDir, 'src', 'core', 'answer', 'pressQuestion.ts'))
      ? `export * as pressQuestion from ${file('core/answer/pressQuestion.ts')};`
      : '',
  ]);
  const runFile = values.run
    ? path.resolve(values.run)
    : path.join(RESULTS_DIR, `${values.label}-run.json`);
  let run: PageRun;
  if (values.replay && existsSync(runFile)) {
    run = JSON.parse(readFileSync(runFile, 'utf8')) as PageRun;
  } else {
    const tracks = await decodeStereo(values.stereo!);
    // The recording stops right after the last question: 3 s of silence lets its line end as in a call.
    const pad = (samples: Float32Array) => {
      const padded = new Float32Array(samples.length + 3 * 16_000);
      padded.set(samples);
      return padded;
    };
    if (values.seconds) {
      const n = Number(values.seconds) * 16_000;
      tracks.you = tracks.you.slice(0, n);
      tracks.them = tracks.them.slice(0, n);
    }
    tracks.you = pad(tracks.you);
    tracks.them = pad(tracks.them);
    if (values['you-pcm']) {
      const raw = readFileSync(values['you-pcm']);
      tracks.you = pad(
        new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)),
      );
    }
    const modelDir = values['accurate-model'];
    console.log(
      `${values.label}: playing ${Math.round(tracks.them.length / 16_000)} s of the call (real time)…`,
    );
    run = await playThroughWorker(
      tracks,
      dir,
      values.accurate !== '0' && modelDir ? { threads: Number(values.accurate), modelDir } : null,
      values.aec,
    );
    writeFileSync(runFile, JSON.stringify(run));
    console.log(`Echo canceller: ${run.echoCancel ?? 'not reported'}`);
  }
  if (!existsSync(values.truth!)) {
    console.log(`Recorded ${run.events.length} messages. No truth file yet: nothing scored.`);
    return;
  }
  const truth = JSON.parse(readFileSync(values.truth!, 'utf8')) as RealCallTruth;
  const presses = values.presses
    ? (JSON.parse(readFileSync(values.presses, 'utf8')) as PressPlan)
    : truth.presses;
  const reference = readReference(values.reference!, Number(values['card-delay']));
  const result = scoreRealCall(run, truth, presses, logic, reference);
  writeFileSync(
    path.join(RESULTS_DIR, `${values.label}-score.json`),
    JSON.stringify({ label: values.label, src: srcDir, ...result }, null, 1),
  );
  console.log(result.report);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
