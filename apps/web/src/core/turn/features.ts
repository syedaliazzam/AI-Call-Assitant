/**
 * File: apps/web/src/core/turn/features.ts
 * Purpose: Turns the last 8 seconds of the other person's audio into what the Smart Turn model reads
 *          (v1.4, ADR-0065): Whisper's log-mel features, 80 mel bands × 800 frames. Follows Hugging
 *          Face's WhisperFeatureExtractor(chunk_length=8) as Smart Turn's own inference.py calls it:
 *          the audio cut to its last 8 s (or padded with silence at the start), normalised to zero mean
 *          and unit variance, a centred short-time Fourier transform (400-sample Hann window, 160-sample
 *          hop), power, Slaney mel filters (80 bands, 0–8 kHz), log10, floored at the maximum minus 8,
 *          then (x + 4) / 4; the last frame is dropped.
 * Used by: src/core/turn/turn.worker.ts; tests
 * Depends on: nothing (pure)
 * Architecture: docs/decisions/ADR-0065-end-of-question-and-none-replies.md
 *
 * Numbers only: the audio is never kept beyond the call.
 */

/** Sample rate the model takes. */
export const TURN_RATE = 16_000;
/** Seconds of audio the model reads. */
export const TURN_SECONDS = 8;
/** Samples the model reads (8 s at 16 kHz). */
export const TURN_SAMPLES = TURN_RATE * TURN_SECONDS;
/** FFT size (25 ms). */
const N_FFT = 400;
/** Hop between frames (10 ms). */
const HOP = 160;
/** Frequency bins of the power spectrum. */
const BINS = N_FFT / 2 + 1;
/** Mel bands. */
export const N_MELS = 80;
/** Frames the model reads. */
export const N_FRAMES = TURN_SAMPLES / HOP;

/**
 * The last 8 s of some audio, padded with silence at the start when shorter (Smart Turn's
 * truncate_audio_to_last_n_seconds).
 *
 * @param audio 16 kHz samples.
 * @returns Exactly TURN_SAMPLES samples.
 * Called from: turnFeatures(); tests
 */
export function lastEightSeconds(audio: Float32Array): Float32Array {
  if (audio.length >= TURN_SAMPLES) return audio.slice(audio.length - TURN_SAMPLES);
  const out = new Float32Array(TURN_SAMPLES);
  out.set(audio, TURN_SAMPLES - audio.length);
  return out;
}

/**
 * Slaney's mel scale (as librosa and Hugging Face use for Whisper).
 *
 * @param hz Frequency in Hz.
 * @returns Mels.
 */
function hzToMel(hz: number): number {
  const fSp = 200 / 3;
  if (hz < 1_000) return hz / fSp;
  return 15 + Math.log(hz / 1_000) / (Math.log(6.4) / 27);
}

/**
 * The inverse of hzToMel().
 *
 * @param mel Mels.
 * @returns Frequency in Hz.
 */
function melToHz(mel: number): number {
  const fSp = 200 / 3;
  if (mel < 15) return mel * fSp;
  return 1_000 * Math.exp((mel - 15) * (Math.log(6.4) / 27));
}

/**
 * Whisper's mel filter bank: 80 triangular filters over 201 bins, Slaney-normalised.
 *
 * @returns filters[mel][bin].
 * Called from: melFilters (once)
 */
export function melFilterBank(): Float32Array[] {
  const fftFreqs = Array.from({ length: BINS }, (_, i) => (i * (TURN_RATE / 2)) / (BINS - 1));
  const melMin = hzToMel(0);
  const melMax = hzToMel(TURN_RATE / 2);
  const points = Array.from({ length: N_MELS + 2 }, (_, i) =>
    melToHz(melMin + ((melMax - melMin) * i) / (N_MELS + 1)),
  );
  const filters: Float32Array[] = [];
  for (let m = 0; m < N_MELS; m += 1) {
    const lower = points[m]!;
    const centre = points[m + 1]!;
    const upper = points[m + 2]!;
    const norm = 2 / (upper - lower);
    const row = new Float32Array(BINS);
    for (let b = 0; b < BINS; b += 1) {
      const f = fftFreqs[b]!;
      const down = (f - lower) / (centre - lower);
      const up = (upper - f) / (upper - centre);
      row[b] = Math.max(0, Math.min(down, up)) * norm;
    }
    filters.push(row);
  }
  return filters;
}

