/**
 * File: apps/web/app/(app)/documents/page.tsx
 * Purpose: The /documents route: the Document library. Kept thin: it only renders the feature.
 * Used by: Next.js App Router (the sidebar's "Documents" link)
 * Depends on: src/features/library/LibraryPage.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §9.2 (thin routes); ADR-0029
 */
import { LibraryPage } from '@/features/library/LibraryPage';

/**
 * Documents page.
 *
 * @returns The library page for documents.
 */
export default function DocumentsPage() {
  return <LibraryPage kind="document" />;
}
