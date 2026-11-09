/**
 * Tests for apps/web/src/core/live/callStart.ts: the desktop Connect card asks the main window's live
 * page to connect, once, through a short-lived note and a channel; the live page answers on the
 * channel (ADR-0055). Only a session id and a state travel.
 */
import { describe, expect, it } from 'vitest';
import {
  CALL_START_KEY,
  CALL_START_TTL_MS,
  reportCallStart,
  requestCallStart,
  takeCallStart,
  watchCallStart,
  type CallStartDeps,
  type CallStartMessage,
} from '@/core/live/callStart';

/** A settable clock. */
interface Clock {
  /** The time, in ms. */
  now: number;
}

/**
 * Fake storage and a fake channel shared by every "window" in a test.
 *
 * @returns The dependencies, the clock and what was posted.
 */
function fakes(): { deps: CallStartDeps; clock: Clock; posted: CallStartMessage[] } {
  const store = new Map<string, string>();
  const listeners = new Set<(event: Event) => void>();
  const posted: CallStartMessage[] = [];
  const clock: Clock = { now: 1_000_000 };
  const deps: CallStartDeps = {
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
    openChannel: () => {
      const own = new Set<(event: Event) => void>();
      return {
        postMessage: (data: CallStartMessage) => {
          posted.push(data);
          for (const listener of listeners) listener({ data } as unknown as Event);
        },
        close: () => {
          for (const listener of own) listeners.delete(listener);
        },
        addEventListener: (_type: string, listener: (event: Event) => void) => {
          own.add(listener);
          listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: (event: Event) => void) => {
          own.delete(listener);
          listeners.delete(listener);
        },
      } as unknown as BroadcastChannel;
    },
    now: () => clock.now,
  };
  return { deps, clock, posted };
}

describe('requestCallStart and takeCallStart', () => {
  it('starts the session asked for, once', () => {
    const { deps } = fakes();
    requestCallStart('s1', deps);
    expect(takeCallStart('s2', deps)).toBe(false);
    expect(takeCallStart('s1', deps)).toBe(true);
    expect(takeCallStart('s1', deps)).toBe(false);
  });

  it('ignores a note older than the time limit', () => {
    const { deps, clock } = fakes();
    requestCallStart('s1', deps);
    clock.now += CALL_START_TTL_MS + 1;
    expect(takeCallStart('s1', deps)).toBe(false);
    expect(deps.storage?.getItem(CALL_START_KEY)).toBeNull();
  });

  it('ignores a damaged note', () => {
    const { deps } = fakes();
    deps.storage?.setItem(CALL_START_KEY, '{not json');
    expect(takeCallStart('s1', deps)).toBe(false);
  });

  it('tells a live page that is already open', () => {
    const { deps } = fakes();
    const seen: string[] = [];
    const stop = watchCallStart('s1', 'start', (message) => seen.push(message.sessionId), deps);
    requestCallStart('s1', deps);
    requestCallStart('s2', deps);
    stop();
    requestCallStart('s1', deps);
    expect(seen).toEqual(['s1']);
  });
});

describe('reportCallStart', () => {
  it('reaches the card of the same session with the state and the sentence', () => {
    const { deps } = fakes();
    const seen: unknown[] = [];
    const stop = watchCallStart('s1', 'status', (message) => seen.push(message), deps);
    reportCallStart('s1', 'connected', undefined, deps);
    reportCallStart('s1', 'failed', 'Allow the microphone.', deps);
    reportCallStart('s2', 'failed', 'Other session', deps);
    stop();
    expect(seen).toEqual([
      { type: 'status', sessionId: 's1', state: 'connected' },
      { type: 'status', sessionId: 's1', state: 'failed', message: 'Allow the microphone.' },
    ]);
  });

  it('does nothing where the channel and storage are missing', () => {
    const deps: CallStartDeps = { storage: null, openChannel: null, now: () => 0 };
    expect(() => requestCallStart('s1', deps)).not.toThrow();
    expect(takeCallStart('s1', deps)).toBe(false);
    expect(watchCallStart('s1', 'status', () => undefined, deps)).toBeTypeOf('function');
  });
});
