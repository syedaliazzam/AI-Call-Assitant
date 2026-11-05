/**
 * File: apps/web/tests/integration/harness/shell.tsx
 * Purpose: The real AppShell (header, sidebar, user menu, desktop card) with a stand-in page, for
 *          tests/integration/shell.spec.ts. The address's ?role= decides the signed-in role.
 * Used by: apps/web/tests/integration/shell.spec.ts
 * Depends on: src/features/shell/AppShell.tsx, src/features/appearance/ThemeSync.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1, S2)
 */
import { createRoot } from 'react-dom/client';
import { ThemeSync } from '@/features/appearance/ThemeSync';
import { AppShell } from '@/features/shell/AppShell';

/** The role asked for by the address. */
const role = new URLSearchParams(window.location.search).get('role') === 'admin' ? 'admin' : 'user';

createRoot(document.getElementById('root')!).render(
  <>
    <ThemeSync />
    <AppShell user={{ name: 'Sam Lee', email: 'sam.lee@example.com', role }}>
      <div style={{ height: 1600 }}>The page</div>
    </AppShell>
  </>,
);
(window as unknown as { shellReady: boolean }).shellReady = true;
