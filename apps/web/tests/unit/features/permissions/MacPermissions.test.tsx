/**
 * Tests for apps/web/src/features/permissions/MacPermissions.tsx (desktop 1.8.0, ADR-0111): the card shows
 * each permission's state with the button that fixes it (Allow the first time, Open System Settings once
 * refused, nothing when allowed or blocked by a device policy), "Quit and reopen" while screen recording is
 * off, and Later only on the first-run card; Connect's check reports missing permissions on a Mac only,
 * and lets the call start when both are on, outside the Mac app, or when the shell cannot tell.
 */
import type { MacPermissionState } from '@kite/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/** What the mocked shell answers (null: not the Mac desktop app). */
const shell = vi.hoisted(() => ({
  host: null as null | {
    read: () => Promise<MacPermissionState | null>;
    request: () => Promise<MacPermissionState | null>;
    openSettings: () => Promise<void>;
    relaunch: () => Promise<void>;
  },
}));
vi.mock('@/platform', () => ({ getPlatform: () => ({ macPermissions: shell.host }) }));

const { MacPermissionsCard, macPermissionsReady, missingMacPermissions, statusWords } =
  await import('@/features/permissions/MacPermissions');

/**
 * A fake shell host that answers with these states.
 *
 * @param state What read() returns.
 * @returns The host.
 */
function hostWith(state: MacPermissionState | null) {
  return {
    read: vi.fn(async () => state),
    request: vi.fn(async () => state),
    openSettings: vi.fn(async () => undefined),
    relaunch: vi.fn(async () => undefined),
  };
}

describe('MacPermissionsCard', () => {
  it('asks the first time: Allow for each, and quit and reopen for screen recording', () => {
    shell.host = hostWith(null);
    const html = renderToString(
      <MacPermissionsCard
        state={{ microphone: 'not-determined', screen: 'not-determined' }}
        onChange={() => undefined}
        reason="first-run"
        onLater={() => undefined}
      />,
    );
    expect(html).toContain('Before your first call on this Mac');
    expect(html.match(/>Allow</g)).toHaveLength(2);
    expect(html).toContain('Screen &amp; System Audio Recording');
    expect(html).toContain('quit and reopen');
    expect(html).toContain('>Quit and reopen<');
    expect(html).toContain('>Later<');
  });

  it('sends a refused permission to System Settings, and shows nothing to do once allowed', () => {
    shell.host = hostWith(null);
    const html = renderToString(
      <MacPermissionsCard
        state={{ microphone: 'denied', screen: 'granted' }}
        onChange={() => undefined}
        reason="connect"
      />,
    );
    expect(html).toContain('Paramount AI needs two permissions first');
    expect(html).toContain('Turned off: turn it on in System Settings');
    expect(html).toContain('>Allowed<');
    expect(html).not.toContain('>Allow<');
    expect(html).not.toContain('Quit and reopen');
    expect(html).not.toContain('>Later<');
  });

  it('says to ask IT when a device policy blocks it', () => {
    expect(statusWords('restricted')).toBe('Blocked by this Mac’s settings: ask IT');
    expect(statusWords('unknown')).toBe('Not allowed yet');
  });
});

describe('Connect’s check', () => {
  it('is ready only with both permissions on', () => {
    expect(macPermissionsReady({ microphone: 'granted', screen: 'granted' })).toBe(true);
    expect(macPermissionsReady({ microphone: 'granted', screen: 'denied' })).toBe(false);
  });

  it('reports what is missing on a Mac, and lets the call start otherwise', async () => {
    shell.host = hostWith({ microphone: 'granted', screen: 'not-determined' });
    await expect(missingMacPermissions()).resolves.toEqual({
      microphone: 'granted',
      screen: 'not-determined',
    });
    shell.host = hostWith({ microphone: 'granted', screen: 'granted' });
    await expect(missingMacPermissions()).resolves.toBeNull();
    // Not the Mac desktop app, or the shell could not tell: the call starts and reports any problem.
    shell.host = null;
    await expect(missingMacPermissions()).resolves.toBeNull();
    shell.host = hostWith(null);
    await expect(missingMacPermissions()).resolves.toBeNull();
  });
});
