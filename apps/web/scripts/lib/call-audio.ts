/**
 * File: apps/web/scripts/lib/call-audio.ts
 * Purpose: Small, pure audio helpers for the synthetic test calls (v1.4, ADR-0062 Phase 2): reading and
 *          writing 16-bit mono WAV files, resampling, placing a clip in a track, delaying, a synthetic
 *          room echo, noise, a notification chime and loudness. Everything is deterministic (a seeded
 *          random generator), so the same script always makes the same audio.
 * Used by: scripts/make-calls.ts, scripts/stt-calls.ts; tests/unit/scripts/call-audio.test.ts
 * Depends on: node:fs
 * Architecture: docs/decisions/ADR-0063-synthetic-call-harness.md
 *
 * No audio of any person is used: the voices are the computer's own text-to-speech voices.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** The sample rate of every track: what the speech model takes. */
export const CALL_RATE = 16_000;

/**
 * A seeded random number generator (mulberry32), so noise is the same on every run.
 *
 * @param seed Any integer.
 * @returns A function giving numbers in [0, 1).
 * Called from: noise(), roomImpulse(); tests
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Reads a 16-bit PCM WAV file (mono, or the first channel).
 *
 * @param file Its path.
 * @returns The samples (-1…1) and the sample rate.
 * @throws Error when the file has no data chunk or is not 16-bit PCM.
 * Called from: make-calls.ts; tests
 */
