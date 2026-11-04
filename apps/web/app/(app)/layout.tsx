/**
 * File: apps/web/app/(app)/layout.tsx
 * Purpose: Frame for all signed-in pages: the header, the sidebar and the page (AppShell).
 *          "(app)" is a route group: it groups pages under this layout without adding to the URL.
 *          requireUser() sends signed-out visitors to /login and users with a temporary
 *          password to /change-password before anything renders.
 * Used by: Next.js App Router (wraps app/(app)/**)
 * Depends on: src/server/guard.ts, src/features/shell/AppShell.tsx,
 *             src/features/ask-kite/AskKiteHotkey.tsx, src/features/notices/AcceptableUseNotice.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1, S2);
 *               docs/architecture/kite-architecture-v3.1.md §5, §8.2 (sign-in)
 */
import type { ReactNode } from 'react';
import { AskKiteHotkey } from '@/features/ask-kite/AskKiteHotkey';
import { AcceptableUseNotice } from '@/features/notices/AcceptableUseNotice';
import { AppShell } from '@/features/shell/AppShell';
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
    <>
      <AskKiteHotkey />
      <AcceptableUseNotice />
      <AppShell
        user={{
          name: user.name,
          email: user.email,
          role: user.role === 'admin' ? 'admin' : 'user',
        }}
      >
        {children}
      </AppShell>
    </>
  );
}
