/**
 * File: apps/web/app/(app)/layout.tsx
 * Purpose: Frame for all signed-in pages: the header, the sidebar and the page (AppShell).
 *          "(app)" is a route group: it groups pages under this layout without adding to the URL.
 *          requireUser() sends signed-out visitors to /login and users with a temporary
 *          password to /change-password before anything renders.
 * Used by: Next.js App Router (wraps app/(app)/**)
 * Depends on: src/server/guard.ts, src/server/calldata/flag.ts, src/features/sync/SyncScope.tsx,
 *             src/features/shell/AppShell.tsx, src/features/shell/AccountName.tsx (v1.3.2),
 *             src/features/ask-kite/AskKiteHotkey.tsx, src/features/notices/AcceptableUseNotice.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1, S2);
 *               docs/architecture/kite-architecture-v3.1.md §5, §8.2 (sign-in)
 */
import type { ReactNode } from 'react';
import { AskKiteHotkey } from '@/features/ask-kite/AskKiteHotkey';
import { AcceptableUseNotice } from '@/features/notices/AcceptableUseNotice';
import { AccountNameProvider } from '@/features/shell/AccountName';
import { AppShell } from '@/features/shell/AppShell';
import { DriveNotices } from '@/features/drive/DriveNotices';
import { DriveUploader } from '@/features/drive/DriveUploader';
import { AfterCallRunner } from '@/features/live/AfterCallRunner';
import { SyncScope } from '@/features/sync/SyncScope';
import { syncEnabledFor } from '@/server/calldata/flag';
import { requireUser } from '@/server/guard';

/**
 * Signed-in app layout.
 *
 * @param props.children The signed-in page being rendered.
 * @returns The app's frame around the page.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireUser();

  return (
    // ADR-0049: accounts with the accountSync switch keep their call data in the account.
    <SyncScope syncUserId={syncEnabledFor(user.id) ? user.id : null} email={user.email}>
      <AskKiteHotkey />
      <AcceptableUseNotice />
      {/* v1.3.2: the user's own transcript turns show this name. */}
      <AccountNameProvider name={user.name}>
        <AppShell
          user={{
            name: user.name,
            email: user.email,
            role: user.role === 'admin' ? 'admin' : 'user',
          }}
        >
          {children}
        </AppShell>
        {/* ADR-0077: a call's notes and Drive queueing finish here, also after its window closed. */}
        <AfterCallRunner />
        {/* 1.6.0 (ADR-0072): calls are saved to Google Drive in the background, after the call. */}
        <DriveUploader />
        <DriveNotices />
      </AccountNameProvider>
    </SyncScope>
  );
}