/** The filter bank, made once. */
let filters: Float32Array[] | null = null;
/** Each filter's first and last non-zero bin (a triangle covers a few bins only), made once. */
let ranges: [number, number][] = [];
/** The periodic Hann window, made once. */
let hann: Float32Array | null = null;

/**
 * Makes the tables the first time they are needed.
 */
function ensureTables(): void {
  if (filters && hann) return;
  filters = melFilterBank();
  ranges = filters.map((row) => {
    let first = row.findIndex((value) => value !== 0);
    if (first === -1) first = 0;
    let last = row.length - 1;
    while (last > first && row[last] === 0) last -= 1;
    return [first, last];
  });
  hann = Float32Array.from(
    { length: N_FFT },
    (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT),
  );
}

/** cos and sin of -2πk/N_FFT for k = 0…N_FFT-1: every transform length used divides N_FFT. */
const TWIDDLE_COS = Float64Array.from({ length: N_FFT }, (_, k) =>
  Math.cos((-2 * Math.PI * k) / N_FFT),
);
const TWIDDLE_SIN = Float64Array.from({ length: N_FFT }, (_, k) =>
  Math.sin((-2 * Math.PI * k) / N_FFT),
);

/** Scratch buffers per transform length (each length appears once in the recursion), made once. */
const scratch = new Map<number, { re: Float64Array; im: Float64Array; twiddle: Int32Array }>();

/**
 * The scratch buffers for one transform length.
 *
 * @param n The length.
 * @returns Its buffers.
 */
function scratchFor(n: number): { re: Float64Array; im: Float64Array; twiddle: Int32Array } {
  let buffers = scratch.get(n);
  if (!buffers) {
    // The twiddle index of each (r, output) pair: ((r · out) mod n) · N_FFT / n, so the inner loop
    // does no modulo. p is at most 5.
    const twiddle = new Int32Array(5 * n);
    for (let r = 0; r < 5; r += 1) {
      for (let out = 0; out < n; out += 1) twiddle[r * n + out] = ((r * out) % n) * (N_FFT / n);
    }
    buffers = { re: new Float64Array(n), im: new Float64Array(n), twiddle };
    scratch.set(n, buffers);
  }
  return buffers;
}

/**
 * Transforms the n elements src[offset + k·stride] into out[outAt … outAt+n), by mixed-radix
 * decimation in time. No allocation after the first call per length (the twiddles come from the table).
 *
 * @param srcRe  Source real parts.
 * @param srcIm  Source imaginary parts.
 * @param offset First element.
 * @param stride Step between elements.
 * @param n      How many (a divisor of N_FFT made of 2s, 3s and 5s).
 * @param outRe  Destination real parts.
 * @param outIm  Destination imaginary parts.
 * @param outAt  Where to write.
 */
function fftInto(
  srcRe: Float64Array,
  srcIm: Float64Array,
  offset: number,
  stride: number,
  n: number,
  outRe: Float64Array,
  outIm: Float64Array,
  outAt: number,
): void {
  if (n === 1) {
    outRe[outAt] = srcRe[offset]!;
    outIm[outAt] = srcIm[offset]!;
    return;
  }
  const p = n % 2 === 0 ? 2 : n % 3 === 0 ? 3 : n % 5 === 0 ? 5 : 0;
  if (p === 0 || N_FFT % n !== 0) throw new Error(`fft: unsupported length ${n}`);
  const m = n / p;
  const tmp = scratchFor(n);
  // The p interleaved sub-sequences, each transformed into its block of tmp.
  for (let r = 0; r < p; r += 1) {
    fftInto(srcRe, srcIm, offset + r * stride, stride * p, m, tmp.re, tmp.im, r * m);
  }
  // Combine: X[j + q·m] = Σ_r W_n^(r·(j + q·m)) · Y_r[j], with W_n^x = W_N^(x·N/n).
  const table = tmp.twiddle;
  for (let q = 0; q < p; q += 1) {
    for (let j = 0; j < m; j += 1) {
      const out = j + q * m;
      let sumRe = 0;
      let sumIm = 0;
      for (let r = 0; r < p; r += 1) {
        const k = table[r * n + out]!;
        const c = TWIDDLE_COS[k]!;
        const s = TWIDDLE_SIN[k]!;
        const yr = tmp.re[r * m + j]!;
        const yi = tmp.im[r * m + j]!;
        sumRe += yr * c - yi * s;
        sumIm += yr * s + yi * c;
      }
      outRe[outAt + out] = sumRe;
      outIm[outAt + out] = sumIm;
    }
  }
}

