/**
 * File: apps/web/app/(app)/sessions/new/page.tsx
 * Purpose: The /sessions/new route: the Create session wizard. Kept thin: it only renders the
 *          wizard feature.
 * Used by: Next.js App Router (the dashboard's "Create session" link)
 * Depends on: src/features/session-setup/SessionWizard.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Create session), §9.2 (thin routes)
 */
import { SessionWizard } from '@/features/session-setup/SessionWizard';

/**
 * Create session page.
 *
 * @returns The wizard in create mode.
 */
export default function NewSessionPage() {
  return <SessionWizard mode="create" />;
}
