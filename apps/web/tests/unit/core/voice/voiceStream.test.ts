/**
 * Tests apps/web/src/core/voice/voiceStream.ts (ADR-0101), with the real dictation and fake timers: the voice
 * stream's EagerEndOfTurn starts the answer held hidden and it is shown after the hold; TurnResumed cancels
 * it; EndOfTurn's final words show it at once; the newest word's end is returned for the timing trace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDictation, VOICE_HOLD_MS } from '@/core/voice/dictation';
import { feedVoiceEvent } from '@/core/voice/voiceStream';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * A call dictation with spies.
 *
 * @returns The dictation and its spies.
 */
function setup() {
  const onSend = vi.fn();
  const onSpeculate = vi.fn();
  const onCancel = vi.fn();
  const dictation = createDictation({ onSend, onSpeculate, onCancel, holdMs: VOICE_HOLD_MS });
  dictation.start();
  return { dictation, onSend, onSpeculate, onCancel };
}

describe('feedVoiceEvent', () => {
  it('an early end starts the answer held hidden; it is shown after the hold', () => {
    const { dictation, onSend, onSpeculate } = setup();
    const ended = feedVoiceEvent(dictation, {
      type: 'partial',
      text: 'What is the notice period',
      tStart: 1_000,
      tEnd: 2_500,
    });
    expect(ended).toBe(2_500);
    expect(
      feedVoiceEvent(dictation, { type: 'turn', event: 'eager', confidence: 0.6, at: 2_800 }),
    ).toBeNull();
    expect(onSpeculate).toHaveBeenCalledWith('What is the notice period');
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onSend).toHaveBeenCalledWith('What is the notice period');
  });

  it('TurnResumed cancels the held answer', () => {
    const { dictation, onCancel, onSend } = setup();
    feedVoiceEvent(dictation, { type: 'partial', text: 'How does it work', tStart: 0, tEnd: 900 });
    feedVoiceEvent(dictation, { type: 'turn', event: 'eager', confidence: 0.6, at: 1_200 });
    feedVoiceEvent(dictation, { type: 'turn', event: 'resumed', confidence: null, at: 1_300 });
    expect(onCancel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(VOICE_HOLD_MS * 2);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("EndOfTurn's final words show the answer at once", () => {
    const { dictation, onSend } = setup();
    feedVoiceEvent(dictation, {
      type: 'final',
      text: 'What is the onboarding fee',
      tStart: 0,
      tEnd: 1_400,
      endOfTurn: true,
    });
    expect(onSend).toHaveBeenCalledWith('What is the onboarding fee');
  });
});
