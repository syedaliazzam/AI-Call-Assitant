/**
 * File: apps/web/app/(app)/sessions/[id]/desktop/page.tsx
 * Purpose: The /sessions/[id]/desktop route: the hand-off page shown after choosing the desktop app.
 *          Kept thin: the session lives on this computer, so the feature does the work in the browser.
 * Used by: Next.js App Router (Choose platform's Desktop app)
 * Depends on: src/features/handoff/DesktopHandoffPage.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S9); ADR-0045
 */
import { DesktopHandoffPage } from '@/features/handoff/DesktopHandoffPage';

/** Props Next.js passes to this page (route parameters arrive as a promise in Next.js 16). */
interface DesktopRouteProps {
  /** The route parameters. */
  params: Promise<{
    /** The [id] segment: the session id. */
    id: string;
  }>;
}

/**
 * Hand-off page.
 *
 * @param props.params The route parameters.
 * @returns The hand-off page for this session.
 */
export default async function DesktopRoute({ params }: DesktopRouteProps) {
  const { id } = await params;
  return <DesktopHandoffPage sessionId={id} />;
}
