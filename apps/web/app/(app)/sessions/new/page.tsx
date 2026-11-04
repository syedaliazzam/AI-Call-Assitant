/**
 * File: apps/web/app/(app)/sessions/new/page.tsx
 * Purpose: The /sessions/new route: the Create session wizard, as a modal over the sessions page. Kept
 *          thin: it only renders the two features, passing on the type chosen in the split button's
 *          menu (?type=mock).
 * Used by: Next.js App Router (the dashboard's "Create session" menu)
 * Depends on: src/features/dashboard/Dashboard.tsx, src/features/session-setup/SessionWizard.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Create session), §9.2 (thin route
 */
import { Dashboard } from '@/features/dashboard/Dashboard';
import { SessionWizard } from '@/features/session-setup/SessionWizard';

/**
 * Create session page.
 *
 * @param props.searchParams The address's query: `type` is the session type to start with.
 * @returns The wizard in create mode.
 */
export default async function NewSessionPage({
  searchParams,
}: {
  /** The address's query, as Next.js passes it. */
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const { type } = await searchParams;
  return (
    <>
      <Dashboard />
      <SessionWizard mode="create" {...(typeof type === 'string' ? { initialType: type } : {})} />
    </>
  );
}
