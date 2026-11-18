/**
 * Tests for apps/web/src/core/voice/dictation.ts (item 8, ADR-0038), with fake timers: the message
 * is sent once after a pause that follows a final line, and listening then stops; speech in the
 * pause delays sending; filler alone is not sent; nothing heard stops listening without sending;
 * stop() never sends; events outside listening are ignored. Also shouldDivert(): words dictated to
 * Kite leave the call's transcript, words "For the call" stay. ADR-0101 (a call's voice question): sent
 * speculatively at the first end-of-speech signal and shown after the hold, cancelled silently when the speaker
 * goes on, extended on the same card after a thinking pause (never half a question), the 1.5 s fallback, words
 * that look cut off, words before the press skipped, sendNow(), continuous listening, and stop while held.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_FALLBACK_MS,
  createDictation,
  IDLE_STOP_MS,
  isMeaningful,
  SEND_PAUSE_MS,
  shouldDivert,
  VOICE_CONTINUE_MS,
  VOICE_HOLD_MS,
  withoutFirstWords,
} from '@/core/voice/dictation';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * A dictation with spies for its callbacks.
 *
 * @returns The dictation and the spies.
 */
function setup() {
  const onSend = vi.fn();
  const onChange = vi.fn();
  const onStop = vi.fn();
  const dictation = createDictation({ onSend, onChange, onStop });
  return { dictation, onSend, onChange, onStop };
}

