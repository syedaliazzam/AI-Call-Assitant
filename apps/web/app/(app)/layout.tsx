/**
 * File: apps/web/app/(app)/layout.tsx
 * Purpose: Frame for all signed-in pages: the sidebar on the left, the page on the right.
 *          "(app)" is a route group: it groups pages under this layout without adding to the URL.
 *          Stage 1: no sign-in check yet. Stage 2 adds requireUser() and passes the user to the
 *          sidebar.
 * Used by: Next.js App Router (wraps app/(app)/**)
 * Depends on: src/ui/Sidebar.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §8.2 (sign-in)
 */
import type { ReactNode } from 'react';
import { Sidebar } from '@/ui/Sidebar';

/**
 * Signed-in app layout.
 *
 * @param props.children The signed-in page being rendered.
 * @returns The sidebar and the page side by side, filling the window.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
