/**
 * File: apps/web/app/(app)/dev/page.tsx
 * Purpose: The /dev route (admins only, see ./layout.tsx): lists the developer test pages.
 * Used by: Next.js App Router; the sidebar's "Dev Tools" link
 * Depends on: next/link
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (measured results), §12 Days 1–2
 *               (developer test pages until the real screens exist)
 */
import Link from 'next/link';

/** The developer test pages. */
const TOOLS = [
  {
    href: '/dev/ui',
    title: 'UI components',
    description: 'Every shared UI component in the Kite theme, on light and dark surfaces.',
  },
  {
    href: '/dev/claude-test',
    title: 'Claude streaming test',
    description: 'Streams a fixed test reply and shows timings and prompt-cache use.',
  },
  {
    href: '/dev/stt-test',
    title: 'Speech-to-text test',
    description:
      'Live microphone transcription with load time, real-time factor, lag and accuracy.',
  },
  {
    href: '/dev/latency',
    title: 'Answer latency',
    description: '20 answers through the live client path: p50/p95 to first word and headline.',
  },
];

/**
 * Dev Tools index page.
 *
 * @returns A list of links to the test pages.
 */
export default function DevToolsPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
      <h1 className="text-[28px] font-bold text-ui-heading">Dev Tools</h1>
      <ul className="grid gap-4 md:grid-cols-2">
        {TOOLS.map((tool) => (
          <li key={tool.href}>
            <Link
              href={tool.href}
              className="block border border-ui-border bg-ui-surface p-4 hover:border-ui-accent"
            >
              <span className="font-semibold text-ui-heading">{tool.title}</span>
              <span className="mt-1 block text-sm text-ui-muted">{tool.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
