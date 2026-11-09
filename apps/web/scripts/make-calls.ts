/**
 * File: apps/web/scripts/make-calls.ts
 * Purpose: Makes the synthetic two-channel test calls (v1.4, ADR-0062 Phase 2) from the script in
 *          scripts/lib/call-script.ts: each line is spoken by a Windows text-to-speech voice (the other
 *          person "David", the user "Zira"), placed on the timeline with its pauses and overlaps, and
 *          mixed into a "you" track (the microphone) and a "them" track (the call's sound), in variants:
 *          - headphones: clean channels (a faint microphone noise floor);
 *          - speakers: the call's sound also reaches the microphone through the room, 21 dB down, 80 ms
 *            late, with a synthetic room echo, as on laptop speakers with no echo cancellation for it;
 *          - reverse-echo: the user's voice comes back on the call's sound 500 ms late, 20 dB down;
 *          - noisy: the headphones call with room noise (15 dB below the voice) and keyboard clicks on
 *            the microphone.
 *          Usage: pnpm --filter web calls:make   (Windows only: it uses the built-in voices)
 * Used by: the "calls:make" script in apps/web/package.json (by hand; never in CI)
 * Depends on: scripts/lib/call-script.ts, scripts/lib/call-audio.ts, PowerShell + System.Speech
 * Architecture: docs/decisions/ADR-0063-synthetic-call-harness.md
 *
 * Output (git-ignored): apps/web/eval-results/calls/<variant>/{you.wav,them.wav,timeline.json}, and the
 * spoken lines cached in apps/web/eval-results/calls/tts/. No person's voice is used. Nothing is printed
 * but file names, lengths and levels.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addAt,
  CALL_RATE,
  chime,
  clicks,
  convolve,
  dbToGain,
  growTo,
  lowPass,
  noise,
  readWav,
  resample,
  roomImpulse,
  scaleToRms,
  trimSilence,
  writeWav,
} from './lib/call-audio';
import { CALL_SCRIPT, placeLines, type ScriptLine } from './lib/call-script';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where the calls go (git-ignored: eval-results/). */
export const CALLS_DIR = path.join(WEB_DIR, 'eval-results', 'calls');
/** The voice of each side (Windows' built-in SAPI voices). */
const VOICES = { them: 'Microsoft David Desktop', you: 'Microsoft Zira Desktop' } as const;
/** The speech level of both voices (RMS of the speech, about -22 dBFS). */
const VOICE_RMS = 0.08;

/** The variants, with what each adds. */
export const VARIANTS = ['headphones', 'speakers', 'reverse-echo', 'noisy'] as const;
/** A variant's name. */
export type Variant = (typeof VARIANTS)[number];

/** The settings of the variants, written into each timeline.json. */
const SETTINGS = {
  micFloorRms: 0.0008,
  speakers: { gainDb: -21, delayMs: 80, rt60Ms: 300, lowPassHz: 5_000 },
  reverseEcho: { gainDb: -20, delayMs: 500, lowPassHz: 3_400 },
  noisy: { snrDb: 15, clicksEveryMs: 900, clickPeak: 0.05 },
  chimePeak: 0.25,
};

/**
 * Speaks every line that is not cached yet, in one PowerShell process.
 *
 * @param jobs The lines to speak: text, voice, output file.
 * @throws Error when PowerShell or a voice fails.
 * Called from: main()
 */
