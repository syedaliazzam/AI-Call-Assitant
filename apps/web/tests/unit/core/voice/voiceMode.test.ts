/**
 * Tests apps/web/src/core/voice/voiceMode.ts (ADR-0095, ADR-0101), with the dictation and the clock faked: on,
 * it listens continuously; after a quiet stretch it listens again; a short sound from the other person
 * ("mm-hmm", a noise) changes nothing; their real speech first sends what the user had said, then pauses
 * until 2 s after their last words; off stops it and cancels a pending resume; while on, the user's words
 * never become transcript lines (diverts()).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createVoiceMode,
  isRealSpeech,
  VOICE_RESUME_MS,
  type VoiceModeState,
} from '@/core/voice/voiceMode';
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
  const dictation = { start: vi.fn(), stop: vi.fn(), sendNow: vi.fn(() => true) };
  const states: VoiceModeState[] = [];
  const clock = fakeClock();
  const voice = createVoiceMode({
    dictation,
    onChange: (state) => states.push(state),
    timers: clock.timers,
  });
  return { voice, dictation, states, clock };
}

/** Real speech from the other person: a few words. */
const SPEECH = { words: 4, ms: 900 };

describe('createVoiceMode', () => {
  it('starts off, diverting nothing', () => {
    const { voice, dictation } = setup();
    expect(voice.state()).toBe('off');
    expect(voice.diverts()).toBe(false);
    voice.them(SPEECH);
    expect(voice.afterSend()).toBe(false);
    expect(voice.afterStop('idle')).toBe(false);
    expect(dictation.start).not.toHaveBeenCalled();
  });

  it('listens continuously when turned on; a question sent needs no restart', () => {
    const { voice, dictation, states } = setup();
    voice.on();
    expect(states).toEqual(['listening']);
    expect(voice.diverts()).toBe(true);
    expect(dictation.start).toHaveBeenCalledWith({ continuous: true });
    expect(voice.afterSend()).toBe(true);
    expect(dictation.start).toHaveBeenCalledTimes(1);
  });

  it('listens on after a quiet stretch, with no notice', () => {
    const { voice, dictation } = setup();
    voice.on();
    expect(voice.afterStop('idle')).toBe(true);
    expect(dictation.start).toHaveBeenCalledTimes(2);
  });

  it('ADR-0101: a short sound from the other side neither pauses nor loses anything', () => {
    const { voice, dictation } = setup();
    voice.on();
    voice.them({ words: 1, ms: 300 });
    voice.them({ words: 2, ms: 700 });
    expect(voice.state()).toBe('listening');
    expect(dictation.sendNow).not.toHaveBeenCalled();
    expect(dictation.stop).not.toHaveBeenCalled();
    expect(isRealSpeech({ words: 2, ms: 999 })).toBe(false);
    expect(isRealSpeech({ words: 3, ms: 0 })).toBe(true);
    expect(isRealSpeech({ words: 1, ms: 1_000 })).toBe(true);
  });

  it('ADR-0101: real speech sends what the user said, then pauses and resumes 2 s after their last words', () => {
    const { voice, dictation, states, clock } = setup();
    voice.on();
    voice.them(SPEECH);
    expect(dictation.sendNow).toHaveBeenCalledTimes(1);
    expect(dictation.sendNow.mock.invocationCallOrder[0]).toBeLessThan(
      dictation.stop.mock.invocationCallOrder[0]!,
    );
    expect(voice.state()).toBe('paused');
    expect(dictation.stop).toHaveBeenCalledTimes(1);
    // The stop it asked for is handled: no notice, no restart.
    expect(voice.afterStop('stopped')).toBe(true);
    expect(voice.diverts()).toBe(true);
    clock.advance(1_500);
    // They are still speaking: the 2 s start again from their latest words.
    voice.them(SPEECH);
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
    voice.them(SPEECH);
    expect(voice.afterSend()).toBe(true);
    expect(voice.afterStop('idle')).toBe(true);
    expect(dictation.start).toHaveBeenCalledTimes(1);
  });

  it('stops when turned off, and a pending resume never fires', () => {
    const { voice, dictation, clock } = setup();
    voice.on();
    voice.them(SPEECH);
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
    voice.them(SPEECH);
    voice.dispose();
    clock.advance(VOICE_RESUME_MS);
    expect(voice.state()).toBe('paused');
  });
});
