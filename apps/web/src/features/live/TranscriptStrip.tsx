/**
 * File: apps/web/src/features/live/TranscriptStrip.tsx
 * Purpose: The live transcript, newest line at the top (ADR-0030): one line per utterance, labelled
 *          You / Them in different colours; the line still being spoken in grey, finished lines in
 *          black. Very long lines are shown in shorter parts (display.ts). Shows the speech-to-text
 *          health notice above the lines.
 * Used by: src/features/live/LivePage.tsx (live view)
 * Depends on: src/core/transcript/transcript.ts (Utterance), src/core/transcript/display.ts,
 *             src/core/stt/health.ts (status),
 *             src/features/live/speakers.ts, src/features/live/HealthNotice.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { memo } from 'react';
import type { SttHealthStatus } from '@/core/stt/health';
import { sentenceCase, splitForDisplay } from '@/core/transcript/display';
import type { Utterance } from '@/core/transcript/transcript';
import { HealthNotice } from './HealthNotice';
import { SPEAKER_STYLE } from './speakers';

/** Props for TranscriptStrip. */
export interface TranscriptStripProps {
  /** Lines in time order (from transcript.lines()); they are shown newest first. */
  lines: readonly Utterance[];
  /** The session's own spellings to restore in each line (displayTerms()); none by default. */
  terms?: readonly string[];
  /** Speech-to-text health. */
  health: SttHealthStatus;
}

/**
 * Formats a line's start time as a short clock time, for example "14:05:09".
 *
 * @param unixMs Unix ms.
 * @returns The local time.
 */
function clockTime(unixMs: number): string {
  return new Date(unixMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * The transcript strip. Memoised: the live page re-renders about 20 times a second for the
 * meters, and the transcript only needs to re-render when its lines or health change.
 *
 * @param props See TranscriptStripProps.
 * @returns The strip.
 */
export const TranscriptStrip = memo(function TranscriptStrip({
  lines,
  health,
  terms = [],
}: TranscriptStripProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <HealthNotice status={health} />
      <div className="relative min-h-0 flex-1">
        {/* Newest at the top: at the top the newest line is in view, and someone who scrolled down
            to read stays where they are, because the browser anchors the scroll position. */}
        <div
          className="h-full overflow-y-auto border border-ui-border rounded-card bg-ui-surface shadow-card p-4 sm:p-5"
          aria-live="polite"
          aria-label="Live transcript"
        >
          {lines.length === 0 ? (
            <p className="text-[13px] text-ui-muted">
              Listening… Lines appear here as you and the other person speak.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {/* Whole lines are reversed, so a long line's parts still read in order. */}
              {[...lines]
                .reverse()
                .flatMap(splitForDisplay)
                .map((line) => {
                  const style = SPEAKER_STYLE[line.speaker];
                  return (
                    <li key={line.id} className="flex gap-3 text-[15px] leading-6">
                      {/* Speaker labels: You in the accent, Them in a light grey. */}
                      <span
                        className={`w-12 shrink-0 text-[13px] font-medium leading-6 ${style.label}`}
                      >
                        {style.name}
                      </span>
                      {/* Words that may still change: grey italic. */}
                      <span className={line.final ? 'text-ui-text' : 'italic text-ui-provisional'}>
                        {sentenceCase(line.text, terms)}
                      </span>
                      <span className="ml-auto shrink-0 text-[13px] leading-6 text-ui-muted">
                        {clockTime(line.tStart)}
                      </span>
                    </li>
                  );
                })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
});
