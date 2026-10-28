/**
 * File: apps/web/app/(app)/settings/page.tsx
 * Purpose: The /settings route. Kept thin: it only renders the Settings feature.
 * Used by: Next.js App Router (the sidebar's Settings link)
 * Depends on: src/features/settings/Settings.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Settings), §9.2 (thin routes)
 */
import { Settings } from '@/features/settings/Settings';

/**
 * Settings page.
 *
 * @returns The Settings feature component.
 */
export default function SettingsPage() {
  return <Settings />;
}
