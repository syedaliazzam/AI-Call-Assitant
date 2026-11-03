/**
 * Tests for apps/web/src/core/stt/watchdog.ts (Day 6 Stage 4): the watchdog reports "stuck" only
 * when speech has arrived after the last transcript progress and no progress has followed for
 * STUCK_MS. Silence never counts as stuck, and any progress clears it. No transcript text is used.
 */
import { describe, expect, it } from 'vitest';
import { STUCK_MS, TranscriptWatchdog } from '@/core/stt/watchdog';

describe('TranscriptWatchdog', () => {
  it('is not stuck before the call starts', () => {
    const w = new TranscriptWatchdog();
    expect(w.isStuck(999_999)).toBe(false);
  });

  it('is not stuck during silence, however long', () => {
    const w = new TranscriptWatchdog();
    w.start(0);
    // No sound noted at all.
    expect(w.isStuck(STUCK_MS + 1_000)).toBe(false);
  });

  it('is stuck when speech arrives but no progress follows for STUCK_MS', () => {
    const w = new TranscriptWatchdog();
    w.start(0);
    w.noteSound(1_000);
    expect(w.isStuck(1_000 + STUCK_MS - 1)).toBe(false);
    expect(w.isStuck(1_000 + STUCK_MS)).toBe(true);
  });

  it('clears when transcript makes progress', () => {
    const w = new TranscriptWatchdog();
    w.start(0);
    w.noteSound(1_000);
    w.noteProgress(2_000); // a partial or final line arrived
    expect(w.isStuck(2_000 + STUCK_MS)).toBe(false);
    // A new stretch of speech with no progress starts the clock again.
    w.noteSound(3_000);
    expect(w.isStuck(3_000 + STUCK_MS)).toBe(true);
  });

  it('reports the gap since progress for the restart log', () => {
    const w = new TranscriptWatchdog();
    expect(w.msSinceProgress(5_000)).toBeNull();
    w.start(1_000);
    expect(w.msSinceProgress(5_000)).toBe(4_000);
  });

  it('honours a custom stuck time', () => {
    const w = new TranscriptWatchdog({ stuckMs: 3_000 });
    w.start(0);
    w.noteSound(0);
    expect(w.isStuck(2_999)).toBe(false);
    expect(w.isStuck(3_000)).toBe(true);
  });
});