/**
 * A mixed-radix fast Fourier transform for lengths that divide N_FFT (400 = 2⁴ × 5²), in place on
 * separate real and imaginary arrays. The plain 400-point transform took about 0.4 s per judgment
 * (measured 9 Nov 2026); this takes a few tens of milliseconds for all 800 frames.
 *
 * @param re Real parts (changed in place).
 * @param im Imaginary parts (changed in place).
 * @throws Error for a length that does not divide N_FFT.
 * Called from: turnFeatures(); tests
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  const inRe = re.slice();
  const inIm = im.slice();
  fftInto(inRe, inIm, 0, 1, n, re, im, 0);
}

/**
 * Reflect-pads a signal by `pad` samples on each side (numpy's mode="reflect").
 *
 * @param signal The signal.
 * @param pad    Samples on each side.
 * @returns The padded signal.
 */
function reflectPad(signal: Float32Array, pad: number): Float32Array {
  const out = new Float32Array(signal.length + 2 * pad);
  out.set(signal, pad);
  for (let i = 0; i < pad; i += 1) {
    out[pad - 1 - i] = signal[i + 1] ?? 0;
    out[pad + signal.length + i] = signal[signal.length - 2 - i] ?? 0;
  }
  return out;
}

/**
 * The Smart Turn input for some audio: 80 × 800 log-mel features, row by row (mel band first).
 *
 * @param audio 16 kHz samples (any length; the last 8 s are used).
 * @returns N_MELS × N_FRAMES values.
 * Called from: turn.worker.ts; tests
 */
export function turnFeatures(audio: Float32Array): Float32Array {
  ensureTables();
  const samples = lastEightSeconds(audio);
  // Zero mean, unit variance over the 8 s window (do_normalize=True).
  let mean = 0;
  for (const value of samples) mean += value;
  mean /= samples.length;
  let variance = 0;
  for (const value of samples) variance += (value - mean) ** 2;
  variance /= samples.length;
  const scale = 1 / Math.sqrt(variance + 1e-7);
  const normal = samples.map((value) => (value - mean) * scale);
  const padded = reflectPad(normal, N_FFT / 2);
  const frames = 1 + Math.floor((padded.length - N_FFT) / HOP);
  const logMel = new Float32Array(N_MELS * N_FRAMES);
  const frameRe = new Float64Array(N_FFT);
  const frameIm = new Float64Array(N_FFT);
  const power = new Float32Array(BINS);
  let maximum = Number.NEGATIVE_INFINITY;
  // The last frame is dropped (log_spec[:, :-1]).
  for (let t = 0; t < Math.min(frames - 1, N_FRAMES); t += 1) {
    for (let n = 0; n < N_FFT; n += 1) {
      frameRe[n] = (padded[t * HOP + n] ?? 0) * hann![n]!;
      frameIm[n] = 0;
    }
    fft(frameRe, frameIm);
    for (let k = 0; k < BINS; k += 1) power[k] = frameRe[k]! ** 2 + frameIm[k]! ** 2;
    for (let m = 0; m < N_MELS; m += 1) {
      const filter = filters![m]!;
      let energy = 0;
      const [first, last] = ranges[m]!;
      for (let k = first; k <= last; k += 1) energy += filter[k]! * power[k]!;
      const value = Math.log10(Math.max(energy, 1e-10));
      logMel[m * N_FRAMES + t] = value;
      if (value > maximum) maximum = value;
    }
  }
  const floor = maximum - 8;
  for (let i = 0; i < logMel.length; i += 1) logMel[i] = (Math.max(logMel[i]!, floor) + 4) / 4;
  return logMel;
}
