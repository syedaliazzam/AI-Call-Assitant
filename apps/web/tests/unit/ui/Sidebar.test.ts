/**
 * Tests for apps/web/src/ui/Sidebar.tsx, runtimeLabel():
 * the footer says "Browser" without the desktop bridge and "Desktop app vX.Y" inside the
 * desktop app (major.minor of the shell version).
 */
import { describe, expect, it, vi } from 'vitest';
import { runtimeLabel } from '@/ui/Sidebar';

describe('runtimeLabel', () => {
  it('says "Browser" without the desktop bridge (and on the server)', () => {
    expect(runtimeLabel()).toBe('Browser');
    vi.stubGlobal('window', {});
    expect(runtimeLabel()).toBe('Browser');
  });

  it('says "Desktop app vX.Y" inside the desktop app', () => {
    vi.stubGlobal('window', { kiteDesktop: { version: '0.1.0', os: 'mac' } });
    expect(runtimeLabel()).toBe('Desktop app v0.1');
  });

  it('copes with a version that has no minor part', () => {
    vi.stubGlobal('window', { kiteDesktop: { version: '2', os: 'windows' } });
    expect(runtimeLabel()).toBe('Desktop app v2.0');
  });
});
