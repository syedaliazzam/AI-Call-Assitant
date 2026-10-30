/**
 * File: apps/web/src/features/live/TranscriptStrip.tsx
 * Purpose: The live transcript: one line per utterance, labelled You / Them in different
 *          colours; the line still being spoken in grey, finished lines in black. It follows new
 *          lines automatically, pauses when the user scrolls up to read, and offers "Jump to
 *          latest" to resume. Very long lines are shown in shorter parts (display.ts). Shows the
 *          speech-to-text health notice above the lines.
 * Used by: src/features/live/LivePage.tsx (live view)
 * Depends on: src/core/transcript/transcript.ts (Utterance), src/core/transcript/display.ts,
 *             src/core/stt/health.ts (status),
 *             src/features/live/speakers.ts, src/features/live/HealthNotice.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { SttHealthStatus } from '@/core/stt/health';
import { splitForDisplay } from '@/core/transcript/display';
import type { Utterance } from '@/core/transcript/transcript';
import { HealthNotice } from './HealthNotice';
import { SPEAKER_STYLE } from './speakers';

/** How close to the bottom (px) still counts as "at the latest line". */
const BOTTOM_TOLERANCE_PX = 40;

/** Props for TranscriptStrip. */
export interface TranscriptStripProps {
  /** Lines in time order (from transcript.lines()). */
  lines: readonly Utterance[];
  /** Speech-to-text health. */
  health: SttHealthStatus;
}

/**
 * Tells whether a scroll box is at (or very near) its bottom.
 *
 * @param box The scrolling element.
 * @returns True within BOTTOM_TOLERANCE_PX of the bottom.
 */
function isAtBottom(box: HTMLElement): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= BOTTOM_TOLERANCE_PX;
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
}: TranscriptStripProps) {
  const box = useRef<HTMLDivElement>(null);
  // True while following new lines; false after the user scrolled up.
  const [following, setFollowing] = useState(true);

  // Keep the newest line in view while following.
  useEffect(() => {
    if (following && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, following]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <HealthNotice status={health} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={box}
          onScroll={(event) => setFollowing(isAtBottom(event.currentTarget))}
          className="h-full overflow-y-auto border border-ui-border bg-ui-surface p-4 sm:p-5"
          aria-live="polite"
          aria-label="Live transcript"
        >
          {lines.length === 0 ? (
            <p className="text-sm text-ui-muted">
              Listening… Lines appear here as you and the other person speak.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {lines.flatMap(splitForDisplay).map((line) => {
                const style = SPEAKER_STYLE[line.speaker];
                return (
                  <li key={line.id} className="flex gap-3 text-[15px] leading-6">
                    {/* Mono uppercase speaker labels: You in cyan, Them in blue-300. */}
                    <span
                      className={`w-12 shrink-0 font-mono text-[11px] font-medium uppercase leading-6 tracking-[0.08em] ${style.label}`}
                    >
                      {style.name}
                    </span>
                    {/* Words that may still change: grey italic. */}
                    <span className={line.final ? 'text-ui-text' : 'italic text-ui-provisional'}>
                      {line.text}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[11px] leading-6 text-ui-muted">
                      {clockTime(line.tStart)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {!following && (
          <button
            type="button"
            onClick={() => setFollowing(true)}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-ui-primary px-3 py-1 text-xs font-semibold text-ui-on-primary focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
          >
            Jump to latest
          </button>
        )}
      </div>
    </section>
  );
});
