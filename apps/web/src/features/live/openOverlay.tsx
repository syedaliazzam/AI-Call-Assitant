/**
 * File: apps/web/src/features/live/openOverlay.tsx
 * Purpose: Opens the overlay (compact view) for a session, in the desktop overlay window or the
 *          browser's picture-in-picture window. Shared by the answers top bar's "Overlay" button
 *          (LiveAnswers) and the browser split view's control-strip "Minimize" (LivePage), so both
 *          open the same overlay, connected to the live page over the session channel.
 * Used by: src/features/live/LiveAnswers.tsx, src/features/live/LivePage.tsx
 * Depends on: src/platform (openCompactView), src/features/live/CompactLive.tsx, react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0029
 */
'use client';

import { createRoot } from 'react-dom/client';
import { getPlatform } from '@/platform';
import { CompactLive } from './CompactLive';

/**
 * Opens the overlay for a session.
 *
 * @param sessionId The live session's id.
 * @returns Resolves when it is open.
 * @throws What the platform throws when it cannot open one (a browser needs a fresh click).
 * Called from: LiveAnswers (Overlay button, start-in-overlay), LivePage (control-strip Minimize)
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
