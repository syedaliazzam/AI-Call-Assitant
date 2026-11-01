/**
 * File: apps/web/app/(app)/dev/latency/page.tsx
 * Purpose: The /dev/latency route (admins only, see ../layout.tsx): renders the answer latency
 *          measurement (20 answers, p50/p95 against the §6.2 targets).
 * Used by: Next.js App Router; linked from /dev
 * Depends on: src/features/dev/LatencyTest.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2; day-04-answers.md Stage 11
 */
import { LatencyTest } from '@/features/dev/LatencyTest';

/**
 * Latency test page.
 *
 * @returns The page heading and the test panel.
 */
export default function LatencyPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="text-[28px] font-bold text-ui-heading">Answer latency</h1>
        <p className="mt-1 text-sm text-ui-muted">
          Sends a warm-up, then 20 answers one after another on an invented session and call,
          through the same client code as the live page. Each answer adds two lines to the call, so
          the conversation grows as in a real call.
        </p>
      </header>
      <LatencyTest />
    </div>
  );
}
