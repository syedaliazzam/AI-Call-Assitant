/**
 * Tests for privateHint() in apps/web/src/features/privacy/usePrivate.ts (v1.1.0, ADR-0042): what the
 * info tooltip says, for every window with a 1.1.0 shell and for the overlay only with an older one, and
 * that it says plainly what the setting does not do.
 */
import { describe, expect, it } from 'vitest';
import { privateHint } from '@/features/privacy/usePrivate';

describe('privateHint', () => {
  it('says every window with a shell from 1.1.0', () => {
    const hint = privateHint({ on: true, supported: true, scope: 'all' });
    expect(hint).toContain("All of Kite's windows are left out of screen shares");
  });

  it('says only the overlay with an older shell', () => {
    const hint = privateHint({ on: true, supported: true });
    expect(hint).toContain("Kite's overlay is left out of screen shares");
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
