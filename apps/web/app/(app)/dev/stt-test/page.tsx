/**
 * File: apps/web/app/(app)/dev/stt-test/page.tsx
 * Purpose: The /dev/stt-test route (admins only, see ../layout.tsx): the speech-to-text spike.
 * Used by: Next.js App Router; linked from /dev
 * Depends on: src/features/dev/SttTest.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §12 Day 1 (STT spike); ADR-0020
 */
import { SttTest } from '@/features/dev/SttTest';

/**
 * Speech-to-text test page.
 *
 * @returns The heading and the test panel.
 */
export default function SttTestPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Speech-to-text test</h1>
        <p className="mt-1 text-sm text-slate-500">
          Runs sherpa-onnx (WebAssembly) in a Web Worker on this device. Audio and text stay on this
          computer. First run <code>pnpm --filter web fetch-models</code>.
        </p>
      </header>
      <SttTest />
    </div>
  );
}
