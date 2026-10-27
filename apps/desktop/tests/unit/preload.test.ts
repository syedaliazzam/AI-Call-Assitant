/**
 * Tests for apps/desktop/src/preload.ts, with the `electron` module mocked:
 * the version is read from the --kite-version argument, platforms map to mac/windows/linux,
 * and exactly one frozen object { version, os } is exposed as `kiteDesktop`.
 */
import { describe, expect, it, vi } from 'vitest';

/** Spy standing in for contextBridge.exposeInMainWorld. */
const exposeInMainWorld = vi.fn();

vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld } }));

const { readVersion, toDesktopOs } = await import('../../src/preload');

// The preload exposes the bridge once, at import time. Copy that call now, because the
// test runner clears mock history before each test (restoreMocks).
const exposeCalls = [...exposeInMainWorld.mock.calls];

describe('readVersion', () => {
  it('reads the version passed by the main process', () => {
    expect(readVersion(['electron', '--type=renderer', '--kite-version=0.1.0'])).toBe('0.1.0');
  });

  it('falls back to 0.0.0 when the argument is missing', () => {
    expect(readVersion(['electron'])).toBe('0.0.0');
  });
});

describe('toDesktopOs', () => {
  it('maps Node platform names to the bridge OS names', () => {
    expect(toDesktopOs('darwin')).toBe('mac');
    expect(toDesktopOs('win32')).toBe('windows');
    expect(toDesktopOs('linux')).toBe('linux');
  });
});

describe('the exposed bridge', () => {
  it('exposes only kiteDesktop with exactly { version, os }, frozen', () => {
    expect(exposeCalls).toHaveLength(1);
    const [name, api] = exposeCalls[0]!;
    expect(name).toBe('kiteDesktop');
    expect(Object.keys(api).sort()).toEqual(['os', 'version']);
    expect(Object.isFrozen(api)).toBe(true);
  });
});
