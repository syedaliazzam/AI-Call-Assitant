/**
 * File: apps/web/tests/visual/rig-compact.tsx
 * Purpose: The overlay rig's overlay page (v1.0.3 visual checks): the real CompactLive for the rig
 *          session, served at /compact/harness-session, so the real desktop shell loads it in the
 *          real see-through overlay window with the real preload (window.kiteDesktop).
 * Used by: tests/visual/overlay-rig.ts (bundled with esbuild)
 * Depends on: src/features/live/CompactLive.tsx, react-dom
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 */
import { createRoot } from 'react-dom/client';
import { CompactLive } from '@/features/live/CompactLive';

// The session id from the address (/compact/<id>), as the app's route does.
const sessionId = window.location.pathname.split('/').pop() || 'harness-session';
createRoot(document.getElementById('root')!).render(<CompactLive sessionId={sessionId} />);
