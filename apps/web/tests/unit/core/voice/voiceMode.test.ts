/**
 * Tests apps/web/src/core/voice/voiceMode.ts (ADR-0095), with the dictation and the clock faked: on, it
 * listens; after a question is sent, and after a quiet stretch, it listens again; while the other person
 * speaks it pauses, dropping what was collected, and resumes 2 s after their last words; off stops it and
 * cancels a pending resume; while on, the user's words never become transcript lines (diverts()).
 */
import { describe, expect, it, vi } from 'vitest';
import { createVoiceMode, VOICE_RESUME_MS, type VoiceModeState } from '@/core/voice/voiceMode';
import type { DictationTimers } from '@/core/voice/dictation';

/**
 * A fake clock for the injected timers.
 *
 * @returns The timers and a function that moves the clock on.
 */
function fakeClock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: DictationTimers = {
    set: (callback, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, callback });
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  /**
   * Moves the clock on, running every timer that falls due.
   *
   * @param ms How far.
   */
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > now) continue;
      pending.delete(id);
      timer.callback();
    }
  };
  return { timers, advance };
}

/**
 * Voice mode with a fake dictation and clock.
 *
 * @returns Voice mode, the dictation's spies, the states it reported and the clock.
 */
function setup() {
  const dictation = { start: vi.fn(), stop: vi.fn() };
  const states: VoiceModeState[] = [];
  const clock = fakeClock();
  const voice = createVoiceMode({
    dictation,
    onChange: (state) => states.push(state),
    timers: clock.timers,
  });
  return { voice, dictation, states, clock };
}

describe('createVoiceMode', () => {
  it('starts off, diverting nothing', () => {
    const { voice, dictation } = setup();
    expect(voice.state()).toBe('off');
    expect(voice.diverts()).toBe(false);
    voice.them();
    expect(voice.afterSend()).toBe(false);
    expect(voice.afterStop('idle')).toBe(false);
    expect(dictation.start).not.toHaveBeenCalled();
  });

  it('listens when turned on, and again after each question is sent', () => {
    const { voice, dictation, states } = setup();
    voice.on();
    expect(states).toEqual(['listening']);
    expect(voice.diverts()).toBe(true);
    expect(dictation.start).toHaveBeenCalledTimes(1);
    expect(voice.afterSend()).toBe(true);
    expect(dictation.start).toHaveBeenCalledTimes(2);
  });

  it('listens on after a quiet stretch, with no notice', () => {
    const { voice, dictation } = setup();
    voice.on();
    expect(voice.afterStop('idle')).toBe(true);
    expect(dictation.start).toHaveBeenCalledTimes(2);
  });

  it('pauses while the other person speaks and resumes 2 s after their last words', () => {
    const { voice, dictation, states, clock } = setup();
    voice.on();
    voice.them();
    expect(voice.state()).toBe('paused');
    // Their words may have come through the speakers: what was collected is dropped.
    expect(dictation.stop).toHaveBeenCalledTimes(1);
    // The stop it asked for is handled: no notice, no restart.
    expect(voice.afterStop('stopped')).toBe(true);
    expect(voice.diverts()).toBe(true);
    clock.advance(1_500);
    // They are still speaking: the 2 s start again from their latest words.
    voice.them();
    expect(dictation.stop).toHaveBeenCalledTimes(1);
    clock.advance(VOICE_RESUME_MS - 1);
    expect(voice.state()).toBe('paused');
    clock.advance(1);
    expect(voice.state()).toBe('listening');
    expect(dictation.start).toHaveBeenCalledTimes(2);
    expect(states).toEqual(['listening', 'paused', 'listening']);
  });

  it('does not restart a paused dictation after a question or a quiet stretch', () => {
    const { voice, dictation } = setup();
    voice.on();
    voice.them();
    expect(voice.afterSend()).toBe(true);
    expect(voice.afterStop('idle')).toBe(true);
    expect(dictation.start).toHaveBeenCalledTimes(1);
  });

  it('stops when turned off, and a pending resume never fires', () => {
    const { voice, dictation, clock } = setup();
    voice.on();
    voice.them();
    voice.off();
    expect(voice.state()).toBe('off');
    expect(voice.diverts()).toBe(false);
    expect(dictation.stop).toHaveBeenCalledTimes(2);
    clock.advance(VOICE_RESUME_MS * 2);
    expect(voice.state()).toBe('off');
    expect(dictation.start).toHaveBeenCalledTimes(1);
    // Off twice does nothing more.
    voice.off();
    expect(dictation.stop).toHaveBeenCalledTimes(2);
  });

  it('clears its timer on dispose', () => {
    const { voice, clock } = setup();
    voice.on();
    voice.them();
    voice.dispose();
    clock.advance(VOICE_RESUME_MS);
    expect(voice.state()).toBe('paused');
  });
});
