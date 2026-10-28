/**
 * File: apps/web/src/features/dashboard/Dashboard.tsx
 * Purpose: The dashboard ("Call Sessions") screen. Day 1 shows only the empty state; the session
 *          list, search, filters and a working "Create session" button arrive on Day 3.
 * Used by: app/(app)/page.tsx
 * Depends on: src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Dashboard), §7.1 (features/dashboard)
 */
import { Button } from '@/ui/Button';

/**
 * The Call Sessions dashboard (empty state).
 *
 * @returns The page content: title, subtitle and an empty-state panel.
 * Rendered by: app/(app)/page.tsx
 */
export function Dashboard() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Call Sessions</h1>
          <p className="mt-1 text-sm text-slate-500">
            Prepare a session before each call, then get live answers while you talk.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button disabled>Create session</Button>
          <span className="text-xs text-slate-400">Available on Day 3</span>
        </div>
      </header>

      <section className="mt-10 flex flex-col items-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <h2 className="text-base font-medium text-slate-900">No sessions yet</h2>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Your call sessions will appear here. Each session holds the call details and documents
          Kite uses to answer.
        </p>
      </section>
    </div>
  );
}
