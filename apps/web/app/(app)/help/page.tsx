/**
 * File: apps/web/app/(app)/help/page.tsx
 * Purpose: The /help route: the user guide. Kept thin: it only renders the Help feature.
 * Used by: Next.js App Router (the sidebar's Help, and the menus' Get help)
 * Depends on: src/features/help/HelpPage.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2 Help)
 */
import { HelpPage } from '@/features/help/HelpPage';

/**
 * Help page.
 *
 * @returns The Help feature component.
 */
export default function Page() {
  return <HelpPage />;
}
