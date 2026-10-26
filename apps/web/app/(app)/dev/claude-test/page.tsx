/**
 * File: apps/web/app/(app)/dev/claude-test/page.tsx
 * Purpose: The /dev/claude-test route (admins only): renders the Claude streaming test.
 * Used by: Next.js App Router; linked from the sidebar's "Dev tools"
 * Depends on: src/features/dev/ClaudeTest.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §12 Day 1 (streamed Claude reply)
 */
import { ClaudeTest } from '@/features/dev/ClaudeTest';

/**
 * Claude test page.
 *
 * @returns The page heading and the test panel.
 */
export default function ClaudeTestPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Claude streaming test</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sends a fixed test prompt (mode &quot;hello&quot;) with the fast model and streams the
          reply.
        </p>
      </header>
      <ClaudeTest />
    </div>
  );
}
