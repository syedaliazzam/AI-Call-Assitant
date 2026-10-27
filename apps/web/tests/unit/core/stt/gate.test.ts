/**
 * Tests for apps/web/src/core/stt/gate.ts:
 * chunkRms() measures loudness; SilenceGate starts closed and holds back silence, opens on a
 * loud chunk and passes the latest 300 ms of held-back audio first, stays open for 1.5 s after
 * the last loud chunk, stays open while the caller is busy (an utterance shows text), ignores
 * steady background noise (after the 5 s background window), and opens for quiet speech above
 * the 0.004 floor.
 */
import { describe, expect, it } from 'vitest';
import { chunkRms, SilenceGate, type GateChunk } from '@/core/stt/gate';

/** A 100 ms chunk with a constant level (RMS = level) and a capture time. */
function chunk(level: number, endTime: number): GateChunk {
  return { samples: new Float32Array(1_600).fill(level), endTime };
}

/** Pushes chunks of the given levels (100 ms each) and returns how many were passed per push. */
function run(gate: SilenceGate, levels: number[], busy = false): number[] {
  return levels.map((level, i) => gate.push(chunk(level, i * 0.1), 100, busy).length);
}

describe('chunkRms', () => {
  it('measures root-mean-square loudness', () => {
    expect(chunkRms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(chunkRms(new Float32Array(0))).toBe(0);
  });
});

describe('SilenceGate', () => {
  it('holds back silence, then passes 300 ms of pre-roll plus the loud chunk', () => {
    const gate = new SilenceGate();
    expect(run(gate, [0, 0, 0, 0, 0])).toEqual([0, 0, 0, 0, 0]);
    expect(gate.isOpen).toBe(false);
    const out = gate.push(chunk(0.1, 0.5), 100, false);
    expect(out.map((c) => c.endTime)).toEqual([0.2, 0.30000000000000004, 0.4, 0.5]);
    expect(gate.isOpen).toBe(true);
  });

  it('stays open for 1.5 s after the last loud chunk, then closes', () => {
    const gate = new SilenceGate();
    gate.push(chunk(0.1, 0), 100, false);
    const after = run(gate, new Array(16).fill(0));
    expect(after.slice(0, 15)).toEqual(new Array(15).fill(1));
    expect(after[15]).toBe(0);
  });

  it('stays open while the caller is busy (text is showing)', () => {
    const gate = new SilenceGate();
    gate.push(chunk(0.1, 0), 100, false);
    expect(run(gate, new Array(40).fill(0), true).every((n) => n === 1)).toBe(true);
  });

  it('ignores steady background noise but opens for quiet speech', () => {
    const noisy = new SilenceGate();
    // Background at 0.006 (above the floor): after it settles, it no longer opens the gate.
    run(noisy, new Array(40).fill(0.006));
    expect(run(noisy, new Array(20).fill(0.006)).every((n) => n === 0)).toBe(true);
    const quiet = new SilenceGate();
    expect(quiet.push(chunk(0.01, 0), 100, false).length).toBe(1);
  });
});
