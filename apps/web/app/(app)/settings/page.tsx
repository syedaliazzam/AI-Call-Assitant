/**
 * File: apps/web/app/(app)/settings/page.tsx
 * Purpose: The /settings route. Kept thin: it renders the Settings feature and tells it whether
 *          the user is an admin (the answer-style rollback switch is for admins, ADR-0032).
 * Used by: Next.js App Router (the sidebar's Settings link)
 * Depends on: src/features/settings/Settings.tsx, src/server/guard.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Settings), §9.2 (thin routes)
 */
import { Settings } from '@/features/settings/Settings';
import { requireUser } from '@/server/guard';

/**
 * Settings page.
 *
 * @returns The Settings feature component.
 */
export default async function SettingsPage() {
  const { user } = await requireUser();
  return <Settings isAdmin={user.role === 'admin'} />;
}
