/**
 * File: apps/web/app/(app)/page.tsx
 * Purpose: The "/" route (dashboard). Kept thin: it only renders the Dashboard feature.
 * Used by: Next.js App Router
 * Depends on: src/features/dashboard/Dashboard.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Dashboard), §9.2 (thin routes)
 */
import { Dashboard } from '@/features/dashboard/Dashboard';

/**
 * Dashboard page.
 *
 * @returns The Dashboard feature component.
 */
export default function DashboardPage() {
  return <Dashboard />;
}