export function readWav(file: string): { samples: Float32Array; rate: number } {
  const bytes = readFileSync(file);
  let rate = 0;
  let channels = 1;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(offset + 10);
      rate = bytes.readUInt32LE(offset + 12);
      if (bytes.readUInt16LE(offset + 22) !== 16) throw new Error('only 16-bit WAV is supported');
    }
    if (id === 'data') {
      const frames = Math.floor(size / 2 / channels);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) {
        samples[i] = bytes.readInt16LE(offset + 8 + i * 2 * channels) / 32_768;
      }
      return { samples, rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

/**
 * Writes samples as a 16-bit mono WAV file (clipped to -1…1).
 *
 * @param file    Where.
 * @param samples The samples.
 * @param rate    The sample rate (default CALL_RATE).
 * Called from: make-calls.ts; tests
 */
export function writeWav(file: string, samples: Float32Array, rate = CALL_RATE): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    data.writeInt16LE(Math.round(value * 32_767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

/**
 * Resamples by linear interpolation (enough for speech below 8 kHz).
 *
 * @param samples The samples.
 * @param from    Their rate.
 * @param to      The rate wanted.
 * @returns New samples at `to`.
 * Called from: make-calls.ts; tests
 */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples.slice();
  const out = new Float32Array(Math.floor((samples.length * to) / from));
  const step = from / to;
  for (let i = 0; i < out.length; i += 1) {
    const at = i * step;
    const left = Math.floor(at);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = at - left;
    out[i] = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return out;
}

/**
 * Root-mean-square level of the samples above a small floor (the speech, not the silence).
 *
 * @param samples The samples.
 * @returns RMS (0 when silent).
 * Called from: scaleToRms(); make-calls.ts; tests
 */
export function speechRms(samples: Float32Array): number {
  let sum = 0;
  let count = 0;
  for (const value of samples) {
    if (Math.abs(value) > 0.01) {
      sum += value * value;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/**
 * Scales samples so their speech RMS is the given level.
 *
 * @param samples The samples.
 * @param target  The RMS wanted (for example 0.1).
 * @returns New, scaled samples.
 * Called from: make-calls.ts; tests
 */
export function scaleToRms(samples: Float32Array, target: number): Float32Array {
  const level = speechRms(samples);
  return level === 0 ? samples.slice() : samples.map((value) => (value * target) / level);
}

/**
 * Cuts the silence at both ends of a clip (text-to-speech adds some), so a line's times in the script
 * are the times of its speech.
 *
 * @param samples   The clip.
 * @param threshold The level below which a sample is silence (default 0.005).
 * @returns The clip from its first to its last sound (empty when it is silent).
 * Called from: make-calls.ts; tests
 */
export function trimSilence(samples: Float32Array, threshold = 0.005): Float32Array {
  let first = 0;
  while (first < samples.length && Math.abs(samples[first] ?? 0) < threshold) first += 1;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last] ?? 0) < threshold) last -= 1;
  return first > last ? new Float32Array(0) : samples.slice(first, last + 1);
}

/**
 * Adds a clip into a track at a position (the track grows when needed).
 *
 * @param track   The track (changed in place when long enough).
 * @param clip    The clip.
 * @param atIndex Where the clip starts, in samples.
 * @param gain    A factor for the clip (default 1).
 * @returns The track (a new, longer array when it had to grow).
 * Called from: make-calls.ts; tests
 */
export function addAt(
  track: Float32Array,
  clip: Float32Array,
  atIndex: number,
  gain = 1,
): Float32Array {
  const needed = atIndex + clip.length;
  const out = needed > track.length ? growTo(track, needed) : track;
  for (let i = 0; i < clip.length; i += 1)
    out[atIndex + i] = (out[atIndex + i] ?? 0) + (clip[i] ?? 0) * gain;
  return out;
}

/**
 * Copies a track into a longer one, padded with silence.
 *
 * @param track  The track.
 * @param length The new length, in samples.
 * @returns The longer track.
 * Called from: addAt(); make-calls.ts
 */
export function growTo(track: Float32Array, length: number): Float32Array {
  const out = new Float32Array(length);
  out.set(track.subarray(0, Math.min(track.length, length)));
  return out;
}

/**
 * A synthetic room's impulse response: the direct sound and REFLECTIONS sparse reflections whose
 * strength decays exponentially. Sparse on purpose: a dense 300 ms tail over a 5-minute track would take
 * minutes to convolve, and the speech model hears no difference.
 *
 * @param rt60Ms How long the reflections take to fall by 60 dB, in ms.
 * @param seed   The random seed.
 * @returns The impulse response at CALL_RATE (direct sound = 1; most samples 0).
 * Called from: make-calls.ts; tests
 */
export function roomImpulse(rt60Ms: number, seed: number): Float32Array {
  const random = seededRandom(seed);
  const length = Math.round((rt60Ms / 1000) * CALL_RATE);
  const ir = new Float32Array(length);
  ir[0] = 1;
  // -60 dB over rt60: amplitude falls by 1000 times.
  const decay = Math.log(1000) / length;
  for (let n = 0; n < REFLECTIONS; n += 1) {
    const at = 1 + Math.floor(random() * (length - 1));
    ir[at] = (ir[at] ?? 0) + (random() * 2 - 1) * 0.5 * Math.exp(-decay * at);
  }
  return ir;
}

/** How many reflections roomImpulse() makes. */
export const REFLECTIONS = 48;

/**
 * Convolves a signal with an impulse response, keeping the signal's length plus the tail. Only the
 * response's non-zero taps are used (roomImpulse() is sparse).
 *
 * @param signal The signal.
 * @param ir     The impulse response.
 * @returns The echoing signal.
 * Called from: make-calls.ts; tests
 */
export function convolve(signal: Float32Array, ir: Float32Array): Float32Array {
  const taps: [number, number][] = [];
  ir.forEach((gain, at) => {
    if (gain !== 0) taps.push([at, gain]);
  });
  const out = new Float32Array(signal.length + ir.length - 1);
  for (const [at, gain] of taps) {
    for (let i = 0; i < signal.length; i += 1)
      out[i + at] = (out[i + at] ?? 0) + (signal[i] ?? 0) * gain;
  }
  return out;
}

/**
 * A one-pole low-pass filter (a phone line or a far speaker loses the high sounds).
 *
 * @param signal   The signal.
 * @param cutoffHz The cut-off frequency.
 * @returns The filtered signal.
 * Called from: make-calls.ts; tests
 */
export function lowPass(signal: Float32Array, cutoffHz: number): Float32Array {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / CALL_RATE);
  const out = new Float32Array(signal.length);
  let last = 0;
  for (let i = 0; i < signal.length; i += 1) {
    last += alpha * ((signal[i] ?? 0) - last);
    out[i] = last;
  }
  return out;
}

/**
 * Noise of a given RMS level: "white" (flat) or "pink" (softer high sounds, like a room or a fan).
 *
 * @param length The number of samples.
 * @param rms    Its RMS level.
 * @param color  'white' or 'pink'.
 * @param seed   The random seed.
 * @returns The noise.
 * Called from: make-calls.ts; tests
 */
export function noise(
  length: number,
  rms: number,
  color: 'white' | 'pink',
  seed: number,
): Float32Array {
  const random = seededRandom(seed);
  const out = new Float32Array(length);
  // Paul Kellet's economy pink filter.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i += 1) {
    const white = random() * 2 - 1;
    if (color === 'white') {
      out[i] = white;
      continue;
    }
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    out[i] = b0 + b1 + b2 + white * 0.1848;
  }
  let sum = 0;
  for (const value of out) sum += value * value;
  const level = Math.sqrt(sum / Math.max(1, length));
  return level === 0 ? out : out.map((value) => (value * rms) / level);
}

/**
 * A short notification chime: two decaying tones (880 Hz then 1,320 Hz).
 *
 * @param peak Its loudest sample.
 * @returns About 0.4 s of audio at CALL_RATE.
 * Called from: make-calls.ts; tests
 */
export function chime(peak = 0.4): Float32Array {
  const tone = (hz: number, ms: number) =>
    Float32Array.from({ length: Math.round((ms / 1000) * CALL_RATE) }, (_, i) => {
      const t = i / CALL_RATE;
      return peak * Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * 12);
    });
  const first = tone(880, 180);
  const second = tone(1_320, 220);
  const out = new Float32Array(first.length + second.length);
  out.set(first);
  out.set(second, first.length);
  return out;
}

/**
 * Short clicks, like typing on a keyboard: a burst of noise every so often.
 *
 * @param length The number of samples.
 * @param everyMs About how often a click comes, in ms.
 * @param peak    How loud a click is.
 * @param seed    The random seed.
 * @returns The clicks track.
 * Called from: make-calls.ts
 */
export function clicks(length: number, everyMs: number, peak: number, seed: number): Float32Array {
  const random = seededRandom(seed);
  const out = new Float32Array(length);
  const every = (everyMs / 1000) * CALL_RATE;
  for (
    let at = Math.floor(random() * every);
    at < length;
    at += Math.floor(every * (0.5 + random()))
  ) {
    for (let i = 0; i < 160 && at + i < length; i += 1) {
      out[at + i] = (random() * 2 - 1) * peak * Math.exp(-i / 30);
    }
  }
  return out;
}

/**
 * Turns decibels into a gain factor.
 *
 * @param db The level in dB (for example -21).
 * @returns The factor (for example about 0.089).
 * Called from: make-calls.ts; tests
 */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
