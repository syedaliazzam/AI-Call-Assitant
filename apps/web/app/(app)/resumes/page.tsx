/**
 * File: apps/web/app/(app)/resumes/page.tsx
 * Purpose: The /resumes route: the Resume library. Kept thin: it only renders the feature.
 * Used by: Next.js App Router (the sidebar's "Resumes" link)
 * Depends on: src/features/library/LibraryPage.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §9.2 (thin routes); ADR-0029
 */
import { LibraryPage } from '@/features/library/LibraryPage';

/**
 * Resumes page.
 *
 * @returns The library page for resumes.
 */
export default function ResumesPage() {
  return <LibraryPage kind="resume" />;
}