describe('createDictation', () => {
  it('sends the collected finals once after the pause, then stops listening', () => {
    const { dictation, onSend } = setup();
    dictation.start();
    dictation.partial('what is');
    dictation.final('what is a');
    dictation.final('hash map');
    vi.advanceTimersByTime(SEND_PAUSE_MS - 1);
    expect(onSend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('what is a hash map');
    expect(dictation.listening()).toBe(false);
    // Later speech is not collected.
    dictation.final('more words');
    vi.advanceTimersByTime(SEND_PAUSE_MS * 2);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('waits while the speaker talks again during the pause', () => {
    const { dictation, onSend } = setup();
    dictation.start();
    dictation.final('explain');
    vi.advanceTimersByTime(SEND_PAUSE_MS - 200);
    dictation.partial('big o');
    vi.advanceTimersByTime(SEND_PAUSE_MS);
    expect(onSend).not.toHaveBeenCalled();
    dictation.final('big o notation');
    vi.advanceTimersByTime(SEND_PAUSE_MS);
    expect(onSend).toHaveBeenCalledWith('explain big o notation');
  });

  it('shows the text so far, finals and the partial', () => {
    const { dictation, onChange } = setup();
    dictation.start();
    dictation.final('hello');
    dictation.partial('there');
    expect(onChange).toHaveBeenLastCalledWith('hello there');
    expect(dictation.text()).toBe('hello there');
  });

  it('does not send filler alone and keeps listening', () => {
    const { dictation, onSend } = setup();
    dictation.start();
    dictation.final('um uh');
    vi.advanceTimersByTime(SEND_PAUSE_MS);
    expect(onSend).not.toHaveBeenCalled();
    expect(dictation.listening()).toBe(true);
    dictation.final('what time is it');
    vi.advanceTimersByTime(SEND_PAUSE_MS);
    expect(onSend).toHaveBeenCalledWith('what time is it');
  });

  it('stops without sending when nothing is heard', () => {
    const { dictation, onSend, onStop } = setup();
    dictation.start();
    vi.advanceTimersByTime(IDLE_STOP_MS);
    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledWith('idle');
    expect(dictation.listening()).toBe(false);
  });

  it('stop() never sends what was collected', () => {
    const { dictation, onSend, onStop } = setup();
    dictation.start();
    dictation.final('half a question');
    dictation.stop();
    vi.advanceTimersByTime(SEND_PAUSE_MS * 2);
    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledWith('stopped');
  });

  it('ignores speech before start()', () => {
    const { dictation, onSend, onChange } = setup();
    dictation.final('not listening');
    vi.advanceTimersByTime(SEND_PAUSE_MS);
    expect(onSend).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('start() forgets an earlier, unsent message', () => {
    const { dictation, onSend } = setup();
    dictation.start();
    dictation.final('old words');
    dictation.start();
    dictation.final('new question');
    vi.advanceTimersByTime(SEND_PAUSE_MS);
    expect(onSend).toHaveBeenCalledWith('new question');
  });
});

describe('isMeaningful', () => {
  it('is false for empty text and filler, true for real words', () => {
    expect(isMeaningful('')).toBe(false);
    expect(isMeaningful('  ')).toBe(false);
    expect(isMeaningful('Um, hmm.')).toBe(false);
    expect(isMeaningful('yes')).toBe(true);
    expect(isMeaningful('um what')).toBe(true);
  });
});

describe('shouldDivert', () => {
  it('diverts words dictated to Kite, keeps words for the call and normal speech', () => {
    expect(shouldDivert(true, 'auto')).toBe(true);
    expect(shouldDivert(true, 'kite')).toBe(true);
    expect(shouldDivert(true, 'call')).toBe(false);
    expect(shouldDivert(false, 'auto')).toBe(false);
    expect(shouldDivert(false, 'kite')).toBe(false);
  });
});

describe('the Ask AI page pause (ADR-0101: back to 1.5 s)', () => {
  it('is 1.5 seconds', () => {
    expect(SEND_PAUSE_MS).toBe(1_500);
  });
});

/**
 * A call's voice-question dictation (the settings useCallDictation.ts passes), with spies.
 *
 * @returns The dictation and its spies.
 */
function callSetup() {
  const onSend = vi.fn();
  const onSpeculate = vi.fn();
  const onCancel = vi.fn();
  const onExtend = vi.fn();
  const onStop = vi.fn();
  const dictation = createDictation({
    onSend,
    onSpeculate,
    onCancel,
    onExtend,
    onStop,
    holdMs: VOICE_HOLD_MS,
    fallbackMs: CALL_FALLBACK_MS,
    continueMs: VOICE_CONTINUE_MS,
    unfinished: (text) => /\b(the|of|and|for)$/i.test(text.trim()),
  });
  return { dictation, onSend, onSpeculate, onCancel, onExtend, onStop };
}

describe('a call voice question (ADR-0101)', () => {
  it('starts the answer at the first end-of-speech signal and shows it after the hold', () => {
    const { dictation, onSpeculate, onSend, onStop } = callSetup();
    dictation.start();
    dictation.partial('what is the notice period');
    dictation.signal('eager');
    expect(onSpeculate).toHaveBeenCalledWith('what is the notice period');
    expect(onSend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onSend).toHaveBeenCalledWith('what is the notice period');
    // Its time for more words, then listening ends.
    expect(dictation.listening()).toBe(true);
    vi.advanceTimersByTime(VOICE_CONTINUE_MS);
    expect(dictation.listening()).toBe(false);
    expect(onStop).toHaveBeenCalledWith('done');
  });

  it('cancels silently when the speaker goes on within the hold, then asks the whole question', () => {
    const { dictation, onSpeculate, onCancel, onSend } = callSetup();
    dictation.start();
    dictation.partial('how does bluefin route work');
    dictation.signal('eager');
    vi.advanceTimersByTime(VOICE_HOLD_MS - 50);
    dictation.partial('how does bluefin route work for the night shift');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    dictation.signal('eager');
    expect(onSpeculate).toHaveBeenLastCalledWith('how does bluefin route work for the night shift');
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('how does bluefin route work for the night shift');
  });

  it('cancels on Flux TurnResumed within the hold', () => {
    const { dictation, onCancel, onSend } = callSetup();
    dictation.start();
    dictation.partial('what did the pilot do');
    dictation.signal('eager');
    dictation.resumed();
    expect(onCancel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(VOICE_HOLD_MS * 3);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('never leaves half a question: words after a thinking pause extend the same card', () => {
    const { dictation, onSend, onExtend } = callSetup();
    dictation.start();
    dictation.final('how many depots were part of the pilot');
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onSend).toHaveBeenCalledWith('how many depots were part of the pilot');
    // A thinking pause, then the rest of the question.
    vi.advanceTimersByTime(1_000);
    dictation.partial('and which region');
    dictation.final('and which region were they in');
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onExtend).toHaveBeenCalledWith(
      'how many depots were part of the pilot and which region were they in',
    );
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('shows at once on a definite end (Flux EndOfTurn)', () => {
    const { dictation, onSpeculate, onSend } = callSetup();
    dictation.start();
    dictation.partial('what is the onboarding fee');
    dictation.signal('end');
    expect(onSpeculate).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('what is the onboarding fee');
  });

  it('sends after 1.5 s of silence when no end-of-speech signal comes', () => {
    const { dictation, onSend } = callSetup();
    dictation.start();
    dictation.partial('is single sign on included');
    vi.advanceTimersByTime(CALL_FALLBACK_MS - 1);
    expect(onSend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSend).toHaveBeenCalledWith('is single sign on included');
  });

  it('does not trust an early signal on words that look cut off', () => {
    const { dictation, onSpeculate, onSend } = callSetup();
    dictation.start();
    dictation.partial('what is the price of the');
    dictation.signal('eager');
    expect(onSpeculate).not.toHaveBeenCalled();
    dictation.partial('what is the price of the professional plan');
    dictation.signal('eager');
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onSend).toHaveBeenCalledWith('what is the price of the professional plan');
  });

  it('leaves out words spoken before the press, until that utterance ends', () => {
    const { dictation, onSend } = callSetup();
    dictation.start({ skipWords: 3 });
    dictation.partial('okay so yes what is');
    dictation.final('okay so yes what is the fee');
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onSend).toHaveBeenCalledWith('what is the fee');
    expect(withoutFirstWords('a b c', 5)).toBe('');
  });

  it('sendNow() sends what was said at once (Voice mode, the other person starts speaking)', () => {
    const { dictation, onSend } = callSetup();
    dictation.start({ continuous: true });
    expect(dictation.sendNow()).toBe(false);
    dictation.partial('how does training work');
    expect(dictation.sendNow()).toBe(true);
    expect(onSend).toHaveBeenCalledWith('how does training work');
  });

  it('keeps listening for the next question when continuous', () => {
    const { dictation, onSend } = callSetup();
    dictation.start({ continuous: true });
    dictation.final('first question here');
    vi.advanceTimersByTime(VOICE_HOLD_MS + VOICE_CONTINUE_MS);
    expect(dictation.listening()).toBe(true);
    dictation.final('second question now');
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onSend).toHaveBeenLastCalledWith('second question now');
  });

  it('a held answer is cancelled when listening is stopped', () => {
    const { dictation, onCancel, onSend } = callSetup();
    dictation.start();
    dictation.partial('what is the notice period');
    dictation.signal('eager');
    dictation.stop();
    expect(onCancel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(VOICE_HOLD_MS);
    expect(onSend).not.toHaveBeenCalled();
  });
});
