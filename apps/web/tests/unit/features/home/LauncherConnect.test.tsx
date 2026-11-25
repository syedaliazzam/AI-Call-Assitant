/**
 * Tests for apps/web/src/features/home/LauncherConnect.tsx (ADR-0082): the Connect card is the first card
 * after a session is chosen, with the audio source and no "Record" choice any more (recording starts only
 * from the call bars' Rec pill), no Buy credits, and Connect is never blocked by recording. ADR-0109: under
 * the card, "Need it for macOS?" is a button that opens the Mac install steps.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({
  getPlatform: () => ({ recording: null, openCallWindow: () => undefined }),
  // ADR-0109: the "Need it for macOS?" link asks which computer and app this is.
  isMacComputer: () => false,
  isDesktop: () => true,
}));
vi.mock('@/core/stt/prefetch', () => ({
  speechModelPrefetch: () => ({
    subscribe: () => () => undefined,
    state: () => ({ kind: 'ready' }),
    start: async () => true,
  }),
}));
const { LauncherConnect } = await import('@/features/home/LauncherConnect');

describe('LauncherConnect (ADR-0082)', () => {
  it('has the audio source and Connect, and no Record choice or Buy credits', () => {
    const html = renderToString(
      <LauncherConnect sessionId="s1" onBack={() => undefined} onConnected={() => undefined} />,
    );
    expect(html).toContain('Connect Call Session');
    expect(html).toContain('Audio source');
    expect(html).not.toContain('aria-label="Record"');
    expect(html).not.toContain('Screen + audio');
    expect(html).not.toContain('Buy credits');
    // Connect is enabled: nothing about recording can block it.
    expect(html).toMatch(/<button type="button"[^>]*>(<svg[^]*?<\/svg>)?Connect<\/button>/);
    expect(html).not.toMatch(/disabled=""[^>]*>(<svg[^]*?<\/svg>)?Connect</);
    // ADR-0109: "Need it for macOS?" opens the Mac install steps (it was a "Coming soon" tooltip).
    expect(html).toMatch(/<button type="button"[^>]*>Need it for macOS\?<\/button>/);
    expect(html).not.toContain('Coming soon');
  });
});
