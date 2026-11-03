/**
 * File: apps/web/app/(app)/ask-kite/page.tsx
 * Purpose: The /ask-kite route: the Ask Kite chat. Kept thin: it only renders the feature.
 * Used by: Next.js App Router (the sidebar's "Ask Kite" link and the Ctrl+Alt+K shortcut)
 * Depends on: src/features/ask-kite/AskKitePage.tsx
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */
import { AskKitePage } from '@/features/ask-kite/AskKitePage';

/**
 * Ask Kite page.
 *
 * @returns The feature.
 */
export default function AskKiteRoute() {
  return <AskKitePage />;
}
