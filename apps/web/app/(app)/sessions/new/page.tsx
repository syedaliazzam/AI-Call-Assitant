/**
 * File: apps/web/app/(app)/sessions/new/page.tsx
 * Purpose: The /sessions/new route: the Create session wizard. Kept thin: it only renders the
 *          wizard feature, passing on the type chosen in the dashboard's dropdown (?type=mock).
 * Used by: Next.js App Router (the dashboard's "Create session" menu)
 * Depends on: src/features/session-setup/SessionWizard.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Create session), §9.2 (thin route
 */
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
    <SessionWizard mode="create" {...(typeof type === 'string' ? { initialType: type } : {})} />
  );
}
