/**
 * Tests for apps/web/src/core/stt/coupling.ts (v1.4, ADR-0064) with synthetic signals: when the
 * microphone hears only a delayed, quieter copy of the other side (speakers), the gate learns the delay
 * and level and silences those chunks; the user's own louder speech over the other side passes; with
 * headphones (the microphone has its own, unrelated sound) nothing is ever learnt or silenced; and the
 * reference check tells whether the other side's sound for a chunk has arrived.
 */
import { describe, expect, it } from 'vitest';
import { CouplingGate, frameEnergies, FRAME_SAMPLES } from '@/core/stt/coupling';

/** 100 ms chunks at 16 kHz. */
const CHUNK = 1_600;

/**
 * Speech-like sound: a tone whose loudness rises and falls in syllables, with pauses.
 *
 * @param seconds How long.
 * @param seed    Changes the rhythm.
 * @returns The samples.
 */
function speechLike(seconds: number, seed: number): Float32Array {
  const out = new Float32Array(seconds * 16_000);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / 16_000;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * (2.7 + seed * 0.37) * t + seed));
    const phrase = Math.sin(2 * Math.PI * 0.21 * t + seed) > -0.3 ? 1 : 0;
    out[i] = 0.2 * syllable * phrase * Math.sin(2 * Math.PI * (180 + 40 * seed) * t);
  }
  return out;
}

/**
 * The microphone's copy of a signal: delayed and quieter, plus a faint floor.
 *
 * @param signal  The other side's sound.
 * @param delayMs The delay.
 * @param gain    The level (amplitude factor).
 * @returns The microphone track.
 */
function echoOf(signal: Float32Array, delayMs: number, gain: number): Float32Array {
  const delay = (delayMs / 1000) * 16_000;
  return signal.map(
    (_, i) => (i >= delay ? signal[i - delay]! * gain : 0) + 0.0005 * Math.sin(i * 1.3),
  );
}

/**
 * Feeds both tracks chunk by chunk, "them" first, and returns which microphone chunks were silenced.
 *
 * @param gate The gate.
 * @param you  The microphone track.
 * @param them The other side's track.
 * @returns One flag per chunk.
 */
function run(gate: CouplingGate, you: Float32Array, them: Float32Array): boolean[] {
  const silenced: boolean[] = [];
  for (let i = 0, n = 1; i + CHUNK <= you.length; i += CHUNK, n += 1) {
    gate.pushThem(them.slice(i, i + CHUNK), n / 10);
    const mic = you.slice(i, i + CHUNK);
    const out = gate.processYou(mic, n / 10);
    silenced.push(out.every((value) => value === 0) && mic.some((value) => value !== 0));
  }
  return silenced;
}

describe('CouplingGate', () => {
  it('measures 10 ms frame energies', () => {
    const energies = frameEnergies(new Float32Array(FRAME_SAMPLES * 2).fill(0.5));
    expect(Array.from(energies)).toEqual([0.25, 0.25]);
  });

  it('learns the speakers echo and silences it', () => {
    const them = speechLike(12, 1);
    const gate = new CouplingGate();
    const mic = echoOf(them, 80, 0.09);
    const silenced = run(gate, mic, them);
    const state = gate.state();
    expect(state.trusted).toBe(true);
    expect(state.delayMs).toBeGreaterThanOrEqual(60);
    expect(state.delayMs).toBeLessThanOrEqual(100);
    expect(state.gainDb).toBeGreaterThan(-26);
    expect(state.gainDb).toBeLessThan(-16);
    // After the first seconds of learning, most chunks that carry an audible echo are silenced.
    const audible = silenced
      .map((flag, k) => ({ flag, k }))
      .filter(({ k }) => k >= 60)
      .filter(({ k }) =>
        frameEnergies(mic.slice(k * CHUNK, (k + 1) * CHUNK)).some((e) => e > 1e-4),
      );
    expect(audible.filter(({ flag }) => flag).length / audible.length).toBeGreaterThan(0.8);
  });

  it('lets the user talk over the other side', () => {
    const them = speechLike(16, 1);
    const user = speechLike(16, 4);
    const mic = echoOf(them, 80, 0.09);
    // The user talks, as loud as the other side, in the last 6 seconds.
    for (let i = 10 * 16_000; i < mic.length; i += 1) mic[i] = mic[i]! + user[i]!;
    const gate = new CouplingGate();
    const silenced = run(gate, mic, them);
    const overlapping = silenced.slice(100);
    const userActive = overlapping.filter((_, k) => {
      const at = (100 + k) * CHUNK;
      return frameEnergies(user.slice(at, at + CHUNK)).some((energy) => energy > 1e-3);
    });
    expect(userActive.filter(Boolean).length).toBeLessThanOrEqual(userActive.length * 0.15);
  });

  it('learns nothing and silences nothing with headphones', () => {
    const them = speechLike(12, 1);
    const gate = new CouplingGate();
    const silenced = run(gate, speechLike(12, 5), them);
    expect(gate.state().trusted).toBe(false);
    expect(silenced.some(Boolean)).toBe(false);
  });

  it('knows whether the reference for a chunk has arrived', () => {
    const gate = new CouplingGate();
    const chunk = new Float32Array(CHUNK);
    expect(gate.hasReferenceFor(chunk, 1)).toBe(false);
    gate.pushThem(chunk, 1);
    expect(gate.hasReferenceFor(chunk, 1)).toBe(true);
    expect(gate.hasReferenceFor(chunk, 1.1)).toBe(false);
  });
});
