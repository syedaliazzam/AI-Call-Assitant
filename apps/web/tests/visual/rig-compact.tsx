/**
 * File: apps/web/tests/visual/rig-compact.tsx
 * Purpose: The overlay rig's overlay page (v1.0.3 visual checks): the real CompactLive for the rig
 *          session, served at /compact/harness-session, so the real desktop shell loads it in the
 *          real see-through overlay window with the real preload (window.kiteDesktop).
 * Used by: tests/visual/overlay-rig.ts (bundled with esbuild)
 * Depends on: src/features/live/CompactLive.tsx, src/features/sync/SyncScope.tsx, react-dom
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 */
import { createRoot } from 'react-dom/client';
import { CompactLive } from '@/features/live/CompactLive';
import { SyncScope } from '@/features/sync/SyncScope';

// The session id from the address (/compact/<id>), as the app's route does.
const sessionId = window.location.pathname.split('/').pop() || 'harness-session';
// ADR-0085 checks: 'rig.plainAccount' = '1' in the rig's storage shows the overlay as an account
// WITHOUT account sync sees it (apps/desktop/tests/visual/compact-view-check.ts sets it).
const plain = (() => {
  try {
    return localStorage.getItem('rig.plainAccount') === '1';
  } catch {
    return false;
  }
})();
// ADR-0055: by default as an account with account sync sees it (the reference look, click-through); an
// invented account, with no sync engine and no network.
createRoot(document.getElementById('root')!).render(
  <SyncScope accountId="rig-user" syncUserId={plain ? null : 'rig-user'} runEngine={false}>
    <CompactLive sessionId={sessionId} />
  </SyncScope>,
);
