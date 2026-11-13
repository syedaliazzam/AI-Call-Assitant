/**
 * Tests for apps/desktop/src/priority.ts (desktop 1.6.3, ADR-0077):
 * - a background process (Accurate, the recording finaliser) is lowered to below-normal priority once it
 *   has started; a refusal only logs a short warning;
 * - closing the call window during a call tells Drive the call ended (before 1.6.3 every later recording
 *   upload answered "paused"); closing it with no call changes nothing.
 */
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { endCallOnClose, runBelowNormal, type PriorityChild } from '../../src/priority';

/**
 * A fake child process that starts when told.
 * @param pid Its process id.
 * @returns The child and its start.
 */
function child(pid: number | undefined) {
  let started: (() => void) | null = null;
  const fake: PriorityChild = {
    pid,
    once: (_event, listener) => {
      started = listener;
      return fake;
    },
  };
  return { fake, start: () => started?.() };
}

describe('runBelowNormal', () => {
  it('lowers the priority once the process has started', () => {
    const set = vi.fn();
    const { fake, start } = child(4242);
    runBelowNormal(fake, 'recording finaliser', set);
    expect(set).not.toHaveBeenCalled();
    start();
    expect(set).toHaveBeenCalledWith(4242, os.constants.priority.PRIORITY_BELOW_NORMAL);
  });

  it('keeps going when the system refuses, with a short warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fake, start } = child(7);
    runBelowNormal(fake, 'accurate', () => {
      throw new Error('EACCES');
    });
    expect(() => start()).not.toThrow();
    expect(warn).toHaveBeenCalledWith('desktop: priority not lowered', { name: 'accurate' });
    warn.mockRestore();
  });
});

describe('endCallOnClose', () => {
  it('tells Drive a live call ended when its window closes', () => {
    const drive = { setCallActive: vi.fn() };
    expect(endCallOnClose(true, drive)).toBe(false);
    expect(drive.setCallActive).toHaveBeenCalledWith(false);
  });

  it('changes nothing when no call was live, or before Drive is installed', () => {
    const drive = { setCallActive: vi.fn() };
    expect(endCallOnClose(false, drive)).toBe(false);
    expect(drive.setCallActive).not.toHaveBeenCalled();
    expect(endCallOnClose(true, null)).toBe(false);
  });
});
