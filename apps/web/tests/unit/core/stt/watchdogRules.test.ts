/**
 * Tests for the stuck-engine watchdog's rules in apps/web/src/core/stt/watchdog.ts (ADR-0076, P0-4): sound
 * counts only on a channel the on-device engine really decodes, and the engine is never restarted while the
 * worker is behind.
 */
import { describe, expect, it } from 'vitest';
import { mayRestart, soundCountsForWatchdog } from '@/core/stt/watchdog';

describe('soundCountsForWatchdog', () => {
  it('never counts a channel on Deepgram', () => {
    expect(soundCountsForWatchdog('them', false, 'ok')).toBe(false);
    expect(soundCountsForWatchdog('you', false, 'ok')).toBe(false);
  });

  it('does not count "You" while the worker sets it aside, nor "Them" while it skips it', () => {
    expect(soundCountsForWatchdog('you', true, 'ok')).toBe(true);
    expect(soundCountsForWatchdog('you', true, 'you-paused')).toBe(false);
    expect(soundCountsForWatchdog('you', true, 'dropping')).toBe(false);
    expect(soundCountsForWatchdog('them', true, 'you-paused')).toBe(true);
    expect(soundCountsForWatchdog('them', true, 'dropping')).toBe(false);
  });
});

describe('mayRestart', () => {
  it('only while the worker keeps up', () => {
    expect(mayRestart('ok')).toBe(true);
    expect(mayRestart('you-paused')).toBe(false);
    expect(mayRestart('dropping')).toBe(false);
  });
});
