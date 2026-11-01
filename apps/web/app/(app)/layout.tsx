/**
 * File: apps/web/app/(app)/layout.tsx
 * Purpose: Frame for all signed-in pages: the sidebar on the left, the page on the right.
 *          "(app)" is a route group: it groups pages under this layout without adding to the URL.
 *          requireUser() sends signed-out visitors to /login and users with a temporary
 *          password to /change-password before anything renders.
 * Used by: Next.js App Router (wraps app/(app)/**)
 * Depends on: src/server/guard.ts, src/ui/Sidebar.tsx, src/features/auth/SignOutButton.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §8.2 (sign-in)
 */
import type { ReactNode } from 'react';
import { SignOutButton } from '@/features/auth/SignOutButton';
import { requireUser } from '@/server/guard';
import { Sidebar } from '@/ui/Sidebar';

/**
 * Signed-in app layout.
 *
 * @param props.children The signed-in page being rendered.
 * @returns The sidebar and the page side by side, filling the window.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireUser();

  return (
    // Stacked on narrow screens (the sidebar becomes a top bar), side by side from 768 px.
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role === 'admin' ? 'admin' : 'user',
        }}
        userActions={<SignOutButton />}
      />
      {/* relative: absolutely positioned content (for example screen-reader-only labels) stays
          inside main instead of widening the page. */}
      <main className="relative min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
