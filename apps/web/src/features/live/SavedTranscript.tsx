/**
 * File: apps/web/src/features/live/SavedTranscript.tsx
 * Purpose: Under the Connect view: the transcript lines this session saved in earlier calls, as
 *          a simple list (the full review page is Day 5), or a note saying whether this session
 *          saves its transcript.
 * Used by: src/features/live/LivePage.tsx
 * Depends on: src/core/storage/types.ts, src/features/live/speakers.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review, Day 5), §7.4;
 *               day-03-sessions.md Stage 4
 */
'use client';

import type { StoredUtterance } from '@/core/storage/types';
import { sentenceCase } from '@/core/transcript/display';
import { SPEAKER_STYLE } from './speakers';

/** Props for SavedTranscript. */
export interface SavedTranscriptProps {
  /** Lines saved by earlier calls, oldest first. */
  lines: readonly StoredUtterance[];
  /** The session's own spellings to restore in each line (displayTerms()); none by default. */
  terms?: readonly string[];
  /** The session's "save transcript" setting. */
  saving: boolean;
}

/** Time of day of a line, for example "14:05:09". */
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

/**
 * The saved transcript of earlier calls.
 *
 * @param props See SavedTranscriptProps.
 * @returns A collapsible list of lines, or a one-line note when there are none.
 * Rendered by: LivePage.tsx (Connect view)
 */
export function SavedTranscript({ lines, saving, terms = [] }: SavedTranscriptProps) {
  return (
    <section className="mx-auto max-w-3xl px-8 pb-10">
      {lines.length === 0 ? (
        <p className="text-sm text-ui-muted">
          {saving
            ? 'This session saves its transcript on this computer. Nothing saved yet.'
            : 'This session does not save its transcript: it is discarded when the call ends.'}
        </p>
      ) : (
        <details className="border border-ui-border bg-ui-surface p-5">
          <summary className="cursor-pointer text-sm font-semibold text-ui-heading">
            Saved transcript ({lines.length} {lines.length === 1 ? 'line' : 'lines'})
          </summary>
          <ol className="mt-3 flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.id} className="text-sm">
                <span className="mr-2 text-xs text-ui-muted">
                  {TIME_FORMAT.format(line.tStart)}
                </span>
                <span className={`mr-2 font-semibold ${SPEAKER_STYLE[line.speaker].label}`}>
                  {SPEAKER_STYLE[line.speaker].name}
                </span>
                <span className="text-ui-text">{sentenceCase(line.text, terms)}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
