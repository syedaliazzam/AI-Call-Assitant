/**
 * File: apps/web/app/(app)/question-bank/page.tsx
 * Purpose: The /question-bank route: the Question Bank tool. Kept thin: it only renders the feature.
 * Used by: Next.js App Router (the sidebar's "Question Bank" link)
 * Depends on: src/features/prepare/QuestionBank.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §9.2 (thin routes); ADR-0029
 */
import { QuestionBank } from '@/features/prepare/QuestionBank';

/**
 * Question Bank page.
 *
 * @returns The feature.
 */
export default function QuestionBankPage() {
  return <QuestionBank />;
}
