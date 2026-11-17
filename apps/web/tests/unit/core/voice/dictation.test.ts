/**
 * Tests for apps/web/src/core/voice/dictation.ts (item 8, ADR-0038), with fake timers: the message
 * is sent once after a pause that follows a final line, and listening then stops; speech in the
 * pause delays sending; filler alone is not sent; nothing heard stops listening without sending;
 * stop() never sends; events outside listening are ignored. Also shouldDivert(): words dictated to
 * Kite leave the call's transcript, words "For the call" stay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDictation,
  IDLE_STOP_MS,
  isMeaningful,
  SEND_PAUSE_MS,
  shouldDivert,
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

describe('ADR-0099: the pause that sends', () => {
  it('is 1 second (it was 1.5 s)', () => {
    expect(SEND_PAUSE_MS).toBe(1_000);
  });
});
