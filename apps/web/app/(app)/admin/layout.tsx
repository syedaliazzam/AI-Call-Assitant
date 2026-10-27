/**
 * File: apps/web/app/(app)/admin/layout.tsx
 * Purpose: Protects every /admin page: only admins may open them; others go to the dashboard.
 *          (Server actions are not covered by layouts, so each admin action checks again.)
 * Used by: Next.js App Router (wraps app/(app)/admin/**)
 * Depends on: src/server/guard.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.2, §8.3
 */
import type { ReactNode } from 'react';
import { requireAdmin } from '@/server/guard';

/**
 * Admin-only layout.
 *
 * @param props.children The admin page being rendered.
 * @returns The page, once the caller is confirmed to be an admin.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return children;
}
