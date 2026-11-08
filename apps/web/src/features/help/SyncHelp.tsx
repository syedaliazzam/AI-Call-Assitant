/**
 * File: apps/web/src/features/help/SyncHelp.tsx
 * Purpose: The help and privacy text for an account with account sync (ADR-0049, ADR-0051, ADR-0052):
 *          where sessions are kept, what is encrypted, what never leaves the computer, what Save
 *          transcript off means, deleting, and the desktop app with one dashboard. Shown at the top of
 *          /help only for those accounts; everyone else's guide is unchanged until account sync is on
 *          for all.
 * Used by: src/features/help/HelpPage.tsx
 * Depends on: src/features/sync/SyncScope.tsx (useSyncAccount)
 * Architecture: ADR-0049 (privacy), ADR-0051, ADR-0052
 */
'use client';

import { useSyncAccount } from '@/features/sync/SyncScope';

/** The points, in order. */
const POINTS: readonly string[] = [
  'Your sessions are saved in your account: the same sessions, documents, transcripts, answers, notes, lessons and Ask AI chats appear in the browser and in the desktop app, on any computer you sign in to.',
  "They are stored on Paramount AI's server encrypted (AES-256-GCM), with the key kept apart from the database. Each computer keeps a copy so screens open at once and work offline; changes made offline are sent when you are back online.",
  'Audio never leaves your computer: speech is turned into text on it. Screenshots are never stored.',
  'Save transcript off: the transcript lines are never sent to the server. Answers and notes are still saved, and an answer shows the question it answered, which can quote the other person.',
  "Deleting a session removes it, with its documents, transcript, answers and notes, on every device. Settings → Delete all my data removes everything in your account. Deleted data stays only in the database provider's short-term backups, until they expire.",
  'The desktop app has no dashboard of its own: Open dashboard opens this one in your browser. To start a session in the desktop app, choose Desktop app here: it opens signed in, on that session.',
  'Company suggestions, the auto-answer setting and the coding language follow your account.',
];

/**
 * The section.
 *
 * @returns The section, or nothing without account sync.
 * Rendered by: HelpPage.tsx
 */
export function SyncHelp() {
  if (!useSyncAccount()) return null;
  return (
    <section
      aria-label="Your account and your data"
      className="mb-6 flex flex-col gap-2 rounded-card border border-ui-border bg-ui-surface p-4 text-[15px] leading-relaxed text-ui-text"
    >
      <h2 className="text-card-title text-ui-heading">Your account and your data</h2>
      <ul className="list-disc space-y-1.5 pl-5">
        {POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </section>
  );
}
