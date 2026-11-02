/**
 * File: apps/web/app/(app)/mock/page.tsx
 * Purpose: The /mock route: the Mock Interview tool. Kept thin: it only renders the feature.
 * Used by: Next.js App Router (the sidebar's "Mock Interview" link)
 * Depends on: src/features/prepare/MockInterview.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §9.2 (thin routes); ADR-0029
 */
import { MockInterview } from '@/features/prepare/MockInterview';

/**
 * Mock Interview page.
 *
 * @returns The feature.
 */
export default function MockInterviewPage() {
  return <MockInterview />;
}
