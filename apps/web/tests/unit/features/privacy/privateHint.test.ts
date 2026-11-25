/**
 * Tests for privateHint() in apps/web/src/features/privacy/usePrivate.ts (v1.1.0, ADR-0042): what the
 * info tooltip says, for every window with a 1.1.0 shell and for the overlay only with an older one, and
 * that it says plainly what the setting does not do. 1.8.0 (ADR-0111): on a Mac, while Private is on, the
 * note "On Mac, share a single window or tab, not your entire screen."; the Mac hint says what macOS allows.
 */
import { describe, expect, it } from 'vitest';
import { PRIVATE_MAC_NOTE, privateHint, privateNote } from '@/features/privacy/usePrivate';

describe('privateHint', () => {
  it('says every window with a shell from 1.1.0', () => {
    const hint = privateHint({ on: true, supported: true, scope: 'all' });
    expect(hint).toContain("All of Paramount AI's windows are left out of screen shares");
  });

  it('says only the overlay with an older shell', () => {
    const hint = privateHint({ on: true, supported: true });
    expect(hint).toContain("Paramount AI's overlay is left out of screen shares");
  });

  it('says it does nothing against monitoring or proctoring tools', () => {
    expect(privateHint({ on: false, supported: true, scope: 'all' })).toContain(
      'does nothing against monitoring or',
    );
  });

  it('says what to do when the computer cannot do it', () => {
    expect(privateHint({ on: false, supported: false })).toContain('share a single tab or window');
  });
});

describe('Private on a Mac (ADR-0111)', () => {
  const on = { on: true, supported: true, scope: 'all' as const };

  it('shows the note while Private is on, on a Mac only', () => {
    expect(PRIVATE_MAC_NOTE).toBe('On Mac, share a single window or tab, not your entire screen.');
    expect(privateNote(on, true)).toBe(PRIVATE_MAC_NOTE);
    expect(privateNote({ ...on, on: false }, true)).toBeUndefined();
    expect(privateNote(on, false)).toBeUndefined();
    expect(privateNote(null, true)).toBeUndefined();
  });

  it('says on a Mac what macOS allows, with the note, the Dock and the monitoring line', () => {
    const hint = privateHint(on, true);
    expect(hint).toContain('can still show them in a whole-screen share');
    expect(hint).toContain(PRIVATE_MAC_NOTE);
    expect(hint).toContain('stays in your Dock');
    expect(hint).toContain('does nothing against monitoring or proctoring tools');
    expect(privateHint(on)).toContain('stays in your taskbar');
  });
});
