/**
 * File: apps/web/src/features/live/openOverlay.tsx
 * Purpose: Opens the overlay (compact view) for a session, in the desktop overlay window or the
 *          browser's picture-in-picture window. Shared by the answers top bar's "Overlay" button
 *          (LiveAnswers) and the browser split view's control-strip "Minimize" (LivePage), so both
 *          open the same overlay, connected to the live page over the session channel.
 * Used by: src/features/live/LiveAnswers.tsx, src/features/live/LivePage.tsx
 * Depends on: src/platform (openCompactView), src/core/storage/overlayPrefs.ts,
 *             src/features/live/CompactLive.tsx, react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0029, ADR-0053
 */
'use client';

import { createRoot } from 'react-dom/client';
import { getStartInOverlay } from '@/core/storage/overlayPrefs';
import { getPlatform } from '@/platform';
import { CompactLive } from './CompactLive';

/**
 * What Connect did with the overlay as the call started (ADR-0053): 'opened' (it is open),
 * 'failed' (it could not open, for example no picture-in-picture in this browser), 'off' (calls do
 * not start in the overlay).
 */
export type OverlayAtStart = 'opened' | 'failed' | 'off';

/**
 * Whether a call starts in the overlay: "Start calls in the overlay" in Settings (default on;
 * ADR-0029), and always in a desktop app from 1.1.0 (ADR-0041).
 *
 * @returns True to open the overlay as the call starts.
 * Called from: LivePage (connect, ADR-0053), LiveAnswers (harnesses that mount it alone)
 */
export function startsCallsInOverlay(): boolean {
  return getPlatform().hasHomePanel() || getStartInOverlay();
}

/**
 * Opens the overlay for a session.
 *
 * @param sessionId The live session's id.
 * @returns Resolves when it is open.
 * @throws What the platform throws when it cannot open one (a browser needs a fresh click).
 * Called from: LivePage (Connect, before the call's capture, ADR-0053; control-strip Minimize),
 *              LiveAnswers (Overlay button; start-in-overlay in harnesses)
 */
export function openOverlay(sessionId: string): Promise<void> {
  return getPlatform().openCompactView(sessionId, (container) => {
    // Browser: the overlay in the picture-in-picture window (same page, so it reaches this live
    // view over the session channel like the desktop window does).
    const root = createRoot(container);
    root.render(<CompactLive sessionId={sessionId} closeOnEnd={false} />);
    return () => root.unmount();
  });
}
