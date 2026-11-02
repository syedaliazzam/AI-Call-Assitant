/**
 * File: apps/web/scripts/record-names.ts
 * Purpose: Records the names set for the Day 6 speech engine trial (ADR-0027) with one
 *          command. Opens a browser window that shows one sentence at a time from
 *          tests/fixtures/stt/names-sentences.txt; the developer presses Space to start and stop
 *          recording, Enter to keep it and go on, R to record it again. Each clip is saved as
 *          16 kHz mono 16-bit WAV in tests/fixtures/stt/names-audio/ (git-ignored: it is the
 *          developer's voice), and tests/fixtures/stt/names-manifest.json (committed) lists each
 *          clip's file, sentence number, length and SHA-256.
 *          Usage: pnpm --filter web stt:record-names [--from=N]  (N = sentence to start at)
 *                 pnpm --filter web stt:record-names --only=2,21,33  (just these sentences)
 * Used by: the "stt:record-names" script in apps/web/package.json (run by the developer, once)
 * Depends on: @playwright/test (Chromium, already installed for the tests), node:http, node:fs,
 *             node:crypto
 * Architecture: docs/decisions/ADR-0027-desktop-speech-engine.md; day-06 Stage 1
 *
 * No audio or sentence text is printed; only progress like "clip 07 saved (3.4 s)".
 * The page is served from 127.0.0.1, because the browser allows the microphone only in a
 * secure context (127.0.0.1 counts as one).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

/** tests/fixtures/stt. */
const STT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'stt',
);
/** Where the clips go (git-ignored). */
const AUDIO_DIR = path.join(STT_DIR, 'names-audio');
/** The committed list of clips. */
const MANIFEST = path.join(STT_DIR, 'names-manifest.json');

/** One clip in the manifest. */
interface ManifestClip {
  /** Sentence number, from 1. */
  index: number;
  /** File name inside names-audio/. */
  file: string;
  /** Length in seconds. */
  seconds: number;
  /** SHA-256 of the WAV file, hex. */
  sha256: string;
}

/**
 * Reads the sentences (skipping comments). Lines still marked EDIT stop the recorder, so
 * placeholder names are never recorded.
 *
 * @returns The sentences, in order.
 * @throws Error when a sentence still starts with "EDIT:".
 * Called from: main()
 */
function readSentences(): string[] {
  const lines = readFileSync(path.join(STT_DIR, 'names-sentences.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'));
  const unedited = lines.findIndex((line) => line.startsWith('EDIT:'));
  if (unedited >= 0) {
    throw new Error(
      `sentence ${unedited + 1} still has placeholder names (EDIT:). Replace them first.`,
    );
  }
  return lines.map((line) => line.split('|')[0]!.trim());
}

/** The recording page: one sentence at a time, keyboard only. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Kite names recorder</title>
<body style="font:20px system-ui;margin:40px;background:#0b1630;color:#fff">
<p id="step" style="color:#7fdcff;font:14px monospace"></p>
<h1 id="sentence" style="font-size:32px;line-height:1.3;max-width:900px"></h1>
<p id="state" style="font:16px monospace;color:#ffd166"></p>
<p style="color:#9fb0d0">Space: start / stop &nbsp; Enter: keep and go on &nbsp; R: record again</p>
<script>
let sentences = [], order = [], position = 0, recorder = null, chunks = [], clip = null, stream = null;
// busy: a clip is being processed or saved. Keys wait, so a held key or a quick second press can
// never save a clip twice, or start a recording over the one being processed (Day 6).
let busy = false;
const current = () => order[position];
const show = (state) => {
  const done = position >= order.length;
  document.getElementById('step').textContent = done ? '' : 'Sentence ' + (current() + 1) + ' of ' + sentences.length;
  document.getElementById('sentence').textContent = done ? 'All done. You can close this window.' : sentences[current()];
  document.getElementById('state').textContent = state;
};
async function toWav(blob) {
  const decoded = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
  const frames = Math.ceil(decoded.duration * 16000);
  const offline = new OfflineAudioContext(1, frames, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded; source.connect(offline.destination); source.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (o, s) => [...s].forEach((c, k) => view.setUint8(o + k, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, k) => view.setInt16(44 + k * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  let binary = ''; new Uint8Array(view.buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return { base64: btoa(binary), seconds: pcm.length / 16000 };
}
document.addEventListener('keydown', async (e) => {
  if (position >= order.length || e.repeat || busy) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!recorder) {
      stream = stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      chunks = []; clip = null;
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => chunks.push(ev.data);
      recorder.onstop = async () => { clip = await toWav(new Blob(chunks)); busy = false; show('Recorded ' + clip.seconds.toFixed(1) + ' s. Enter to keep, R to redo.'); };
      recorder.start(); show('Recording... Space to stop.');
    } else { busy = true; recorder.stop(); recorder = null; show('Processing...'); }
  } else if (e.key === 'r' || e.key === 'R') { clip = null; show('Press Space and read the sentence again.'); }
  else if (e.key === 'Enter' && clip) {
    busy = true;
    await window.saveClip(current(), clip.base64, clip.seconds);
    position += 1; clip = null; busy = false;
    show(position < order.length ? 'Press Space and read the sentence.' : '');
  }
});
window.start = (list, indexes) => { sentences = list; order = indexes; position = 0; show('Press Space and read the sentence.'); };
</script>`;

/**
 * Serves the page, opens the window, and saves clips until the last sentence or the window
 * closes.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { from: { type: 'string' }, only: { type: 'string' } } });
  const sentences = readSentences();
  const from = Math.max(0, Number(values.from ?? '1') - 1);
  // The sentences to record, as positions in the list: --only, or everything from --from on.
  const order = values.only
    ? values.only.split(',').map((number) => Number(number) - 1)
    : sentences.map((_, index) => index).slice(from);
  if (order.some((index) => !Number.isInteger(index) || index < 0 || index >= sentences.length)) {
    throw new Error(`--only: use sentence numbers from 1 to ${sentences.length}`);
  }
  mkdirSync(AUDIO_DIR, { recursive: true });
  let manifest: ManifestClip[] = [];
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as ManifestClip[];
  } catch {
    // No manifest yet: this is the first recording.
  }

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1100, height: 600 } });
  await context.grantPermissions(['microphone'], { origin: `http://127.0.0.1:${port}` });
  const page = await context.newPage();
  let saved = 0;
  await page.exposeFunction('saveClip', (index: number, base64: string, seconds: number) => {
    const file = `${String(index + 1).padStart(2, '0')}.wav`;
    const bytes = Buffer.from(base64, 'base64');
    writeFileSync(path.join(AUDIO_DIR, file), bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    manifest = [
      ...manifest.filter((clip) => clip.index !== index + 1),
      { index: index + 1, file, seconds: Math.round(seconds * 10) / 10, sha256 },
    ].sort((a, b) => a.index - b.index);
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    saved += 1;
    console.log(`clip ${file.slice(0, 2)} saved (${seconds.toFixed(1)} s)`);
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(
    ([list, indexes]) =>
      (window as unknown as { start: (l: string[], i: number[]) => void }).start(list, indexes),
    [sentences, order] as const,
  );
  console.log(`Recorder open: ${order.length} sentences. Close the window when done.`);
  await page.waitForEvent('close', { timeout: 0 });
  await browser.close();
  server.close();
  console.log(`${saved} clip(s) saved; manifest has ${manifest.length} of ${sentences.length}.`);
}

main().catch((error: unknown) => {
  console.error(`stt:record-names failed (${error instanceof Error ? error.message : 'unknown'})`);
  process.exitCode = 1;
});
