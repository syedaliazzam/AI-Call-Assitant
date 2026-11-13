/**
 * File: apps/web/app/home/page.tsx
 * Purpose: The /home route: the home panel, the desktop app's default window between calls (v1.1.0,
 *          ADR-0041). Signed-in users only. Outside the (app) group on purpose, so it has no sidebar:
 *          the window is small. Opened in a browser, the panel sends it to the dashboard.
 * Used by: Next.js App Router; loaded by apps/desktop/src/home.ts
 * Depends on: src/server/guard.ts (requireUser), src/features/home/HomePanel.tsx,
 *             src/features/shell/AccountName.tsx (v1.3.2),
 *             src/features/sync/SyncScope.tsx and src/server/calldata/flag.ts (ADR-0049)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §9.2 (thin routes); ADR-0041
 */
import { DriveUploader } from '@/features/drive/DriveUploader';
import { AfterCallRunner } from '@/features/live/AfterCallRunner';
import { HomePanel } from '@/features/home/HomePanel';
import { AccountNameProvider } from '@/features/shell/AccountName';
import { SyncScope } from '@/features/sync/SyncScope';
import { syncEnabledFor } from '@/server/calldata/flag';
import { requireUser } from '@/server/guard';

/**
 * Home panel page.
 *
 * @param props.searchParams The address's query: `session` is the session a paramountai:// link named.
 * @returns The panel for the signed-in person.
 */
export default async function HomeRoute({
  searchParams,
}: {
  /** The address's query, as Next.js passes it. */
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  // Same sign-in rules as every app page (temporary passwords go to /change-password).
  const { user } = await requireUser();
  const { session } = await searchParams;
  return (
    // ADR-0049: the panel shows the account's sessions when the account syncs.
    <SyncScope syncUserId={syncEnabledFor(user.id) ? user.id : null} email={user.email}>
      {/* v1.3.2: the user's own transcript turns show this name. */}
      <AccountNameProvider name={user.name}>
        <HomePanel
          email={user.email}
          {...(typeof session === 'string' ? { startSessionId: session } : {})}
        />
        {/* ADR-0077: a call's notes and Drive queueing finish here, also after its window closed. */}
        <AfterCallRunner />
        {/* 1.6.0 (ADR-0072): the desktop app's first window keeps uploading after a call. */}
        {/* Drive's notices are placed by the panel itself (1.6.1: never over the launcher's bar). */}
        <DriveUploader />
      </AccountNameProvider>
    </SyncScope>
  );
}
