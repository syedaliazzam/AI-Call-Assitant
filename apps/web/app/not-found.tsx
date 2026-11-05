/**
 * File: apps/web/app/not-found.tsx
 * Purpose: The page shown for an address that does not exist (spec S17).
 * Used by: Next.js App Router
 * Depends on: src/ui (ErrorScreen, LinkButton)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S17)
 */
import { ErrorScreen } from '@/ui/ErrorScreen';
import { LinkButton } from '@/ui/LinkButton';

/**
 * The not-found page.
 *
 * @returns The message, with the way back.
 */
export default function NotFound() {
  return (
    <ErrorScreen
      title="Page not found"
      action={
        <LinkButton href="/" variant="primary">
          Back to dashboard
        </LinkButton>
      }
    >
      <p>This address does not lead anywhere in Paramount AI.</p>
    </ErrorScreen>
  );
}
