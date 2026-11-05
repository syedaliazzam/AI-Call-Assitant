/**
 * File: apps/web/app/error.tsx
 * Purpose: The page shown when a page fails unexpectedly (spec S17). Next.js requires it to be a client
 *          component. The error's own message stays out of it: it can hold details of the call.
 * Used by: Next.js App Router
 * Depends on: src/ui (Button, ErrorScreen)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S17)
 */
'use client';

import { Button } from '@/ui/Button';
import { ErrorScreen } from '@/ui/ErrorScreen';

/**
 * The error page.
 *
 * @param props.reset Tries the page again (from Next.js).
 * @returns The message, with a way to try again.
 */
export default function ErrorPage({
  reset,
}: {
  /** Tries the page again. */
  reset: () => void;
}) {
  return (
    <ErrorScreen title="Something went wrong" action={<Button onClick={reset}>Try again</Button>}>
      <p>This page could not be shown. Your sessions are safe on this computer.</p>
    </ErrorScreen>
  );
}
