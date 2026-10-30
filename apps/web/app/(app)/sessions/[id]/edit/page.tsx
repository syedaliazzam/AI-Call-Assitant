/**
 * File: apps/web/app/(app)/sessions/[id]/edit/page.tsx
 * Purpose: The /sessions/[id]/edit route: the Edit session wizard. Kept thin: the session is
 *          loaded in the browser (it lives in IndexedDB on this computer, not on the server).
 * Used by: Next.js App Router (a session card's "Edit" link)
 * Depends on: src/features/session-setup/SessionWizard.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §8.1, §9.2 (thin routes)
 */
import { SessionWizard } from '@/features/session-setup/SessionWizard';

/** Props Next.js passes to this page (route parameters arrive as a promise in Next.js 16). */
interface EditSessionRouteProps {
  /** The route parameters. */
  params: Promise<{
    /** The [id] segment: the session id. */
    id: string;
  }>;
}

/**
 * Edit session page.
 *
 * @param props.params The route parameters.
 * @returns The wizard in edit mode for this session.
 */
export default async function EditSessionPage({ params }: EditSessionRouteProps) {
  const { id } = await params;
  return <SessionWizard mode="edit" sessionId={id} />;
}
