/**
 * File: apps/web/app/(app)/dev/layout.tsx
 * Purpose: Protects every /dev page (developer test tools): admins only.
 * Used by: Next.js App Router (wraps app/(app)/dev/**)
 * Depends on: src/server/guard.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §8.3
 */
import type { ReactNode } from 'react';
import { requireAdmin } from '@/server/guard';

/**
 * Admin-only layout for dev tools.
 *
 * @param props.children The dev page being rendered.
 * @returns The page, once the caller is confirmed to be an admin.
 */
export default async function DevLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return children;
}