function speak(jobs: { text: string; voice: string; out: string }[]): void {
  if (jobs.length === 0) return;
  const work = path.join(tmpdir(), `kite-calls-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const list = path.join(work, 'jobs.json');
  writeFileSync(list, JSON.stringify(jobs), 'utf8');
  const script = [
    'param([string]$List)',
    'Add-Type -AssemblyName System.Speech',
    '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    '$jobs = [IO.File]::ReadAllText($List, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json',
    'foreach ($job in $jobs) {',
    '  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '  $s.SelectVoice($job.voice)',
    '  $s.SetOutputToWaveFile($job.out, $format)',
    '  $s.Speak($job.text)',
    '  $s.Dispose()',
    '}',
  ].join('\n');
  const file = path.join(work, 'speak.ps1');
  writeFileSync(file, script, 'utf8');
  const run = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, '-List', list],
    {
      encoding: 'utf8',
    },
  );
  if (run.status !== 0) throw new Error(`text-to-speech failed: ${run.stderr.slice(0, 300)}`);
}

/**
 * The cached file of one spoken line.
 *
 * @param line The script line.
 * @returns Its path (voice and text decide the name).
 * Called from: main()
 */
function ttsFile(line: ScriptLine): string {
  const hash = createHash('sha256')
    .update(`${VOICES[line.speaker]}|${line.text}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(CALLS_DIR, 'tts', `${line.speaker}-${hash}.wav`);
}

/**
 * Delays a track by some ms (adds silence at the start).
 *
 * @param track The track.
 * @param ms    The delay.
 * @returns The delayed track.
 * Called from: main()
 */
function delay(track: Float32Array, ms: number): Float32Array {
  return addAt(new Float32Array(0), track, Math.round((ms / 1000) * CALL_RATE));
}

/**
 * Adds a track onto another, same length (the result has the first one's length).
 *
 * @param base  The track kept.
 * @param extra What is added.
 * @param gain  A factor for what is added.
 * @returns A new track.
 * Called from: main()
 */
function mix(base: Float32Array, extra: Float32Array, gain = 1): Float32Array {
  const out = base.slice();
  for (let i = 0; i < out.length && i < extra.length; i += 1)
    out[i] = (out[i] ?? 0) + (extra[i] ?? 0) * gain;
  return out;
}

/**
 * Makes every variant.
 *
 * Called from: the command line
 */
function main(): void {
  if (process.platform !== 'win32')
    throw new Error('calls:make uses the Windows text-to-speech voices');
  mkdirSync(path.join(CALLS_DIR, 'tts'), { recursive: true });
  speak(
    CALL_SCRIPT.filter((line) => !existsSync(ttsFile(line))).map((line) => ({
      text: line.text,
      voice: VOICES[line.speaker],
      out: ttsFile(line),
    })),
  );
  const clips = new Map<string, Float32Array>();
  const durations = new Map<string, number>();
  for (const line of CALL_SCRIPT) {
    const { samples, rate } = readWav(ttsFile(line));
    const clip = scaleToRms(trimSilence(resample(samples, rate, CALL_RATE)), VOICE_RMS);
    clips.set(line.id, clip);
    durations.set(line.id, Math.round((clip.length / CALL_RATE) * 1000));
  }
  const { lines, totalMs } = placeLines(CALL_SCRIPT, durations);
  const length = Math.ceil((totalMs / 1000) * CALL_RATE);
  let you: Float32Array = new Float32Array(length);
  let them: Float32Array = new Float32Array(length);
  for (const line of lines) {
    const at = Math.round((line.startMs / 1000) * CALL_RATE);
    if (line.speaker === 'you') you = addAt(you, clips.get(line.id)!, at);
    else them = addAt(them, clips.get(line.id)!, at);
    if (line.chimeAtMs !== undefined) {
      them = addAt(
        them,
        chime(SETTINGS.chimePeak),
        at + Math.round((line.chimeAtMs / 1000) * CALL_RATE),
      );
    }
  }
  you = growTo(you, length);
  them = growTo(them, length);
  const floor = noise(length, SETTINGS.micFloorRms, 'white', 11);
  const cleanYou = mix(you, floor);

  const speakersLeak = growTo(
    lowPass(
      convolve(delay(them, SETTINGS.speakers.delayMs), roomImpulse(SETTINGS.speakers.rt60Ms, 7)),
      SETTINGS.speakers.lowPassHz,
    ),
    length,
  );
  const reverseLeak = growTo(
    lowPass(delay(you, SETTINGS.reverseEcho.delayMs), SETTINGS.reverseEcho.lowPassHz),
    length,
  );
  const roomNoise = noise(length, VOICE_RMS * dbToGain(-SETTINGS.noisy.snrDb), 'pink', 23);
  const typing = clicks(length, SETTINGS.noisy.clicksEveryMs, SETTINGS.noisy.clickPeak, 31);

  const variants: Record<Variant, { you: Float32Array; them: Float32Array }> = {
    headphones: { you: cleanYou, them },
    speakers: { you: mix(cleanYou, speakersLeak, dbToGain(SETTINGS.speakers.gainDb)), them },
    'reverse-echo': {
      you: cleanYou,
      them: mix(them, reverseLeak, dbToGain(SETTINGS.reverseEcho.gainDb)),
    },
    noisy: { you: mix(mix(cleanYou, roomNoise), typing), them },
  };
  for (const name of VARIANTS) {
    const dir = path.join(CALLS_DIR, name);
    mkdirSync(dir, { recursive: true });
    writeWav(path.join(dir, 'you.wav'), variants[name].you);
    writeWav(path.join(dir, 'them.wav'), variants[name].them);
    writeFileSync(
      path.join(dir, 'timeline.json'),
      JSON.stringify(
        { variant: name, totalMs, settings: SETTINGS, voices: VOICES, lines },
        null,
        1,
      ),
    );
    console.log(`${name}: ${(totalMs / 1000).toFixed(1)} s, ${lines.length} lines`);
  }
}

// Only when run as a command (stt-calls.ts imports CALLS_DIR and VARIANTS from here).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
