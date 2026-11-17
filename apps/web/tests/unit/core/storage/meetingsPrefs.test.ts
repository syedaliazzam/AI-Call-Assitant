/**
 * Tests for apps/web/src/core/storage/meetingsPrefs.ts (ADR-0096): the Meetings library remembers the call
 * opened last; nothing is remembered at first; an over-long value is ignored; blocked storage never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MEETINGS_LAST_CALL_KEY,
  getLastMeetingCall,
  setLastMeetingCall,
} from '@/core/storage/meetingsPrefs';

/**
 * Installs a working localStorage stand-in.
 *
 * @returns The values it holds.
 */
function fakeStorage(): Map<string, string> {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the last opened call', () => {
  it('is null at first, then the call opened last', () => {
    const values = fakeStorage();
    expect(getLastMeetingCall()).toBeNull();
    setLastMeetingCall('call-1');
    setLastMeetingCall('call-2');
    expect(getLastMeetingCall()).toBe('call-2');
    expect(values.get(MEETINGS_LAST_CALL_KEY)).toBe('call-2');
  });

  it('ignores an empty or over-long id', () => {
    const values = fakeStorage();
    setLastMeetingCall('');
    setLastMeetingCall('x'.repeat(500));
    expect(values.size).toBe(0);
    values.set(MEETINGS_LAST_CALL_KEY, 'x'.repeat(500));
    expect(getLastMeetingCall()).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    expect(getLastMeetingCall()).toBeNull();
    expect(() => setLastMeetingCall('call-1')).not.toThrow();
  });
});
